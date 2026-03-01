import { getDB, type Observation } from "./db";

export interface SearchResult {
  id: number;
  session_id: number;
  tool_name: string;
  compressed_summary: string;
  files_referenced: string | null;
  created_at: string;
  rank: number;
}

export interface SessionSearchResult {
  id: number;
  opencode_session_id: string;
  project: string;
  first_user_prompt: string | null;
  status: string;
  created_at: string;
  rank: number;
}

export interface PromptSearchResult {
  id: number;
  session_id: number;
  prompt_number: number;
  prompt: string;
  created_at: string;
  rank: number;
}

function obsToSearchResult(obs: Observation): SearchResult {
  return {
    id: obs.id,
    session_id: obs.session_id,
    tool_name: obs.tool_name,
    compressed_summary: obs.compressed_summary || "",
    files_referenced: obs.files_referenced,
    created_at: obs.created_at,
    rank: 0
  };
}

export function searchObservations(query: string, project?: string, limit = 20): SearchResult[] {
  const database = getDB();
  
  const searchTerms = query
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `${t}*`)
    .join(" OR ");
  
  try {
    if (project) {
      const stmt = database.prepare(`
        SELECT 
          o.id, o.session_id, o.tool_name, o.compressed_summary, 
          o.files_referenced, o.created_at,
          bm25(observations_fts) as rank
        FROM observations_fts
        JOIN observations o ON observations_fts.id = o.id
        JOIN sessions s ON o.session_id = s.id
        WHERE observations_fts MATCH ? AND s.project = ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(searchTerms, project, limit) as SearchResult[];
    } else {
      const stmt = database.prepare(`
        SELECT 
          o.id, o.session_id, o.tool_name, o.compressed_summary, 
          o.files_referenced, o.created_at,
          bm25(observations_fts) as rank
        FROM observations_fts
        JOIN observations o ON observations_fts.id = o.id
        WHERE observations_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(searchTerms, limit) as SearchResult[];
    }
  } catch {
    return [];
  }
}

export function searchSessions(query: string, project?: string, limit = 10): SessionSearchResult[] {
  const database = getDB();
  const searchPattern = `%${query}%`;
  
  if (project) {
    const stmt = database.prepare(`
      SELECT 
        s.id, s.opencode_session_id, s.project, s.first_user_prompt, 
        s.status, s.created_at, 0 as rank
      FROM sessions s
      WHERE s.first_user_prompt LIKE ? AND s.project = ?
      ORDER BY s.created_at DESC
      LIMIT ?
    `);
    return stmt.all(searchPattern, project, limit) as SessionSearchResult[];
  } else {
    const stmt = database.prepare(`
      SELECT 
        s.id, s.opencode_session_id, s.project, s.first_user_prompt, 
        s.status, s.created_at, 0 as rank
      FROM sessions s
      WHERE s.first_user_prompt LIKE ?
      ORDER BY s.created_at DESC
      LIMIT ?
    `);
    return stmt.all(searchPattern, limit) as SessionSearchResult[];
  }
}

export function searchPrompts(query: string, project?: string, limit = 20): PromptSearchResult[] {
  const database = getDB();
  
  const searchTerms = query
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `${t}*`)
    .join(" OR ");
  
  try {
    if (project) {
      const stmt = database.prepare(`
        SELECT 
          p.id, p.session_id, p.prompt_number, p.prompt, p.created_at,
          bm25(prompts_fts) as rank
        FROM prompts_fts
        JOIN user_prompts p ON prompts_fts.id = p.id
        JOIN sessions s ON p.session_id = s.id
        WHERE prompts_fts MATCH ? AND s.project = ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(searchTerms, project, limit) as PromptSearchResult[];
    } else {
      const stmt = database.prepare(`
        SELECT 
          p.id, p.session_id, p.prompt_number, p.prompt, p.created_at,
          bm25(prompts_fts) as rank
        FROM prompts_fts
        JOIN user_prompts p ON prompts_fts.id = p.id
        WHERE prompts_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(searchTerms, limit) as PromptSearchResult[];
    }
  } catch {
    return [];
  }
}

