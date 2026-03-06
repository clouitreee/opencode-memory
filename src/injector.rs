use crate::models::Memory;
use chrono::Utc;

pub struct ContextInjector {
    prefix: String,
    max_memories: usize,
}

impl ContextInjector {
    pub fn new() -> Self {
        Self {
            prefix: "=== CONTEXTO DE SESIONES ANTERIORES ===".to_string(),
            max_memories: 10,
        }
    }

    pub fn with_max_memories(mut self, max: usize) -> Self {
        self.max_memories = max;
        self
    }

    pub fn build_context_block(&self, memories: &[Memory]) -> String {
        if memories.is_empty() {
            return String::new();
        }

        let selected = memories.iter().take(self.max_memories);
        let mut lines = vec![self.prefix.clone()];

        for (i, mem) in selected.enumerate() {
            let recency_badge = self.get_recency_badge(&mem.created_at);
            let type_label = format!("{:?}", mem.memory_type).to_lowercase();
            let truncated = if mem.content.len() > 80 {
                format!("{}...", &mem.content[..80])
            } else {
                mem.content.clone()
            };
            lines.push(format!(
                "[{}] {} {}: {}",
                i + 1,
                recency_badge,
                type_label,
                truncated
            ));
        }

        lines.push("=" .repeat(40));
        lines.join("\n")
    }

    pub fn inject_into_system_prompt(&self, system_prompt: &str, context: &str) -> String {
        if context.is_empty() {
            return system_prompt.to_string();
        }
        format!("{}\n\n{}", system_prompt, context)
    }

    pub fn inject_into_user_message(&self, user_message: &str, context: &str) -> String {
        if context.is_empty() {
            return user_message.to_string();
        }
        format!("{}\n\n--- Tu primera instrucción ---\n{}", context, user_message)
    }

    pub fn create_base_system_prompt(&self, custom: Option<&str>) -> String {
        let base = "Eres un asistente de terminal con memoria a largo plazo. \
                    Recuerda información de sesiones anteriores y aplícala cuando sea relevante. \
                    No repitas al usuario información que ya proporcionó antes.";

        match custom {
            Some(c) => format!("{}\n\n{}", base, c),
            None => base.to_string(),
        }
    }

    fn get_recency_badge(&self, created_at: &chrono::DateTime<Utc>) -> &'static str {
        let now = Utc::now();
        let age = (*created_at - now).num_days().abs();

        if age < 1 {
            "NEW"
        } else if age < 7 {
            "RECENT"
        } else if age < 30 {
            "OLD"
        } else {
            "ARCHIVE"
        }
    }
}

impl Default for ContextInjector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ImportanceLevel, MemoryType};
    use chrono::Utc;

    #[test]
    fn test_build_context_block_empty() {
        let injector = ContextInjector::new();
        let result = injector.build_context_block(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_build_context_block_with_memories() {
        let injector = ContextInjector::new();
        let memory = Memory::new(
            "Test memory content".to_string(),
            MemoryType::Command,
            ImportanceLevel::Medium,
        );

        let result = injector.build_context_block(&[memory]);
        assert!(result.contains("CONTEXTO DE SESIONES ANTERIORES"));
        assert!(result.contains("command"));
    }

    #[test]
    fn test_inject_into_system_prompt() {
        let injector = ContextInjector::new();
        let context = "=== TEST ===\n[1] test";
        let prompt = "You are a helpful assistant";

        let result = injector.inject_into_system_prompt(prompt, context);
        assert!(result.contains("You are a helpful assistant"));
        assert!(result.contains("=== TEST ==="));
    }
}