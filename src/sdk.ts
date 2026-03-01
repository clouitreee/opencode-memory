import OpenAI from "openai";

export interface SDKConfig {
  provider: "openrouter" | "openai" | "anthropic" | "moonshot" | "zhipu" | "local";
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

const PROVIDERS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  moonshot: "https://api.moonshot.ai/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  local: "http://localhost:11434/v1",
};

const DEFAULT_MODELS: Record<string, string> = {
  openrouter: "anthropic/claude-3.5-haiku",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  moonshot: "moonshot-v1-8k",
  zhipu: "glm-4-flash",
  local: "llama3.2",
};

const API_KEY_ENV_VARS: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  local: "LOCAL_API_KEY",
};

const COMPRESS_PROMPT = `You are a memory compression engine. Analyze tool usage observations and extract only the essential, reusable knowledge.

Given tool execution data, output a JSON object with:
- summary: One clear sentence about what happened (max 100 chars)
- type: One of: decision, bugfix, feature, refactor, discovery, pattern, change, note
- files: Array of file paths referenced
- concepts: Array of key concepts/tags (max 5)

Be extremely concise. Focus on WHAT was learned, not HOW.`;

const SUMMARIZE_PROMPT = `You are a session summarizer. Given a conversation transcript, create a structured summary.

Output JSON with:
- request: What the user asked for (one sentence)
- investigated: What was explored (bullet points as string)
- learned: Key discoveries (bullet points as string)
- completed: What was accomplished (bullet points as string)
- next_steps: What remains to be done (bullet points as string)

Be concise but comprehensive. This summary will be used for context in future sessions.`;

const USER_MEMORY_PROMPT = `You are a user memory extractor. Analyze observations and extract user-level preferences, patterns, and recurring decisions that should be remembered across all projects.

Output JSON with:
- type: One of: preference, pattern, decision, skill
- content: The extracted memory (one clear sentence)
- metadata: Any relevant context (project, frequency, etc.)

Only extract memories that are truly user-level (not project-specific).`;

function getEnvProvider(): SDKConfig["provider"] {
  const provider = process.env.OPENCODE_MEMORY_PROVIDER?.toLowerCase();
  if (provider && PROVIDERS[provider]) {
    return provider as SDKConfig["provider"];
  }
  return "openrouter";
}

function getEnvApiKey(provider: SDKConfig["provider"]): string {
  const envVar = API_KEY_ENV_VARS[provider];
  return process.env[envVar] || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
}

function getEnvModel(provider: SDKConfig["provider"]): string {
  return process.env.OPENCODE_MEMORY_MODEL || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openrouter;
}

export class MemorySDK {
  private client: OpenAI;
  private model: string;
  private provider: SDKConfig["provider"];
  
  constructor(config?: Partial<SDKConfig>) {
    this.provider = config?.provider || getEnvProvider();
    const apiKey = config?.apiKey || getEnvApiKey(this.provider);
    const baseURL = config?.baseURL || PROVIDERS[this.provider];
    this.model = config?.model || getEnvModel(this.provider);
    
    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: this.provider === "openrouter" ? {
        "HTTP-Referer": "https://github.com/clouitreee/opencode-memory",
        "X-Title": "opencode-memory"
      } : undefined
    });
  }
  
  async compressObservation(
    toolName: string,
    toolInput: unknown,
    toolOutput: unknown
  ): Promise<{
    summary: string;
    type: string;
    files: string[];
    concepts: string[];
  }> {
    const content = `Tool: ${toolName}
Input: ${JSON.stringify(toolInput, null, 2)}
Output: ${typeof toolOutput === "string" ? toolOutput.slice(0, 2000) : JSON.stringify(toolOutput, null, 2).slice(0, 2000)}`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: COMPRESS_PROMPT },
          { role: "user", content }
        ],
        max_tokens: 256,
        temperature: 0.3,
        response_format: { type: "json_object" }
      });
      
      const result = JSON.parse(response.choices[0].message.content || "{}");
      return {
        summary: result.summary || "",
        type: result.type || "note",
        files: result.files || [],
        concepts: result.concepts || []
      };
    } catch (error) {
      console.error("[opencode-memory] Compression error:", error);
      return {
        summary: `${toolName} executed`,
        type: "note",
        files: [],
        concepts: [toolName]
      };
    }
  }
  
  async summarizeSession(
    prompts: string[],
    observations: string[]
  ): Promise<{
    request: string;
    investigated: string;
    learned: string;
    completed: string;
    next_steps: string;
  }> {
    const content = `User Prompts:
${prompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Observations:
${observations.slice(0, 20).join("\n")}`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: SUMMARIZE_PROMPT },
          { role: "user", content }
        ],
        max_tokens: 1024,
        temperature: 0.3,
        response_format: { type: "json_object" }
      });
      
      const result = JSON.parse(response.choices[0].message.content || "{}");
      return {
        request: result.request || "",
        investigated: result.investigated || "",
        learned: result.learned || "",
        completed: result.completed || "",
        next_steps: result.next_steps || ""
      };
    } catch (error) {
      console.error("[opencode-memory] Summarization error:", error);
      return {
        request: prompts[0] || "",
        investigated: "",
        learned: "",
        completed: "",
        next_steps: ""
      };
    }
  }
  
  async extractUserMemory(
    observations: string[]
  ): Promise<{
    type: string;
    content: string;
    metadata: Record<string, unknown>;
  } | null> {
    const content = `Observations to analyze:
${observations.join("\n---\n")}`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: USER_MEMORY_PROMPT },
          { role: "user", content }
        ],
        max_tokens: 256,
        temperature: 0.3,
        response_format: { type: "json_object" }
      });
      
      const result = JSON.parse(response.choices[0].message.content || "{}");
      
      if (!result.content) return null;
      
      return {
        type: result.type || "note",
        content: result.content,
        metadata: result.metadata || {}
      };
    } catch (error) {
      console.error("[opencode-memory] User memory extraction error:", error);
      return null;
    }
  }
  
  async extractContext(
    observations: string[],
    query: string
  ): Promise<string> {
    const content = `Query: ${query}

Available observations:
${observations.join("\n---\n")}

Extract the most relevant context for the query. Be concise.`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: "You are a context extraction engine. Given observations and a query, extract only the most relevant information." },
          { role: "user", content }
        ],
        max_tokens: 1024,
        temperature: 0.2
      });
      
      return response.choices[0].message.content || "";
    } catch (error) {
      console.error("[opencode-memory] Context extraction error:", error);
      return "";
    }
  }
}

let sdkInstance: MemorySDK | null = null;

export function getSDK(): MemorySDK {
  if (!sdkInstance) {
    sdkInstance = new MemorySDK();
  }
  return sdkInstance;
}

export function initSDK(config: Partial<SDKConfig>): MemorySDK {
  sdkInstance = new MemorySDK(config);
  return sdkInstance;
}

export function resetSDK(): void {
  sdkInstance = null;
}
