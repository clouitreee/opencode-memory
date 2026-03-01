import { tool } from "@opencode-ai/plugin";
import {
  searchObservations,
  searchSessions,
  searchPrompts,
  searchUserObservations,
  getObservationsByFile,
  getObservationsByType,
  formatContextForInjection,
  type SearchResult,
  type UserObservationResult
} from "../search";
import { 
  getRecentObservations, 
  getRecentSessions, 
  getTopConcepts,
  getObservationsByConcept,
  getUserObservations,
  getStats,
  type Observation 
} from "../db";

function obsToResult(obs: Observation[]): SearchResult[] {
  return obs.map(o => ({
    id: o.id,
    session_id: o.session_id,
    tool_name: o.tool_name,
    compressed_summary: o.compressed_summary || "",
    files_referenced: o.files_referenced,
    created_at: o.created_at,
    rank: 0,
    weighted_rank: 0
  }));
}

export const memSearchTool = tool({
  description: `Search through past session memory. Use this to find:
- Previous work on files, features, or bugs
- Decisions made in earlier sessions
- Patterns and discoveries from past conversations
- User-level preferences and patterns (cross-project)

Operations:
- search: Full-text search observations (with temporal decay)
- sessions: Search session summaries
- prompts: Search user prompts
- by_file: Find observations referencing a specific file
- by_type: Filter by observation type (decision, bugfix, feature, etc.)
- by_concept: Find observations by concept/tag
- concepts: List top concepts with frequencies
- recent: Get recent observations for current project
- user: Get user-level memories (cross-project preferences)
- stats: Get memory statistics`,

  args: {
    operation: tool.schema.enum([
      "search", 
      "sessions", 
      "prompts", 
      "by_file", 
      "by_type",
      "by_concept",
      "concepts",
      "recent",
      "user",
      "timeline",
      "stats"
    ]),
    query: tool.schema.string().optional().describe("Search query for text search operations"),
    file_path: tool.schema.string().optional().describe("File path for by_file operation"),
    type: tool.schema.enum([
      "decision", "bugfix", "feature", "refactor", 
      "discovery", "pattern", "change", "note"
    ]).optional().describe("Observation type for by_type operation"),
    concept: tool.schema.string().optional().describe("Concept name for by_concept operation"),
    limit: tool.schema.number().optional().default(10).describe("Maximum results to return"),
    project: tool.schema.string().optional().describe("Project to search within (defaults to current)"),
  },

  async execute(args, context) {
    const project = args.project || context.directory.split("/").pop() || "default";
    const limit = args.limit || 10;
    
    let output = "";
    
    switch (args.operation) {
      case "search": {
        if (!args.query) {
          return "Error: query is required for search operation";
        }
        const results = searchObservations(args.query, project, limit);
        output = formatResults(results, `Search results for: "${args.query}"`);
        break;
      }
      
      case "sessions": {
        const sessions = args.query 
          ? searchSessions(args.query, project, limit)
          : getRecentSessions(project, limit);
        output = formatSessionResults(sessions);
        break;
      }
      
      case "prompts": {
        if (!args.query) {
          return "Error: query is required for prompts operation";
        }
        const prompts = searchPrompts(args.query, project, limit);
        output = formatPromptResults(prompts);
        break;
      }
      
      case "by_file": {
        if (!args.file_path) {
          return "Error: file_path is required for by_file operation";
        }
        const results = getObservationsByFile(args.file_path, project, limit);
        output = formatResults(results, `Observations for file: ${args.file_path}`);
        break;
      }
      
      case "by_type": {
        if (!args.type) {
          return "Error: type is required for by_type operation";
        }
        const results = getObservationsByType(args.type, project, limit);
        output = formatResults(results, `Observations of type: ${args.type}`);
        break;
      }
      
      case "by_concept": {
        if (!args.concept) {
          return "Error: concept is required for by_concept operation";
        }
        const obs = getObservationsByConcept(args.concept, limit);
        const results = obsToResult(obs);
        output = formatResults(results, `Observations tagged with: ${args.concept}`);
        break;
      }
      
      case "concepts": {
        const concepts = getTopConcepts(limit);
        output = formatConceptResults(concepts);
        break;
      }
      
      case "recent": {
        const obs = getRecentObservations(project, limit);
        const results = obsToResult(obs);
        output = formatResults(results, "Recent observations");
        break;
      }
      
      case "user": {
        if (args.query) {
          const results = searchUserObservations(args.query, limit);
          output = formatUserObsResults(results);
        } else {
          const userObs = getUserObservations(limit);
          output = formatUserObsList(userObs);
        }
        break;
      }
      
      case "stats": {
        const stats = getStats();
        output = formatStats(stats);
        break;
      }
      
      case "timeline": {
        return "Timeline operation requires a session ID - use 'recent' or 'search' first to find relevant sessions";
      }
      
      default:
        return `Unknown operation: ${args.operation}`;
    }
    
    return output || "No results found";
  }
});

