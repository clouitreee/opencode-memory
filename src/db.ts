import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync, mkdirSync, readdirSync } from "fs";

const DATA_DIR = join(homedir(), ".opencode-memory");
const DB_PATH = join(DATA_DIR, "memory.db");
const MIGRATIONS_DIR = join(DATA_DIR, "migrations_state");

let db: Database | null = null;

export function getDB(): Database {
  if (db) return db;
  
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  
  db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  
  return db;
}

export function runMigrations(): void {
  const database = getDB();
  
  // Track which migrations have been run
  if (!existsSync(MIGRATIONS_DIR)) {
    mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }
  
  const migrations = [
    { name: "001_init.sql", embedded: MIGRATION_EMBEDDED },
    { name: "002_fixes_and_features.sql", embedded: MIGRATION_002_EMBEDDED }
  ];
  
  for (const migration of migrations) {
    const markerPath = join(MIGRATIONS_DIR, migration.name + ".done");
    
    if (!existsSync(markerPath)) {
      console.log(`[opencode-memory] Running migration: ${migration.name}`);
      
      const migrationPath = join(import.meta.dir, "..", "migrations", migration.name);
      
      try {
        if (existsSync(migrationPath)) {
          const sql = readFileSync(migrationPath, "utf-8");
          database.exec(sql);
        } else {
          database.exec(migration.embedded);
        }
        
        Bun.write(markerPath, new Date().toISOString());
      } catch (error) {
        console.error(`[opencode-memory] Migration ${migration.name} failed:`, error);
      }
    }
  }
}

