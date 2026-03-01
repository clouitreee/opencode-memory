import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import {
  getDB,
  runMigrations,
  createSession,
  getSessionId,
  updateSessionPrompt,
  saveObservation,
  updateObservationSummary,
  saveSummary,
  markSessionIdle,
  markSessionCompleted,
  getRecentObservations,
  getSetting,
  getMemoryConfig,
  queueCompression,
  getPendingCompressionJobs,
  updateCompressionJob,
  upsertConcepts,
  linkObservationConcepts,
  saveUserObservation,
  getUserObservations,
  runGarbageCollection,
  getStats
} from "./db";
import { getSDK } from "./sdk";
import { smartContextInjection, formatContextForInjection, searchUserObservations } from "./search";
import { stripAllMemoryTags, isFullyPrivate, truncateInput, truncateOutput } from "./privacy";
import { 
  redactSecrets, 
  getSecurityConfig, 
  logRedaction,
  type ToolContext 
} from "./secrets";
import { memSearchTool } from "./tools/mem-search";

const SKIP_TOOLS = new Set([
  "AskQuestion",
  "TodoWrite",
  "ListMcpResourcesTool",
  "Skill"
]);

let initialized = false;
let compressionWorkerRunning = false;
let lastGcRun = 0;

function ensureInitialized(): void {
  if (!initialized) {
    runMigrations();
    initialized = true;
  }
}

function getSessionIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  
  const e = event as Record<string, unknown>;
  const props = e.properties as Record<string, unknown> | undefined;
  
  if (props?.sessionID && typeof props.sessionID === "string") {
    return props.sessionID;
  }
  if (props?.info && typeof props.info === "object") {
    const info = props.info as Record<string, unknown>;
    if (info.id && typeof info.id === "string") {
      return info.id;
    }
  }
  if (props?.id && typeof props.id === "string") {
    return props.id;
  }
  
  return null;
}

async function processCompressionQueue(): Promise<void> {
  if (compressionWorkerRunning) return;
  compressionWorkerRunning = true;
  
  try {
    const jobs = getPendingCompressionJobs(5);
    const sdk = getSDK();
    const db = getDB();
    
    for (const job of jobs) {
      try {
        updateCompressionJob(job.id, "processing");
        
        const obs = db.prepare(`
          SELECT * FROM observations WHERE id = ?
        `).get(job.observation_id) as {
          id: number;
          tool_name: string;
          tool_input: string;
          tool_output: string;
        } | undefined;
        
        if (!obs) {
          updateCompressionJob(job.id, "failed", "Observation not found");
          continue;
        }
        
        const compressed = await sdk.compressObservation(
          obs.tool_name,
          JSON.parse(obs.tool_input || "{}"),
          obs.tool_output
        );
        
        updateObservationSummary(
          obs.id,
          compressed.summary,
          compressed.type,
          compressed.files,
          compressed.concepts
        );
        
        if (compressed.concepts.length > 0) {
          upsertConcepts(compressed.concepts);
          linkObservationConcepts(obs.id, compressed.concepts);
        }
        
        updateCompressionJob(job.id, "completed");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        updateCompressionJob(job.id, "failed", errorMsg);
      }
    }
  } finally {
    compressionWorkerRunning = false;
  }
}

async function maybeRunGarbageCollection(): Promise<void> {
  const config = getMemoryConfig();
  const now = Date.now();
  const intervalMs = config.gc_interval_hours * 60 * 60 * 1000;
  
  if (config.gc_enabled && now - lastGcRun > intervalMs) {
    lastGcRun = now;
    const stats = runGarbageCollection();
    if (stats.observationsDeleted > 0 || stats.sessionsDeleted > 0) {
      console.log("[opencode-memory] GC:", stats);
    }
  }
}

async function extractUserLevelMemory(observations: string[]): Promise<void> {
  if (observations.length === 0) return;
  
  try {
    const sdk = getSDK();
    const userMemory = await sdk.extractUserMemory(observations);
    
    if (userMemory) {
      saveUserObservation(userMemory.type, userMemory.content, userMemory.metadata);
    }
  } catch (error) {
    console.error("[opencode-memory] User memory extraction failed:", error);
  }
}

