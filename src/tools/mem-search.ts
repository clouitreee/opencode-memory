import { tool } from "@opencode-ai/plugin";
import {
  searchObservations,
  searchSessions,
  searchPrompts,
  getObservationsByFile,
  getObservationsByType,
  formatContextForInjection,
  type SearchResult
} from "../search";
import { getRecentObservations, getRecentSessions, type Observation } from "../db";

function obsToResult(obs: Observation[]): SearchResult[] {
  return obs.map(o => ({
    id: o.id,
    session_id: o.session_id,
    tool_name: o.tool_name,
    compressed_summary: o.compressed_summary || "",
    files_referenced: o.files_referenced,
    created_at: o.created_at,
    rank: 0
  }));
}

export const memSearchTool = tool({
  description: `Search through past session memory. Use this to find:
- Previous work on files, features, or bugs
- Decisions made in earlier sessions
- Patterns and discoveries from past conversations

Call this when the user asks about work done previously, or when context from past sessions would help.

Operations:
- search: Full-text search observations
- sessions: Search session summaries
- prompts: Search user prompts
- by_file: Find observations referencing a specific file
- by_type: Filter by observation type (decision, bugfix, feature, refactor, discovery, pattern, change, note)
- recent: Get recent observations for current project
- timeline: Get context around a specific session`,

  args: {
    operation: tool.schema.enum([
      "search", 
      "sessions", 
      "prompts", 
      "by_file", 
      "by_type", 
      "recent",
      "timeline"
    ]),
    query: tool.schema.string().optional().describe("Search query for text search operations"),
    file_path: tool.schema.string().optional().describe("File path for by_file operation"),
    type: tool.schema.enum([
      "decision", "bugfix", "feature", "refactor", 
      "discovery", "pattern", "change", "note"
    ]).optional().describe("Observation type for by_type operation"),
    limit: tool.schema.number().optional().default(10).describe("Maximum results to return"),
    project: tool.schema.string().optional().describe("Project to search within (defaults to current)"),
  },

  async execute(args, context) {
    const project = args.project || context.directory.split("/").pop() || "default";
    const limit = args.limit || 10;
    
    let results: SearchResult[] = [];
    let output = "";
    
    switch (args.operation) {
      case "search": {
        if (!args.query) {
          return "Error: query is required for search operation";
        }
        results = searchObservations(args.query, project, limit);
        output = formatResults(results, `Search results for: "${args.query}"`);
        break;
      }
      
      case "sessions": {
        if (!args.query) {
          const sessions = getRecentSessions(project, limit);
          output = formatSessionResults(sessions);
        } else {
          const sessions = searchSessions(args.query, project, limit);
          output = formatSessionResults(sessions);
        }
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
        results = getObservationsByFile(args.file_path, project, limit);
        output = formatResults(results, `Observations for file: ${args.file_path}`);
        break;
      }
      
      case "by_type": {
        if (!args.type) {
          return "Error: type is required for by_type operation";
        }
        results = getObservationsByType(args.type, project, limit);
        output = formatResults(results, `Observations of type: ${args.type}`);
        break;
      }
      
      case "recent": {
        results = obsToResult(getRecentObservations(project, limit));
        output = formatResults(results, "Recent observations");
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
