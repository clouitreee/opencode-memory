pub mod embeddings;
pub mod extractor;
pub mod injector;
pub mod models;
pub mod storage;

use extractor::MemoryExtractor;
use injector::ContextInjector;
use models::{Memory, Stats};
use storage::{get_default_storage_path, Storage, StorageError};
use uuid::Uuid;

pub struct LongMem {
    storage: Storage,
    extractor: MemoryExtractor,
    injector: ContextInjector,
    session_id: String,
    project: Option<String>,
    turn_count: u32,
}

impl LongMem {
    pub fn new(storage_path: Option<std::path::PathBuf>) -> Result<Self, StorageError> {
        let path = storage_path.or_else(get_default_storage_path);
        let storage = Storage::new(path)?;
        let config = storage.config();

        Ok(Self {
            storage,
            extractor: MemoryExtractor::new(config.importance_threshold),
            injector: ContextInjector::new(),
            session_id: Uuid::new_v4().to_string(),
            project: config.default_project.clone(),
            turn_count: 0,
        })
    }

    pub fn set_project(&mut self, project: impl Into<String>) {
        self.project = Some(project.into());
    }

    pub fn capture_turn(&mut self, user_input: &str, model_output: &str) -> Vec<&Memory> {
        self.turn_count += 1;
        let project = self.project.clone();
        let session_id = self.session_id.clone();

        let mut memories = self.extractor.extract(user_input, model_output);

        for mem in &mut memories {
            if let Some(ref p) = project {
                mem.project = Some(p.clone());
            }
            mem.session_id = Some(session_id.clone());
        }

        let mut results = Vec::new();
        for mut memory in memories {
            let _ = self.storage.embed_and_save(&mut memory);
            if let Ok(saved) = self.storage.save(memory) {
                results.push(saved);
            }
        }

        results
    }

    pub fn retrieve(&mut self, query: &str, limit: usize) -> Vec<&Memory> {
        let semantic_results = self.storage.search_semantic(query, limit);
        if !semantic_results.is_empty() {
            return semantic_results.into_iter().map(|(_, m)| m).collect();
        }
        let text_results = self.storage.search_by_text(query);
        text_results.into_iter().take(limit).collect()
    }

    pub fn retrieve_with_embeddings(&mut self, query: &str, limit: usize) -> Vec<&Memory> {
        let results = self.storage.search_semantic(query, limit);
        results.into_iter().map(|(_, m)| m).collect()
    }

    pub fn build_context(&self, memories: &[&Memory]) -> String {
        let cloned: Vec<Memory> = memories.iter().map(|m| (*m).clone()).collect();
        self.injector.build_context_block(&cloned)
    }

    pub fn get_context_for_task(&mut self, task: &str) -> String {
        let memories = self.retrieve(task, 10);
        self.build_context(&memories)
    }

    pub fn list_memories(&self) -> Vec<&Memory> {
        self.storage.get_all()
    }

    pub fn get_memory(&self, id: &str) -> Option<&Memory> {
        self.storage.get(id)
    }

    pub fn delete_memory(&mut self, id: &str) -> Result<(), StorageError> {
        self.storage.delete(id)
    }

    pub fn stats(&self) -> Stats {
        self.storage.stats(
            self.project.as_deref(),
            Some(&self.session_id),
        )
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn project(&self) -> Option<&str> {
        self.project.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_longmem_new() {
        let temp_dir = TempDir::new().unwrap();
        let longmem = LongMem::new(Some(temp_dir.path().to_path_buf()));
        assert!(longmem.is_ok());
    }

    #[test]
    fn test_capture_turn() {
        let temp_dir = TempDir::new().unwrap();
        let mut longmem = LongMem::new(Some(temp_dir.path().to_path_buf())).unwrap();
        longmem.set_project("test-project");

        let memories = longmem.capture_turn(
            "Tengo un error de conexión",
            "Ejecuta `netstat -tulpn` para ver los puertos",
        );

        assert!(!memories.is_empty());
    }

    #[test]
    fn test_integration_capture_retrieve() {
        let temp_dir = TempDir::new().unwrap();
        let mut longmem = LongMem::new(Some(temp_dir.path().to_path_buf())).unwrap();
        longmem.set_project("test-project");

        // Capture a memory about nginx error
        longmem.capture_turn(
            "I got a 502 error on nginx",
            "Run `sudo systemctl restart nginx` to fix it",
        );

        // Retrieve with semantic search
        let results = longmem.retrieve("nginx error", 5);
        assert!(!results.is_empty());

        // Retrieve with text search fallback
        let results2 = longmem.retrieve("systemctl", 5);
        assert!(!results2.is_empty());

        // Build context block
        let context = longmem.build_context(&results);
        assert!(!context.is_empty());
        assert!(context.contains("nginx"));
    }

    #[test]
    fn test_persistence() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();

        // Create and capture
        {
            let mut longmem = LongMem::new(Some(path.clone())).unwrap();
            longmem.capture_turn("test input", "test output");
        }

        // Restart and verify persistence
        {
            let longmem = LongMem::new(Some(path.clone())).unwrap();
            let memories = longmem.list_memories();
            assert_eq!(memories.len(), 1);
        }
    }
}