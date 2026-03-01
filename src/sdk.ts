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
  openrouter: "openrouter/z-ai/glm-5",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  moonshot: "moonshot-v1-8k",
  zhipu: "glm-4-flash",
  local: "llama3.2",
};

const COMPRESS_PROMPT = `You are a memory compression engine. Analyze tool usage observations and extract only the essential, reusable knowledge.

Given tool execution data, output a JSON object with:
- summary: One clear sentence about what happened (max 100 chars)
- type: One of: decision, bugfix, feature, refactor, discovery, pattern, change, note
- files: Array of file paths referenced
- concepts: Array of key concepts/tags (max 5)

Be extremely concise. Focus on WHAT was learned, not HOW.
`;

const SUMMARIZE_PROMPT = `You are a session summarizer. Given a conversation transcript, create a structured summary.

Output JSON with:
- request: What the user asked for (one sentence)
- investigated: What was explored (bullet points as string)
- learned: Key discoveries (bullet points as string)
- completed: What was accomplished (bullet points as string)
- next_steps: What remains to be done (bullet points as string)

Be concise but comprehensive. This summary will be used for context in future sessions.
`;

export class MemorySDK {
  private client: OpenAI;
  private model: string;
  
  constructor(config: SDKConfig) {
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
    const baseURL = config.baseURL || PROVIDERS[config.provider] || PROVIDERS.openrouter;
    this.model = config.model || DEFAULT_MODELS[config.provider] || DEFAULT_MODELS.openrouter;
    
    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: config.provider === "openrouter" ? {
        "HTTP-Referer": "https://github.com/opencode-memory",
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
    sdkInstance = new MemorySDK({
      provider: "openrouter",
      model: process.env.OPENCODE_MEMORY_MODEL
    });
  }
  return sdkInstance;
}

export function initSDK(config: SDKConfig): MemorySDK {
  sdkInstance = new MemorySDK(config);
  return sdkInstance;
}
