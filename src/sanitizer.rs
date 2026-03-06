use regex::Regex;

const SECRET_PATTERNS: &[&str] = &[
    r"(?i)\b(api_key|apikey|api-key)\s*[:=]\s*['\"]?[\w-]{20,}",
    r"(?i)\b(password|passwd|pwd)\s*[:=]\s*['\"]?[\S]{8,}",
    r"(?i)\b(secret|token|auth)\s*[:=]\s*['\"]?[\w-]{20,}",
    r"(?i)\b(private_key|privatekey)\s*[:=]",
    r"(?i)\b(bearer\s+[\w-]{20,})",
    r"(?i)\b(aws_access_key|aws_secret)\s*[:=]",
];

const REDACTED: &str = "[REDACTED]";

pub struct Sanitizer {
    secret_patterns: Vec<Regex>,
}

impl Sanitizer {
    pub fn new() -> Self {
        let secret_patterns = SECRET_PATTERNS
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();

        Self { secret_patterns }
    }

    pub fn sanitize(&self, text: &str) -> String {
        let mut result = text.to_string();

        for pattern in &self.secret_patterns {
            result = pattern.replace_all(&result, REDACTED).to_string();
        }

        result
    }

    pub fn contains_secrets(&self, text: &str) -> bool {
        self.secret_patterns.iter().any(|p| p.is_match(text))
    }

    pub fn sanitize_memory_content(&self, content: &str) -> String {
        let sanitized = self.sanitize(content);
        
        let reserved_tags = ["secret", "private", "internal"];
        let mut result = sanitized;
        
        for tag in reserved_tags {
            let tag_pattern = format!(r"#{}\b", tag);
            if let Ok(re) = Regex::new(&tag_pattern) {
                result = re.replace_all(&result, "").to_string();
            }
        }

        result.trim().to_string()
    }
}

impl Default for Sanitizer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_secret() {
        let sanitizer = Sanitizer::new();
        assert!(sanitizer.contains_secrets("password = mysecretkey123"));
        assert!(sanitizer.contains_secrets("api_key: sk-1234567890abcdef"));
        assert!(!sanitizer.contains_secrets("just normal text"));
    }

    #[test]
    fn test_sanitize() {
        let sanitizer = Sanitizer::new();
        let result = sanitizer.sanitize("password = mysecretkey123");
        assert!(result.contains("[REDACTED]"));
        assert!(!result.contains("mysecretkey123"));
    }

    #[test]
    fn test_sanitize_preserves_normal_text() {
        let sanitizer = Sanitizer::new();
        let result = sanitizer.sanitize("The nginx server returned 502 error");
        assert_eq!(result, "The nginx server returned 502 error");
    }

    #[test]
    fn test_remove_reserved_tags() {
        let sanitizer = Sanitizer::new();
        let result = sanitizer.sanitize_memory_content("Error 502 #secret #private");
        assert!(!result.contains("#secret"));
        assert!(!result.contains("#private"));
    }
}
