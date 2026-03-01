-- opencode-memory schema v1
-- Sessions, observations, and summaries with FTS5 search

-- Main sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opencode_session_id TEXT UNIQUE NOT NULL,
  project TEXT NOT NULL,
  directory TEXT,
  first_user_prompt TEXT,
  prompt_counter INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'idle', 'completed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);

-- User prompts within sessions
CREATE TABLE IF NOT EXISTS user_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  prompt_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, prompt_number)
);

CREATE INDEX IF NOT EXISTS idx_prompts_session ON user_prompts(session_id);

-- Tool observations (compressed by AI)
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  prompt_number INTEGER,
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  tool_output TEXT,
  compressed_summary TEXT,
  observation_type TEXT CHECK(observation_type IN (
    'decision', 'bugfix', 'feature', 'refactor', 
    'discovery', 'pattern', 'change', 'note'
  )),
  files_referenced TEXT,
  concepts TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_obs_tool ON observations(tool_name);
CREATE INDEX IF NOT EXISTS idx_obs_type ON observations(observation_type);
CREATE INDEX IF NOT EXISTS idx_obs_created ON observations(created_at DESC);

-- Session summaries (generated on idle)
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL UNIQUE,
  request TEXT,
  investigated TEXT,
  learned TEXT,
  completed TEXT,
  next_steps TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- FTS5 virtual tables for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  id UNINDEXED,
  session_id UNINDEXED,
  tool_name,
  compressed_summary,
  files_referenced,
  content='observations',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- FTS5 triggers to keep search index in sync
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, id, session_id, tool_name, compressed_summary, files_referenced)
  VALUES (new.id, new.id, new.session_id, new.tool_name, new.compressed_summary, new.files_referenced);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, id, session_id, tool_name, compressed_summary, files_referenced)
  VALUES('delete', old.id, old.id, old.session_id, old.tool_name, old.compressed_summary, old.files_referenced);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, id, session_id, tool_name, compressed_summary, files_referenced)
  VALUES('delete', old.id, old.id, old.session_id, old.tool_name, old.compressed_summary, old.files_referenced);
  INSERT INTO observations_fts(rowid, id, session_id, tool_name, compressed_summary, files_referenced)
  VALUES (new.id, new.id, new.session_id, new.tool_name, new.compressed_summary, new.files_referenced);
END;

-- Prompts FTS
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  id UNINDEXED,
  session_id UNINDEXED,
  prompt,
  content='user_prompts',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON user_prompts BEGIN
  INSERT INTO prompts_fts(rowid, id, session_id, prompt)
  VALUES (new.id, new.id, new.session_id, new.prompt);
END;

CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON user_prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, id, session_id, prompt)
  VALUES('delete', old.id, old.id, old.session_id, old.prompt);
END;

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('model', 'openrouter/z-ai/glm-5'),
  ('max_observations_context', '50'),
  ('compression_enabled', 'true'),
  ('privacy_tags_enabled', 'true');
