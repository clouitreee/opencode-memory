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
  getSetting
} from "./db";
import { getSDK } from "./sdk";
import { searchObservations, formatContextForInjection } from "./search";
import { stripAllMemoryTags, isFullyPrivate } from "./privacy";
import { memSearchTool } from "./tools/mem-search";

const SKIP_TOOLS = new Set([
  "AskQuestion",
  "TodoWrite",
  "ListMcpResourcesTool",
  "Skill"
]);

let initialized = false;

function ensureInitialized(): void {
  if (!initialized) {
    runMigrations();
    initialized = true;
  }
}

export const OpenCodeMemoryPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const { project, directory, client } = input;
  const projectName = directory.split("/").pop() || project.id || "default";
  
  ensureInitialized();
  
  const db = getDB();
  const compressionEnabled = getSetting("compression_enabled") !== "false";
  const maxObservations = parseInt(getSetting("max_observations_context") || "50", 10);
  
  const activeSessions = new Map<string, { dbId: number; promptNumber: number }>();
  
  await client.app.log({
    body: {
      service: "opencode-memory",
      level: "info",
      message: `Plugin initialized for project: ${projectName}`,
    }
  });

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.created": {
          const sessionId = event.properties.info.id;
          ensureInitialized();
          
          const dbId = createSession(sessionId, projectName, directory);
          activeSessions.set(sessionId, { dbId, promptNumber: 0 });
          
          const recentObs = getRecentObservations(projectName, maxObservations);
          const context = formatContextForInjection(recentObs);
          
          if (context) {
            await client.app.log({
              body: {
                service: "opencode-memory",
                level: "info",
                message: `Injected ${recentObs.length} observations for new session`,
              }
            });
          }
          break;
        }
        
        case "session.idle": {
          const sessionId = event.properties.sessionID;
          const session = activeSessions.get(sessionId);
          
          if (session) {
            markSessionIdle(session.dbId);
            
            if (compressionEnabled) {
              const observations = db.prepare(`
                SELECT * FROM observations 
                WHERE session_id = $sessionId AND compressed_summary IS NULL
                ORDER BY created_at DESC
                LIMIT 20
              `).all({ sessionId: session.dbId }) as Array<{
                id: number;
                tool_name: string;
                tool_input: string;
                tool_output: string;
              }>;
              
              if (observations.length > 0) {
                const prompts = db.prepare(`
                  SELECT prompt FROM user_prompts 
                  WHERE session_id = $sessionId 
                  ORDER BY prompt_number
                `).all({ sessionId: session.dbId }) as Array<{ prompt: string }>;
                
                const obsStrings = observations.map(o => 
                  `${o.tool_name}: ${o.tool_input?.slice(0, 200)}`
                );
                
                const sdk = getSDK();
                const summary = await sdk.summarizeSession(
                  prompts.map(p => p.prompt),
                  obsStrings
                );
                
                saveSummary(session.dbId, summary);
                
                await client.app.log({
                  body: {
                    service: "opencode-memory",
                    level: "info",
                    message: "Generated session summary on idle",
                  }
                });
              }
            }
          }
          break;
        }
        
        case "session.deleted": {
          const sessionId = event.properties.info.id;
          const session = activeSessions.get(sessionId);
          
          if (session) {
            markSessionCompleted(session.dbId);
            activeSessions.delete(sessionId);
          }
          break;
        }
        
        case "session.compacted": {
          const sessionId = event.properties.sessionID;
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
        session = { dbId, promptNumber: 0 };
        activeSessions.set(sessionId, session);
      }
      
      const messages = output.parts.filter(p => p.type === "text");
      for (const part of messages) {
        if ("text" in part && part.text) {
          const cleanedText = stripAllMemoryTags(part.text);
          
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
        session = { dbId, promptNumber: 0 };
        activeSessions.set(sessionId, session);
      }
      
      const cleanedInput = JSON.parse(
        stripAllMemoryTags(JSON.stringify(input.args || {}))
      );
      const cleanedOutput = stripAllMemoryTags(output.output);
      
      if (isFullyPrivate(cleanedOutput)) return;
      
      const obsId = saveObservation(
        session.dbId,
        input.tool,
        cleanedInput,
        cleanedOutput,
        session.promptNumber
      );
      
      if (compressionEnabled) {
        try {
          const sdk = getSDK();
          const compressed = await sdk.compressObservation(
            input.tool,
            cleanedInput,
            cleanedOutput
          );
          
          updateObservationSummary(
            obsId,
            compressed.summary,
            compressed.type,
            compressed.files,
            compressed.concepts
          );
        } catch (error) {
          console.error("[opencode-memory] Compression failed:", error);
        }
      }
    },
    
    "experimental.session.compacting": async (input, output) => {
      const sessionId = input.sessionID;
      const session = activeSessions.get(sessionId);
      
      if (session) {
        const recentObs = getRecentObservations(projectName, 10);
        const context = formatContextForInjection(recentObs);
        
        if (context) {
          output.context.push(context);
        }
        
        output.context.push(`
## Memory Persistence Note
This session has ${session.promptNumber} prompts recorded. Key observations have been compressed and stored for future context retrieval.
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
  getSetting
} from "./db";

export { getSDK, initSDK, MemorySDK } from "./sdk";
export { searchObservations, searchSessions, searchPrompts, formatContextForInjection } from "./search";
export { stripAllMemoryTags, stripPrivateTags, isFullyPrivate } from "./privacy";
export { memSearchTool } from "./tools/mem-search";