export function getObservationsByFile(filePath: string, project?: string, limit = 20): SearchResult[] {
  const database = getDB();
  const filePattern = `%${filePath}%`;
  
  if (project) {
    const stmt = database.prepare(`
      SELECT 
        o.id, o.session_id, o.tool_name, o.compressed_summary,
        o.files_referenced, o.created_at, 0 as rank
      FROM observations o
      JOIN sessions s ON o.session_id = s.id
      WHERE o.files_referenced LIKE ? AND s.project = ?
      ORDER BY o.created_at DESC
      LIMIT ?
    `);
    return stmt.all(filePattern, project, limit) as SearchResult[];
  } else {
    const stmt = database.prepare(`
      SELECT 
        o.id, o.session_id, o.tool_name, o.compressed_summary,
        o.files_referenced, o.created_at, 0 as rank
      FROM observations o
      WHERE o.files_referenced LIKE ?
      ORDER BY o.created_at DESC
      LIMIT ?
    `);
    return stmt.all(filePattern, limit) as SearchResult[];
  }
}

export function getObservationsByType(
  type: string, 
  project?: string, 
  limit = 20
): SearchResult[] {
  const database = getDB();
  
  if (project) {
    const stmt = database.prepare(`
      SELECT 
        o.id, o.session_id, o.tool_name, o.compressed_summary,
        o.files_referenced, o.created_at, 0 as rank
      FROM observations o
      JOIN sessions s ON o.session_id = s.id
      WHERE o.observation_type = ? AND s.project = ?
      ORDER BY o.created_at DESC
      LIMIT ?
    `);
    return stmt.all(type, project, limit) as SearchResult[];
  } else {
    const stmt = database.prepare(`
      SELECT 
        o.id, o.session_id, o.tool_name, o.compressed_summary,
        o.files_referenced, o.created_at, 0 as rank
      FROM observations o
      WHERE o.observation_type = ?
      ORDER BY o.created_at DESC
      LIMIT ?
    `);
    return stmt.all(type, limit) as SearchResult[];
  }
}

export function getTimeline(aroundSessionId: number, before = 5, after = 5): {
  before: SearchResult[];
  after: SearchResult[];
} {
  const database = getDB();
  
  const session = database.prepare(`
    SELECT created_at FROM sessions WHERE id = ?
  `).get(aroundSessionId) as { created_at: string } | undefined;
  
  if (!session) {
    return { before: [], after: [] };
  }
  
  const beforeStmt = database.prepare(`
    SELECT 
      o.id, o.session_id, o.tool_name, o.compressed_summary,
      o.files_referenced, o.created_at, 0 as rank
    FROM observations o
    WHERE o.created_at < ? AND o.compressed_summary IS NOT NULL
    ORDER BY o.created_at DESC
    LIMIT ?
  `);
  const beforeObs = beforeStmt.all(session.created_at, before) as SearchResult[];
  
  const afterStmt = database.prepare(`
    SELECT 
      o.id, o.session_id, o.tool_name, o.compressed_summary,
      o.files_referenced, o.created_at, 0 as rank
    FROM observations o
    WHERE o.created_at > ? AND o.compressed_summary IS NOT NULL
    ORDER BY o.created_at ASC
    LIMIT ?
  `);
  const afterObs = afterStmt.all(session.created_at, after) as SearchResult[];
  
  return { before: beforeObs, after: afterObs };
}

export function formatContextForInjection(observations: Observation[] | SearchResult[]): string {
  if (observations.length === 0) return "";
  
  const lines = [
    "## Previous Session Context",
    "",
    "Relevant observations from past sessions:",
    ""
  ];
  
  for (const obs of observations.slice(0, 10)) {
    const date = new Date(obs.created_at).toLocaleDateString();
    const summary = "compressed_summary" in obs ? obs.compressed_summary : "";
    lines.push(`- [${date}] **${obs.tool_name}**: ${summary}`);
    if (obs.files_referenced) {
      lines.push(`  Files: ${obs.files_referenced}`);
    }
  }
  
  lines.push("");
  return lines.join("\n");
}
