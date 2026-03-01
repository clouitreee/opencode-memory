import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { readFileSync, existsSync, mkdirSync } from "fs";

const DATA_DIR = join(homedir(), ".opencode-memory");
const DB_PATH = join(DATA_DIR, "memory.db");

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
  const migrationFile = join(import.meta.dir, "..", "migrations", "001_init.sql");
  
  if (existsSync(migrationFile)) {
    const migration = readFileSync(migrationFile, "utf-8");
    database.exec(migration);
  } else {
    database.exec(MIGRATION_EMBEDDED);
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

export function createSession(opencodeSessionId: string, project: string, directory?: string): number {
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
    INSERT INTO sessions (opencode_session_id, project, directory)
    VALUES (?, ?, ?)
    RETURNING id
  `).get(opencodeSessionId, project, directory || null) as { id: number };
  
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

export function saveObservation(
  sessionId: number,
  toolName: string,
  toolInput: unknown,
  toolOutput: unknown,
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
    JSON.stringify(toolInput),
    typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)
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

export function getRecentSessions(project: string, limit = 10): Session[] {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM sessions 
    WHERE project = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(project, limit) as Session[];
}

export function getSessionSummaries(sessionId: number): Summary[] {
  const database = getDB();
  return database.prepare(`
    SELECT * FROM summaries WHERE session_id = ?
  `).all(sessionId) as Summary[];
}

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

const MIGRATION_EMBEDDED = `
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opencode_session_id TEXT UNIQUE NOT NULL,
  project TEXT NOT NULL,
  directory TEXT,
  first_user_prompt TEXT,
  prompt_counter INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
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
