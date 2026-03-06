use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    ErrorResolution,
    Config,
    Preference,
    Decision,
    Project,
    Command,
    ToolUsage,
}

impl Default for MemoryType {
    fn default() -> Self {
        Self::Command
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportanceLevel {
    Critical = 1,
    High = 2,
    Medium = 3,
    Low = 4,
}

impl ImportanceLevel {
    pub fn as_float(&self) -> f32 {
        match self {
            Self::Critical => 1.0,
            Self::High => 0.8,
            Self::Medium => 0.6,
            Self::Low => 0.4,
        }
    }
}

impl Default for ImportanceLevel {
    fn default() -> Self {
        Self::Medium
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub content: String,
    pub memory_type: MemoryType,
    pub importance: f32,
    pub importance_level: ImportanceLevel,
    pub created_at: DateTime<Utc>,
    pub project: Option<String>,
    pub session_id: Option<String>,
    pub access_count: u32,
    pub last_accessed: Option<DateTime<Utc>>,
    pub tags: Vec<String>,
    #[serde(skip)]
    pub embedding: Option<Vec<f32>>,
    pub schema_version: u32,
}

impl Memory {
    pub fn new(
        content: String,
        memory_type: MemoryType,
        importance_level: ImportanceLevel,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            content,
            memory_type,
            importance: importance_level.as_float(),
            importance_level,
            created_at: Utc::now(),
            project: None,
            session_id: None,
            access_count: 0,
            last_accessed: None,
            tags: Vec::new(),
            embedding: None,
            schema_version: 1,
        }
    }

    pub fn with_project(mut self, project: impl Into<String>) -> Self {
        self.project = Some(project.into());
        self
    }

    pub fn with_session(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    pub fn with_embedding(mut self, embedding: Vec<f32>) -> Self {
        self.embedding = Some(embedding);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub storage_path: Option<String>,
    pub default_project: Option<String>,
    pub importance_threshold: f32,
}

impl Config {
    pub fn storage_dir(&self) -> Option<&str> {
        self.storage_path.as_deref()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Project {
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub memory_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Stats {
    pub total_memories: u32,
    pub by_type: std::collections::HashMap<String, u32>,
    pub current_session: Option<String>,
    pub project: Option<String>,
}