export const OpenCodeMemoryPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const { project, directory, client } = input;
  const projectName = directory.split("/").pop() || project.id || "default";
  
  ensureInitialized();
  
  const db = getDB();
  const compressionEnabled = getSetting("compression_enabled") !== "false";
  const maxObservations = parseInt(getSetting("max_observations_context") || "50", 10);
  const securityConfig = getSecurityConfig();
  
  const activeSessions = new Map<string, { dbId: number; promptNumber: number; observations: string[] }>();
  
  await client.app.log({
    body: {
      service: "opencode-memory",
      level: "info",
      message: `Plugin initialized for project: ${projectName} (security: ${securityConfig.enabled ? "enabled" : "disabled"})`,
    }
  });

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.created": {
          const sessionId = getSessionIdFromEvent(event);
          if (!sessionId) {
            console.error("[opencode-memory] Could not extract session ID from session.created event");
            break;
          }
          
          ensureInitialized();
          
          const dbId = createSession(sessionId, projectName, directory);
          activeSessions.set(sessionId, { dbId, promptNumber: 0, observations: [] });
          
          const recentObs = smartContextInjection(projectName, undefined, maxObservations);
          const userObs = getUserObservations(5);
          
          let context = formatContextForInjection(recentObs);
          
          if (userObs.length > 0) {
            context += "\n## User Preferences\n\n";
            for (const uo of userObs) {
              context += `- [${uo.observation_type}] ${uo.content}\n`;
            }
          }
          
          if (context) {
            await client.app.log({
              body: {
                service: "opencode-memory",
                level: "info",
                message: `Injected ${recentObs.length} observations + ${userObs.length} user memories`,
              }
            });
          }
          
          maybeRunGarbageCollection();
          break;
        }
        
        case "session.idle": {
          const sessionId = getSessionIdFromEvent(event);
          if (!sessionId) break;
          
          const session = activeSessions.get(sessionId);
          
          if (session) {
            markSessionIdle(session.dbId);
            
            if (compressionEnabled && session.observations.length > 0) {
              const prompts = db.prepare(`
                SELECT prompt FROM user_prompts 
                WHERE session_id = $sessionId 
                ORDER BY prompt_number
              `).all({ sessionId: session.dbId }) as Array<{ prompt: string }>;
              
              const sdk = getSDK();
              const summary = await sdk.summarizeSession(
                prompts.map(p => p.prompt),
                session.observations
              );
              
              saveSummary(session.dbId, summary);
              
              if (session.observations.length >= 3) {
                extractUserLevelMemory(session.observations);
              }
              
              await client.app.log({
                body: {
                  service: "opencode-memory",
                  level: "info",
                  message: "Generated session summary on idle",
                }
              });
            }
          }
          break;
        }
        
        case "session.deleted": {
          const sessionId = getSessionIdFromEvent(event);
          if (!sessionId) break;
          
          const session = activeSessions.get(sessionId);
          
          if (session) {
            markSessionCompleted(session.dbId);
            activeSessions.delete(sessionId);
          }
          break;
        }
        
        case "session.compacted": {
          const sessionId = getSessionIdFromEvent(event);
          if (!sessionId) break;
          
          const session = activeSessions.get(sessionId);
          
          if (session) {
            markSessionIdle(session.dbId);
          }
          break;
        }
      }
    },
    
    "chat.message": async (input, output) => {
      const sessionId = input.sessionID;
      let session = activeSessions.get(sessionId);
      
      if (!session) {
        ensureInitialized();
        const dbId = createSession(sessionId, projectName, directory);
        session = { dbId, promptNumber: 0, observations: [] };
        activeSessions.set(sessionId, session);
      }
      
      const messages = output.parts.filter(p => p.type === "text");
      for (const part of messages) {
        if ("text" in part && part.text) {
          let cleanedText = stripAllMemoryTags(part.text);
          
          if (securityConfig.enabled) {
            const redacted = redactSecrets(cleanedText, { toolName: "user_prompt", toolInput: {} }, securityConfig);
            
            if (redacted.redactedCount > 0) {
              await client.app.log({
                body: {
                  service: "opencode-memory",
                  level: "warn",
                  message: `Redacted ${redacted.redactedCount} secrets from user prompt`,
                }
              });
              cleanedText = redacted.text;
            }
          }
          
          if (!isFullyPrivate(cleanedText)) {
            const promptNumber = updateSessionPrompt(session.dbId, cleanedText);
            session.promptNumber = promptNumber;
          }
        }
      }
    },
    
    "tool.execute.after": async (input, output) => {
      if (SKIP_TOOLS.has(input.tool)) return;
      
      const sessionId = input.sessionID;
      let session = activeSessions.get(sessionId);
      
      if (!session) {
        ensureInitialized();
        const dbId = createSession(sessionId, projectName, directory);
        session = { dbId, promptNumber: 0, observations: [] };
        activeSessions.set(sessionId, session);
      }
      
      const securityContext: ToolContext = {
        toolName: input.tool,
        toolInput: input.args || {}
      };
      
      const inputStr = truncateInput(stripAllMemoryTags(JSON.stringify(input.args || {})));
      const outputStr = truncateOutput(stripAllMemoryTags(
        typeof output.output === "string" ? output.output : JSON.stringify(output.output)
      ));
      
      let finalInput = inputStr;
      let finalOutput = outputStr;
      let redactedCount = 0;
      
      if (securityConfig.enabled) {
        const redactedInput = redactSecrets(inputStr, securityContext, securityConfig);
        const redactedOutput = redactSecrets(outputStr, securityContext, securityConfig);
        
        finalInput = redactedInput.text;
        finalOutput = redactedOutput.text;
        redactedCount = redactedInput.redactedCount + redactedOutput.redactedCount;
        
        if (redactedCount > 0) {
          await client.app.log({
            body: {
              service: "opencode-memory",
              level: "warn",
              message: `Redacted ${redactedCount} secrets from ${input.tool}`,
            }
          });
          
          console.warn(`[opencode-memory] Security: Redacted ${redactedCount} potential secrets from ${input.tool} tool`);
        }
      }
      
      if (isFullyPrivate(finalOutput)) return;
      
      const obsId = saveObservation(
        session.dbId,
        input.tool,
        finalInput,
        finalOutput,
        session.promptNumber
      );
      
      session.observations.push(`${input.tool}: ${finalInput.slice(0, 200)}`);
      
      if (compressionEnabled) {
        queueCompression(obsId);
        setTimeout(() => processCompressionQueue(), 100);
      }
    },
    
    "experimental.session.compacting": async (input, output) => {
      const sessionId = input.sessionID;
      const session = activeSessions.get(sessionId);
      
      if (session) {
        const recentObs = smartContextInjection(projectName, undefined, 10);
        const context = formatContextForInjection(recentObs);
        
        if (context) {
          output.context.push(context);
        }
        
        const stats = getStats();
        
        output.context.push(`
## Memory Stats
- Total sessions: ${stats.totalSessions}
- Total observations: ${stats.totalObservations}
- User-level memories: ${stats.totalUserObservations}
- Pending compressions: ${stats.pendingCompressions}
- Security: ${securityConfig.enabled ? "enabled" : "disabled"}
        `);
      }
    },
    
    tool: {
      "mem-search": memSearchTool
    }
  };
};

export default OpenCodeMemoryPlugin;

export {
  getDB,
  runMigrations,
  createSession,
  getSessionId,
  updateSessionPrompt,
  saveObservation,
  updateObservationSummary,
  saveSummary,
  markSessionIdle,
  markSessionCompleted,
  getRecentObservations,
  getSetting,
  getMemoryConfig,
  getStats
} from "./db";

export { getSDK, initSDK, resetSDK, MemorySDK } from "./sdk";
export { 
  searchObservations, 
  searchSessions, 
  searchPrompts, 
  searchUserObservations,
  getObservationsByFile, 
  getObservationsByType,
  smartContextInjection,
  formatContextForInjection 
} from "./search";
export { stripAllMemoryTags, stripPrivateTags, isFullyPrivate, truncateInput, truncateOutput } from "./privacy";
export { 
  redactSecrets, 
  getSecurityConfig, 
  setSecurityConfig,
  isContextSensitive,
  type ToolContext,
  type RedactionResult,
  type SecurityConfig 
} from "./secrets";
export { memSearchTool } from "./tools/mem-search";