export interface Session {
  id: number;
  opencode_session_id: string;
  project: string;
  directory: string | null;
  first_user_prompt: string | null;
  prompt_counter: number;
  status: string;
  scope: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Observation {
  id: number;
  session_id: number;
  prompt_number: number | null;
  tool_name: string;
  tool_input: string | null;
  tool_output: string | null;
  compressed_summary: string | null;
  observation_type: string | null;
  files_referenced: string | null;
  concepts: string | null;
  created_at: string;
}

export interface Summary {
  id: number;
  session_id: number;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  created_at: string;
}

export interface CompressionJob {
  id: number;
  observation_id: number;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface Concept {
  id: number;
  name: string;
  frequency: number;
  last_seen: string;
}

export interface UserObservation {
  id: number;
  observation_type: string;
  content: string;
  metadata: string | null;
  created_at: string;
  last_accessed: string;
  access_count: number;
}

export interface MemoryConfig {
  max_observations_per_project: number;
  max_observations_per_user: number;
  max_age_days: number;
  gc_enabled: boolean;
  gc_interval_hours: number;
}

// ============ SESSION OPERATIONS ============

export function createSession(
  opencodeSessionId: string, 
  project: string, 
  directory?: string,
  scope: "user" | "project" = "project"
): number {
  const database = getDB();
  
  const existing = database.prepare(`
    SELECT id FROM sessions WHERE opencode_session_id = ?
  `).get(opencodeSessionId) as { id: number } | undefined;
  
  if (existing) {
    database.prepare(`
      UPDATE sessions SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(existing.id);
    return existing.id;
  }
  
  const result = database.prepare(`
    INSERT INTO sessions (opencode_session_id, project, directory, scope)
    VALUES (?, ?, ?, ?)
    RETURNING id
  `).get(opencodeSessionId, project, directory || null, scope) as { id: number };
  
  return result.id;
}

export function getSessionId(opencodeSessionId: string): number | null {
  const database = getDB();
  const result = database.prepare(`
    SELECT id FROM sessions WHERE opencode_session_id = ?
  `).get(opencodeSessionId) as { id: number } | undefined;
  return result?.id ?? null;
}

export function getSession(opencodeSessionId: string): Session | null {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM sessions WHERE opencode_session_id = ?
  `).get(opencodeSessionId) as Session | null;
}

export function updateSessionPrompt(sessionId: number, prompt: string): number {
  const database = getDB();
  
  const session = database.prepare(`
    SELECT first_user_prompt, prompt_counter FROM sessions WHERE id = ?
  `).get(sessionId) as { first_user_prompt: string | null; prompt_counter: number } | undefined;
  
  if (!session) return 0;
  
  const promptNumber = session.prompt_counter + 1;
  
  if (!session.first_user_prompt) {
    database.prepare(`
      UPDATE sessions SET 
        first_user_prompt = ?,
        prompt_counter = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(prompt, promptNumber, sessionId);
  } else {
    database.prepare(`
      UPDATE sessions SET 
        prompt_counter = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(promptNumber, sessionId);
  }
  
  database.prepare(`
    INSERT INTO user_prompts (session_id, prompt_number, prompt)
    VALUES (?, ?, ?)
  `).run(sessionId, promptNumber, prompt);
  
  return promptNumber;
}

export function markSessionIdle(sessionId: number): void {
  const database = getDB();
  database.prepare(`
    UPDATE sessions SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(sessionId);
}

export function markSessionCompleted(sessionId: number): void {
  const database = getDB();
  database.prepare(`
    UPDATE sessions SET 
      status = 'completed', 
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(sessionId);
}

export function getRecentSessions(project: string, limit = 10): Session[] {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM sessions 
    WHERE project = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(project, limit) as Session[];
}

// ============ OBSERVATION OPERATIONS ============

export function saveObservation(
  sessionId: number,
  toolName: string,
  toolInput: string,
  toolOutput: string,
  promptNumber?: number
): number {
  const database = getDB();
  const result = database.prepare(`
    INSERT INTO observations (session_id, prompt_number, tool_name, tool_input, tool_output)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    sessionId,
    promptNumber ?? null,
    toolName,
    toolInput,
    toolOutput
  ) as { id: number };
  
  return result.id;
}

export function updateObservationSummary(
  observationId: number,
  summary: string,
  type?: string,
  files?: string[],
  concepts?: string[]
): void {
  const database = getDB();
  database.prepare(`
    UPDATE observations SET 
      compressed_summary = ?,
      observation_type = ?,
      files_referenced = ?,
      concepts = ?
    WHERE id = ?
  `).run(
    summary,
    type ?? null,
    files?.join(",") ?? null,
    concepts?.join(",") ?? null,
    observationId
  );
}

export function getRecentObservations(project: string, limit = 50): Observation[] {
  const database = getDB();
  return database.prepare(`
    SELECT o.* FROM observations o
    JOIN sessions s ON o.session_id = s.id
    WHERE s.project = ? AND o.compressed_summary IS NOT NULL
    ORDER BY o.created_at DESC
    LIMIT ?
  `).all(project, limit) as Observation[];
}

export function getUserObservations(limit = 50): UserObservation[] {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM user_observations
    ORDER BY last_accessed DESC
    LIMIT ?
  `).all(limit) as UserObservation[];
}

export function saveUserObservation(
  type: string,
  content: string,
  metadata?: Record<string, unknown>
): number {
  const database = getDB();
  const result = database.prepare(`
    INSERT INTO user_observations (observation_type, content, metadata)
    VALUES (?, ?, ?)
    RETURNING id
  `).get(type, content, metadata ? JSON.stringify(metadata) : null) as { id: number };
  
  return result.id;
}

// ============ SUMMARY OPERATIONS ============

export function saveSummary(
  sessionId: number,
  summary: {
    request?: string;
    investigated?: string;
    learned?: string;
    completed?: string;
    next_steps?: string;
  }
): void {
  const database = getDB();
  database.prepare(`
    INSERT INTO summaries (session_id, request, investigated, learned, completed, next_steps)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      request = excluded.request,
      investigated = excluded.investigated,
      learned = excluded.learned,
      completed = excluded.completed,
      next_steps = excluded.next_steps,
      created_at = CURRENT_TIMESTAMP
  `).run(
    sessionId,
    summary.request ?? null,
    summary.investigated ?? null,
    summary.learned ?? null,
    summary.completed ?? null,
    summary.next_steps ?? null
  );
}

export function getSessionSummaries(sessionId: number): Summary[] {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM summaries WHERE session_id = ?
  `).all(sessionId) as Summary[];
}

// ============ COMPRESSION QUEUE ============

export function queueCompression(observationId: number): number {
  const database = getDB();
  const result = database.prepare(`
    INSERT INTO compression_queue (observation_id)
    VALUES (?)
    RETURNING id
  `).get(observationId) as { id: number };
  
  return result.id;
}

export function getPendingCompressionJobs(limit = 10): CompressionJob[] {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM compression_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as CompressionJob[];
}

export function updateCompressionJob(
  jobId: number,
  status: string,
  error?: string
): void {
  const database = getDB();
  database.prepare(`
    UPDATE compression_queue SET 
      status = ?,
      last_error = ?,
      attempts = attempts + 1,
      processed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE processed_at END
    WHERE id = ?
  `).run(status, error ?? null, status, jobId);
}

// ============ CONCEPT GRAPH ============

export function upsertConcepts(concepts: string[]): void {
  const database = getDB();
  
  for (const concept of concepts) {
    database.prepare(`
      INSERT INTO concepts (name, frequency, last_seen)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        frequency = frequency + 1,
        last_seen = CURRENT_TIMESTAMP
    `).run(concept);
  }
}

export function linkObservationConcepts(observationId: number, conceptNames: string[]): void {
  const database = getDB();
  
  for (const name of conceptNames) {
    const concept = database.prepare(`
      SELECT id FROM concepts WHERE name = ?
    `).get(name) as { id: number } | undefined;
    
    if (concept) {
      database.prepare(`
        INSERT OR IGNORE INTO observation_concepts (observation_id, concept_id)
        VALUES (?, ?)
      `).run(observationId, concept.id);
    }
  }
}

export function getTopConcepts(limit = 20): Concept[] {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM concepts
    ORDER BY frequency DESC
    LIMIT ?
  `).all(limit) as Concept[];
}

export function getObservationsByConcept(conceptName: string, limit = 20): Observation[] {
  const database = getDB();
  return database.prepare(`
    SELECT o.* FROM observations o
    JOIN observation_concepts oc ON o.id = oc.observation_id
    JOIN concepts c ON oc.concept_id = c.id
    WHERE c.name = ?
    ORDER BY o.created_at DESC
    LIMIT ?
  `).all(conceptName, limit) as Observation[];
}

// ============ CONFIG ============

export function getSetting(key: string): string | null {
  const database = getDB();
  const result = database.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return result?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const database = getDB();
  database.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

export function getMemoryConfig(): MemoryConfig {
  const database = getDB();
  const config = database.prepare(`SELECT key, value FROM memory_config`).all() as Array<{ key: string; value: string }>;
  
  const result: MemoryConfig = {
    max_observations_per_project: 500,
    max_observations_per_user: 2000,
    max_age_days: 90,
    gc_enabled: true,
    gc_interval_hours: 24
  };
  
  for (const row of config) {
    if (row.key === "max_observations_per_project") {
      result.max_observations_per_project = parseInt(row.value, 10);
    } else if (row.key === "max_observations_per_user") {
      result.max_observations_per_user = parseInt(row.value, 10);
    } else if (row.key === "max_age_days") {
      result.max_age_days = parseInt(row.value, 10);
    } else if (row.key === "gc_enabled") {
      result.gc_enabled = row.value === "true";
    } else if (row.key === "gc_interval_hours") {
      result.gc_interval_hours = parseInt(row.value, 10);
    }
  }
  
  return result;
}

export function setMemoryConfig(config: Partial<MemoryConfig>): void {
  const database = getDB();
  
  const entries: Array<[string, string]> = [];
  
  if (config.max_observations_per_project !== undefined) {
    entries.push(["max_observations_per_project", String(config.max_observations_per_project)]);
  }
  if (config.max_observations_per_user !== undefined) {
    entries.push(["max_observations_per_user", String(config.max_observations_per_user)]);
  }
  if (config.max_age_days !== undefined) {
    entries.push(["max_age_days", String(config.max_age_days)]);
  }
  if (config.gc_enabled !== undefined) {
    entries.push(["gc_enabled", config.gc_enabled ? "true" : "false"]);
  }
  if (config.gc_interval_hours !== undefined) {
    entries.push(["gc_interval_hours", String(config.gc_interval_hours)]);
  }
  
  for (const [key, value] of entries) {
    database.prepare(`
      INSERT INTO memory_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  }
}

// ============ GARBAGE COLLECTION ============

export function runGarbageCollection(): {
  observationsDeleted: number;
  sessionsDeleted: number;
  userObservationsDeleted: number;
} {
  const database = getDB();
  const config = getMemoryConfig();
  
  if (!config.gc_enabled) {
    return { observationsDeleted: 0, sessionsDeleted: 0, userObservationsDeleted: 0 };
  }
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.max_age_days);
  const cutoffISO = cutoffDate.toISOString();
  
  // Delete old observations
  const obsResult = database.prepare(`
    DELETE FROM observations 
    WHERE created_at < ? 
    AND id NOT IN (
      SELECT id FROM observations ORDER BY created_at DESC LIMIT ?
    )
  `).run(cutoffISO, config.max_observations_per_project * 10);
  
  // Delete old sessions (cascade to observations)
  const sessionResult = database.prepare(`
    DELETE FROM sessions 
    WHERE status = 'completed' 
    AND completed_at < ?
  `).run(cutoffISO);
  
  // Delete old user observations
  const userObsResult = database.prepare(`
    DELETE FROM user_observations 
    WHERE created_at < ?
    AND id NOT IN (
      SELECT id FROM user_observations ORDER BY last_accessed DESC LIMIT ?
    )
  `).run(cutoffISO, config.max_observations_per_user);
  
  return {
    observationsDeleted: obsResult.changes,
    sessionsDeleted: sessionResult.changes,
    userObservationsDeleted: userObsResult.changes
  };
}

// ============ STATS ============

export function getStats(): {
  totalSessions: number;
  totalObservations: number;
  totalUserObservations: number;
  totalConcepts: number;
  pendingCompressions: number;
  oldestObservation: string | null;
} {
  const database = getDB();
  
  const sessions = database.prepare(`SELECT COUNT(*) as count FROM sessions`).get() as { count: number };
  const observations = database.prepare(`SELECT COUNT(*) as count FROM observations`).get() as { count: number };
  const userObs = database.prepare(`SELECT COUNT(*) as count FROM user_observations`).get() as { count: number };
  const concepts = database.prepare(`SELECT COUNT(*) as count FROM concepts`).get() as { count: number };
  const pending = database.prepare(`SELECT COUNT(*) as count FROM compression_queue WHERE status = 'pending'`).get() as { count: number };
  const oldest = database.prepare(`SELECT MIN(created_at) as oldest FROM observations`).get() as { oldest: string | null };
  
  return {
    totalSessions: sessions.count,
    totalObservations: observations.count,
    totalUserObservations: userObs.count,
    totalConcepts: concepts.count,
    pendingCompressions: pending.count,
    oldestObservation: oldest.oldest
  };
}

// ============ EMBEDDED MIGRATIONS ============

const MIGRATION_EMBEDDED = `
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opencode_session_id TEXT UNIQUE NOT NULL,
  project TEXT NOT NULL,
  directory TEXT,
  first_user_prompt TEXT,
  prompt_counter INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  scope TEXT DEFAULT 'project',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS user_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  prompt_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, prompt_number)
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  prompt_number INTEGER,
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  tool_output TEXT,
  compressed_summary TEXT,
  observation_type TEXT,
  files_referenced TEXT,
  concepts TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

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

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  id UNINDEXED, session_id UNINDEXED, tool_name, compressed_summary, files_referenced,
  content='observations', content_rowid='id', tokenize='porter unicode61'
);

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

CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  id UNINDEXED, session_id UNINDEXED, prompt,
  content='user_prompts', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON user_prompts BEGIN
  INSERT INTO prompts_fts(rowid, id, session_id, prompt)
  VALUES (new.id, new.id, new.session_id, new.prompt);
END;

CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON user_prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, id, session_id, prompt)
  VALUES('delete', old.id, old.id, old.session_id, old.prompt);
END;

CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE ON user_prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, id, session_id, prompt)
  VALUES('delete', old.id, old.id, old.session_id, old.prompt);
  INSERT INTO prompts_fts(rowid, id, session_id, prompt)
  VALUES (new.id, new.id, new.session_id, new.prompt);
END;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('model', 'openrouter/z-ai/glm-5'),
  ('max_observations_context', '50'),
  ('compression_enabled', 'true'),
  ('privacy_tags_enabled', 'true');
`;

const MIGRATION_002_EMBEDDED = `
CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  frequency INTEGER DEFAULT 1,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_concepts_name ON concepts(name);
CREATE INDEX IF NOT EXISTS idx_concepts_frequency ON concepts(frequency DESC);

CREATE TABLE IF NOT EXISTS observation_concepts (
  observation_id INTEGER NOT NULL,
  concept_id INTEGER NOT NULL,
  PRIMARY KEY (observation_id, concept_id),
  FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
  FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_obs_concepts_obs ON observation_concepts(observation_id);
CREATE INDEX IF NOT EXISTS idx_obs_concepts_concept ON observation_concepts(concept_id);

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

CREATE TABLE IF NOT EXISTS compression_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON compression_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_created ON compression_queue(created_at);
`;
