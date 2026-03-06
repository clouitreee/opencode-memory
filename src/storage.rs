use crate::embeddings::{cosine_similarity, Embedder};
use crate::models::{Config, Memory, Stats};
use chrono::Utc;
use directories::ProjectDirs;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("No storage directory found")]
    NoStorageDir,
    #[error("Memory not found: {0}")]
    NotFound(String),
}

pub struct Storage {
    base_path: PathBuf,
    memories: HashMap<String, Memory>,
    config: Config,
}

impl Storage {
    pub fn new(base_path: Option<PathBuf>) -> Result<Self, StorageError> {
        let base = base_path.ok_or(StorageError::NoStorageDir)?;
        let memories_dir = base.join("memories");
        fs::create_dir_all(&memories_dir)?;

        let config_path = base.join("config.json");
        let config = if config_path.exists() {
            let content = fs::read_to_string(&config_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Config {
                storage_path: Some(base.to_string_lossy().to_string()),
                default_project: None,
                importance_threshold: 0.5,
            }
        };

        let memories = Self::load_memories(&memories_dir)?;

        Ok(Self {
            base_path: base,
            memories,
            config,
        })
    }

    fn load_memories(dir: &PathBuf) -> Result<HashMap<String, Memory>, StorageError> {
        let mut memories = HashMap::new();
        if !dir.exists() {
            return Ok(memories);
        }

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                let content = fs::read_to_string(&path)?;
                if let Ok(memory) = serde_json::from_str::<Memory>(&content) {
                    memories.insert(memory.id.clone(), memory);
                }
            }
        }
        Ok(memories)
    }

    pub fn save(&mut self, mut memory: Memory) -> Result<&Memory, StorageError> {
        memory.created_at = Utc::now();
        let id = memory.id.clone();

        let memories_dir = self.base_path.join("memories");
        fs::create_dir_all(&memories_dir)?;

        let path = memories_dir.join(format!("{}.json", id));
        let content = serde_json::to_string_pretty(&memory)?;
        fs::write(&path, content)?;

        self.memories.insert(id, memory);
        self.memories.get(&id).ok_or(StorageError::NotFound(id))
    }

    pub fn get(&self, id: &str) -> Option<&Memory> {
        self.memories.get(id)
    }

    pub fn get_all(&self) -> Vec<&Memory> {
        self.memories.values().collect()
    }

    pub fn get_by_project(&self, project: &str) -> Vec<&Memory> {
        self.memories
            .values()
            .filter(|m| m.project.as_deref() == Some(project))
            .collect()
    }

    pub fn delete(&mut self, id: &str) -> Result<(), StorageError> {
        if let Some(memory) = self.memories.remove(id) {
            let path = self.base_path.join("memories").join(format!("{}.json", memory.id));
            if path.exists() {
                fs::remove_file(path)?;
            }
            Ok(())
        } else {
            Err(StorageError::NotFound(id.to_string()))
        }
    }

    pub fn search_by_text(&self, query: &str) -> Vec<&Memory> {
        let query_lower = query.to_lowercase();
        self.memories
            .values()
            .filter(|m| m.content.to_lowercase().contains(&query_lower))
            .collect()
    }

    pub fn search_semantic(&mut self, query: &str, limit: usize) -> Vec<(f32, &Memory)> {
        let mut embedder = Embedder::new();
        let query_embedding = embedder.embed(&[query.to_string()]);

        if query_embedding.is_empty() {
            return Vec::new();
        }

        let query_vec = &query_embedding[0];
        let mut results: Vec<(f32, &Memory)> = self
            .memories
            .values()
            .filter_map(|m| {
                m.embedding.as_ref().map(|emb| {
                    let sim = cosine_similarity(query_vec, emb);
                    (sim, m)
                })
            })
            .filter(|(score, _)| *score > 0.1)
            .collect();

        results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(limit);
        results
    }

    pub fn embed_and_save(&mut self, memory: &mut Memory) -> Result<(), StorageError> {
        let mut embedder = Embedder::new();
        let embeddings = embedder.embed(&[memory.content.clone()]);

        if let Some(embedding) = embeddings.into_iter().next() {
            memory.embedding = Some(embedding);
        }

        let id = memory.id.clone();
        let path = self.base_path.join("memories").join(format!("{}.json", id));
        let content = serde_json::to_string_pretty(&*memory)?;
        fs::write(path, content)?;

        if let Some(m) = self.memories.get_mut(&id) {
            m.embedding = memory.embedding.clone();
        }

        Ok(())
    }

    pub fn update_embedding(&mut self, id: &str, embedding: Vec<f32>) -> Result<(), StorageError> {
        if let Some(memory) = self.memories.get_mut(id) {
            memory.embedding = Some(embedding);
            let path = self.base_path.join("memories").join(format!("{}.json", id));
            let content = serde_json::to_string_pretty(&*memory)?;
            fs::write(path, content)?;
            Ok(())
        } else {
            Err(StorageError::NotFound(id.to_string()))
        }
    }

    pub fn get_memories_with_embeddings(&self) -> Vec<&Memory> {
        self.memories
            .values()
            .filter(|m| m.embedding.is_some())
            .collect()
    }

    pub fn stats(&self, project: Option<&str>, session: Option<&str>) -> Stats {
        let memories: Vec<&Memory> = match (project, session) {
            (Some(p), _) => self.get_by_project(p),
            (_, _) => self.get_all(),
        };

        let mut by_type: HashMap<String, u32> = HashMap::new();
        for m in &memories {
            *by_type.entry(format!("{:?}", m.memory_type).to_lowercase()).or_insert(0) += 1;
        }

        Stats {
            total_memories: memories.len() as u32,
            by_type,
            current_session: session.map(String::from),
            project: project.map(String::from),
        }
    }

    pub fn base_path(&self) -> &PathBuf {
        &self.base_path
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn config_mut(&mut self) -> &mut Config {
        &mut self.config
    }

    pub fn persist_config(&self) -> Result<(), StorageError> {
        let config_path = self.base_path.join("config.json");
        let content = serde_json::to_string_pretty(&self.config)?;
        fs::write(config_path, content)?;
        Ok(())
    }
}

pub fn get_default_storage_path() -> Option<PathBuf> {
    ProjectDirs::from("com", "longmem", "LongMem")
        .map(|dirs| dirs.data_dir().to_path_buf())
}