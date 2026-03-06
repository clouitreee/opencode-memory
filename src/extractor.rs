use crate::models::{ImportanceLevel, Memory, MemoryType};
use regex::Regex;

pub struct MemoryExtractor {
    error_patterns: Vec<Regex>,
    config_patterns: Vec<Regex>,
    preference_patterns: Vec<Regex>,
    decision_patterns: Vec<Regex>,
    command_pattern: Regex,
    importance_threshold: f32,
}

impl MemoryExtractor {
    pub fn new(threshold: f32) -> Self {
        Self {
            error_patterns: vec![
                Regex::new(r"(?i)error[:\s]+(.+)").unwrap(),
                Regex::new(r"(?i)failed[:\s]+(.+)").unwrap(),
                Regex::new(r"(?i)exception[:\s]+(.+)").unwrap(),
                Regex::new(r"Permission denied").unwrap(),
                Regex::new(r"No such file or directory").unwrap(),
                Regex::new(r"command not found").unwrap(),
                Regex::new(r"Connection refused").unwrap(),
                Regex::new(r"(?i)timeout").unwrap(),
            ],
            config_patterns: vec![
                Regex::new(r"(?:export|set|ENV)\s+\w+=").unwrap(),
                Regex::new(r"~/.+\.(?:json|yaml|yml|toml|conf|cfg|ini)").unwrap(),
                Regex::new(r"/etc/[\w/]+").unwrap(),
                Regex::new(r"docker-compose").unwrap(),
                Regex::new(r"package\.json").unwrap(),
                Regex::new(r"requirements\.txt").unwrap(),
                Regex::new(r"Cargo\.toml").unwrap(),
            ],
            preference_patterns: vec![
                Regex::new(r"(?i)(?:prefer|me gusta|usar|utilizar)\s+\w+").unwrap(),
                Regex::new(r"(?i)(?:nunca|no me gusta)\s+\w+").unwrap(),
                Regex::new(r"(?i)(?:always|never)\s+(?:use|do)").unwrap(),
            ],
            decision_patterns: vec![
                Regex::new(r"(?i)(?:decidí|decidimos|decision)").unwrap(),
                Regex::new(r"(?i)(?:elegí|elegimos)").unwrap(),
                Regex::new(r"(?i)(?:opté por|optamos por)").unwrap(),
                Regex::new(r"(?i)(?:chose to|decided to)").unwrap(),
            ],
            command_pattern: Regex::new(r"`([^`]+)`").unwrap(),
            importance_threshold: threshold,
        }
    }

    pub fn extract(
        &self,
        user_input: &str,
        model_output: &str,
    ) -> Vec<Memory> {
        let combined = format!("{}\n{}", user_input, model_output);
        let mut memories = Vec::new();

        memories.extend(self.extract_errors(user_input, model_output));
        memories.extend(self.extract_configs(&combined));
        memories.extend(self.extract_preferences(&combined));
        memories.extend(self.extract_decisions(&combined));
        memories.extend(self.extract_commands(model_output));

        memories
            .into_iter()
            .filter(|m| m.importance >= self.importance_threshold)
            .collect()
    }

    fn extract_errors(&self, user_input: &str, model_output: &str) -> Vec<Memory> {
        let combined = format!("{}\n{}", user_input, model_output);
        let mut results = Vec::new();

        for pattern in &self.error_patterns {
            if let Some(m) = pattern.find(&combined) {
                let solution = self.extract_solution(model_output);
                let content = if let Some(sol) = solution {
                    format!("Error: {}. Solución: {}", m.as_str(), sol)
                } else {
                    format!("Error: {}", m.as_str())
                };

                results.push(
                    Memory::new(content, MemoryType::ErrorResolution, ImportanceLevel::High)
                        .with_tags(vec!["error".to_string(), "resolution".to_string()]),
                );
            }
        }

        results
    }

    fn extract_solution(&self, output: &str) -> Option<String> {
        let patterns = [
            r"(?i)(?:solved|fixed|arreglado|resuelto)[:\s]+(.+)",
            r"(?i)(?:use|usa|utiliza)[:\s]+(.+)",
            r"(?i)(?:run|ejecuta)[:\s]+(.+)",
            r"(?i)(?:try|intenta)[:\s]*`?([^`\n]+)`?",
        ];

        for pattern in patterns {
            if let Ok(re) = Regex::new(pattern) {
                if let Some(cap) = re.captures(output) {
                    if let Some(m) = cap.get(1) {
                        return Some(m.as_str().trim().to_string());
                    }
                }
            }
        }
        None
    }

    fn extract_configs(&self, text: &str) -> Vec<Memory> {
        let mut results = Vec::new();

        for pattern in &self.config_patterns {
            for m in pattern.find_iter(text) {
                results.push(
                    Memory::new(
                        format!("Configuración detectada: {}", m.as_str()),
                        MemoryType::Config,
                        ImportanceLevel::Medium,
                    )
                    .with_tags(vec!["config".to_string(), "environment".to_string()]),
                );
            }
        }

        results
    }

    fn extract_preferences(&self, text: &str) -> Vec<Memory> {
        let mut results = Vec::new();

        for pattern in &self.preference_patterns {
            if let Some(m) = pattern.find(text) {
                results.push(
                    Memory::new(
                        format!("Preferencia: {}", m.as_str()),
                        MemoryType::Preference,
                        ImportanceLevel::High,
                    )
                    .with_tags(vec!["preference".to_string()]),
                );
            }
        }

        results
    }

    fn extract_decisions(&self, text: &str) -> Vec<Memory> {
        let mut results = Vec::new();

        for pattern in &self.decision_patterns {
            if let Some(m) = pattern.find(text) {
                results.push(
                    Memory::new(
                        format!("Decisión técnica: {}", m.as_str()),
                        MemoryType::Decision,
                        ImportanceLevel::Medium,
                    )
                    .with_tags(vec!["decision".to_string()]),
                );
            }
        }

        results
    }

    fn extract_commands(&self, output: &str) -> Vec<Memory> {
        let mut results = Vec::new();

        for m in self.command_pattern.find_iter(output) {
            let cmd = m.as_str().trim_matches('`');
            if cmd.len() > 3 && !cmd.starts_with('#') {
                results.push(
                    Memory::new(
                        format!("Comando usado: {}", cmd),
                        MemoryType::Command,
                        ImportanceLevel::Low,
                    )
                    .with_tags(vec!["command".to_string()]),
                );
            }
        }

        results
    }
}

impl Default for MemoryExtractor {
    fn default() -> Self {
        Self::new(0.5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_error() {
        let extractor = MemoryExtractor::default();
        let memories = extractor.extract(
            "El servidor devuelve error 502",
            "Ejecuta sudo systemctl restart nginx y eso lo solve",
        );

        assert!(!memories.is_empty());
        assert!(memories.iter().any(|m| matches!(m.memory_type, MemoryType::ErrorResolution)));
    }

    #[test]
    fn test_extract_config() {
        let extractor = MemoryExtractor::default();
        let memories = extractor.extract(
            "Quiero configurar el proyecto",
            "Edita el archivo ~/.config/myapp.json",
        );

        assert!(memories.iter().any(|m| matches!(m.memory_type, MemoryType::Config)));
    }

    #[test]
    fn test_extract_command() {
        let extractor = MemoryExtractor::default();
        let memories = extractor.extract(
            "Cómo veo los logs?",
            "Usa `tail -f /var/log/syslog`",
        );

        assert!(memories.iter().any(|m| matches!(m.memory_type, MemoryType::Command)));
    }
}