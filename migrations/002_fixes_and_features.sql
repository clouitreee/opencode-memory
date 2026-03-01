-- Migration 002: Bug fixes and new features
-- Run after 001_init.sql

-- Fix 1: prompt_counter DEFAULT 0 (not 1)
-- SQLite no permite ALTER COLUMN, así que recreamos la tabla
-- Pero como es migración nueva, asumimos que 001 no se ha corrido en producción

-- Fix 2: Drop problematic INSERT trigger for FTS5
DROP TRIGGER IF EXISTS observations_ai;

-- Fix 3: Create trigger that only inserts when compressed_summary is NOT NULL
CREATE TRIGGER IF NOT EXISTS observations_ai_after_update AFTER UPDATE OF compressed_summary ON observations
WHEN new.compressed_summary IS NOT NULL AND old.compressed_summary IS NULL
BEGIN
  INSERT INTO observations_fts(rowid, id, session_id, tool_name, compressed_summary, files_referenced)
  VALUES (new.id, new.id, new.session_id, new.tool_name, new.compressed_summary, new.files_referenced);
END;

-- Fix 4: Add prompts_fts UPDATE trigger
CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE ON user_prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, id, session_id, prompt)
  VALUES('delete', old.id, old.id, old.session_id, old.prompt);
  INSERT INTO prompts_fts(rowid, id, session_id, prompt)
  VALUES (new.id, new.id, new.session_id, new.prompt);
END;

-- Feature: Concepts table for concept graph with frequencies
CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  frequency INTEGER DEFAULT 1,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_concepts_name ON concepts(name);
CREATE INDEX IF NOT EXISTS idx_concepts_frequency ON concepts(frequency DESC);

-- Feature: Observation-Concept many-to-many relationship
CREATE TABLE IF NOT EXISTS observation_concepts (
  observation_id INTEGER NOT NULL,
  concept_id INTEGER NOT NULL,
  PRIMARY KEY (observation_id, concept_id),
  FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
  FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_obs_concepts_obs ON observation_concepts(observation_id);
CREATE INDEX IF NOT EXISTS idx_obs_concepts_concept ON observation_concepts(concept_id);

-- Feature: Memory scope (user vs project)
ALTER TABLE sessions ADD COLUMN scope TEXT DEFAULT 'project' CHECK(scope IN ('user', 'project'));

-- Feature: Memory metadata for garbage collection
CREATE TABLE IF NOT EXISTS memory_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO memory_config (key, value) VALUES 
  ('max_observations_per_project', '500'),
  ('max_observations_per_user', '2000'),
  ('max_age_days', '90'),
  ('gc_enabled', 'true'),
  ('gc_interval_hours', '24');

-- Feature: User-level observations (cross-project)
CREATE TABLE IF NOT EXISTS user_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_user_obs_type ON user_observations(observation_type);
CREATE INDEX IF NOT EXISTS idx_user_obs_created ON user_observations(created_at DESC);

-- Feature: FTS for user observations
CREATE VIRTUAL TABLE IF NOT EXISTS user_observations_fts USING fts5(
  id UNINDEXED,
  content,
  content='user_observations',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS user_obs_ai AFTER INSERT ON user_observations BEGIN
  INSERT INTO user_observations_fts(rowid, id, content)
  VALUES (new.id, new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS user_obs_ad AFTER DELETE ON user_observations BEGIN
  INSERT INTO user_observations_fts(user_observations_fts, rowid, id, content)
  VALUES('delete', old.id, old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS user_obs_au AFTER UPDATE ON user_observations BEGIN
  INSERT INTO user_observations_fts(user_observations_fts, rowid, id, content)
  VALUES('delete', old.id, old.id, old.content);
  INSERT INTO user_observations_fts(rowid, id, content)
  VALUES (new.id, new.id, new.content);
END;

-- Feature: Compression queue for async processing
CREATE TABLE IF NOT EXISTS compression_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON compression_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_created ON compression_queue(created_at);