function formatResults(results: SearchResult[], title: string): string {
  if (results.length === 0) {
    return `${title}\n\nNo results found.`;
  }
  
  const lines = [`## ${title}`, ""];
  
  for (const r of results) {
    const date = new Date(r.created_at).toLocaleDateString();
    lines.push(`### [${date}] ${r.tool_name}`);
    lines.push(`${r.compressed_summary}`);
    if (r.files_referenced) {
      lines.push(`**Files:** ${r.files_referenced}`);
    }
    if (r.weighted_rank > 0) {
      lines.push(`*Relevance: ${r.weighted_rank.toFixed(2)}*`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

function formatSessionResults(sessions: Array<{
  id: number;
  opencode_session_id: string;
  project: string;
  first_user_prompt: string | null;
  status: string;
  created_at: string;
}>): string {
  if (sessions.length === 0) {
    return "No sessions found.";
  }
  
  const lines = ["## Sessions", ""];
  
  for (const s of sessions) {
    const date = new Date(s.created_at).toLocaleDateString();
    lines.push(`### [${date}] ${s.status}`);
    lines.push(`**Prompt:** ${s.first_user_prompt || "N/A"}`);
    lines.push("");
  }
  
  return lines.join("\n");
}

function formatPromptResults(prompts: Array<{
  id: number;
  session_id: number;
  prompt_number: number;
  prompt: string;
  created_at: string;
}>): string {
  if (prompts.length === 0) {
    return "No prompts found.";
  }
  
  const lines = ["## User Prompts", ""];
  
  for (const p of prompts) {
    const date = new Date(p.created_at).toLocaleDateString();
    lines.push(`### [${date}] Prompt #${p.prompt_number}`);
    lines.push(p.prompt);
    lines.push("");
  }
  
  return lines.join("\n");
}

function formatConceptResults(concepts: Array<{
  id: number;
  name: string;
  frequency: number;
  last_seen: string;
}>): string {
  if (concepts.length === 0) {
    return "No concepts found.";
  }
  
  const lines = ["## Top Concepts", ""];
  
  for (const c of concepts) {
    lines.push(`- **${c.name}** (${c.frequency} occurrences)`);
  }
  
  return lines.join("\n");
}

function formatUserObsResults(results: UserObservationResult[]): string {
  if (results.length === 0) {
    return "No user-level memories found.";
  }
  
  const lines = ["## User Memories (Search Results)", ""];
  
  for (const r of results) {
    lines.push(`### [${r.observation_type}]`);
    lines.push(r.content);
    if (r.metadata) {
      try {
        const meta = JSON.parse(r.metadata);
        lines.push(`*Context: ${JSON.stringify(meta)}*`);
      } catch {}
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

function formatUserObsList(observations: Array<{
  id: number;
  observation_type: string;
  content: string;
  metadata: string | null;
  created_at: string;
  last_accessed: string;
  access_count: number;
}>): string {
  if (observations.length === 0) {
    return "No user-level memories stored.";
  }
  
  const lines = ["## User Memories (Cross-Project)", ""];
  lines.push("These are preferences and patterns learned across all projects:");
  lines.push("");
  
  for (const o of observations) {
    lines.push(`- [${o.observation_type}] ${o.content}`);
  }
  
  return lines.join("\n");
}

function formatStats(stats: {
  totalSessions: number;
  totalObservations: number;
  totalUserObservations: number;
  totalConcepts: number;
  pendingCompressions: number;
  oldestObservation: string | null;
}): string {
  const lines = [
    "## Memory Statistics",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Sessions | ${stats.totalSessions} |`,
    `| Total Observations | ${stats.totalObservations} |`,
    `| User Memories | ${stats.totalUserObservations} |`,
    `| Concepts | ${stats.totalConcepts} |`,
    `| Pending Compressions | ${stats.pendingCompressions} |`,
    `| Oldest Observation | ${stats.oldestObservation || "N/A"} |`,
  ];
  
  return lines.join("\n");
}
