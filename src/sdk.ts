import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { safeParseLLMJson } from "./utils/safeJson";

export interface SDKConfig {
  provider: "openrouter" | "openai" | "anthropic" | "moonshot" | "zhipu" | "local";
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

interface OpenCodeProviderConfig {
  npm?: string;
  name?: string;
  options?: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  models?: Record<string, { name?: string; limit?: { context?: number; output?: number } }>;
}

interface OpenCodeConfig {
  provider?: Record<string, OpenCodeProviderConfig>;
  model?: string;
}

interface OpenCodeAuthEntry {
  type?: string;
  key?: string;
  apiKey?: string;
  token?: string;
}

interface OpenCodeAuth {
  [providerId: string]: OpenCodeAuthEntry;
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
  openrouter: "anthropic/claude-haiku-4.5",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20250514",
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

function getOpenCodeConfig(): OpenCodeConfig | null {
  const configPaths = [
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        let content = readFileSync(configPath, "utf-8");
        if (configPath.endsWith(".jsonc")) {
          content = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        }
        return JSON.parse(content);
      } catch {
      }
    }
  }
  return null;
}

function getOpenCodeAuthPath(): string {
  // Override for tests/CI via env var
  const envPath = process.env.OPENCODE_AUTH_PATH;
  if (envPath && envPath.trim().length > 0) {
    return envPath.trim();
  }

  // Default: ~/.local/share/opencode/auth.json
  return join(homedir(), ".local", "share", "opencode", "auth.json");
}

function getOpenCodeAuth(): OpenCodeAuth | null {
  const authPath = getOpenCodeAuthPath();

  if (!existsSync(authPath)) {
    return null;
  }

  try {
    const content = readFileSync(authPath, "utf-8");
    return JSON.parse(content) as OpenCodeAuth;
  } catch {
    return null;
  }
}

function getApiKeyFromAuth(providerId: string): string | null {
  const auth = getOpenCodeAuth();
  if (!auth) return null;

  const entry = auth[providerId];
  if (!entry) return null;

  // Try multiple key fields: key, apiKey, token
  return entry.key || entry.apiKey || entry.token || null;
}

function detectProviderFromConfig(config: OpenCodeConfig | null): SDKConfig["provider"] | null {
  if (!config?.provider) return null;
  
  const providerKeys = Object.keys(config.provider);
  for (const key of providerKeys) {
    const normalized = key.toLowerCase();
    if (normalized in PROVIDERS) {
      return normalized as SDKConfig["provider"];
    }
    if (normalized === "openrouter") return "openrouter";
    if (normalized === "openai") return "openai";
    if (normalized === "anthropic") return "anthropic";
  }
  return null;
}

function getApiKeyFromConfig(config: OpenCodeConfig | null, provider: SDKConfig["provider"]): string | null {
  if (!config?.provider) return null;
  
  for (const [key, value] of Object.entries(config.provider)) {
    const normalized = key.toLowerCase();
    if (normalized === provider || normalized === "openrouter") {
      return value?.options?.apiKey || null;
    }
  }
  return null;
}

function getEnvProvider(): SDKConfig["provider"] {
  const envProvider = process.env.OPENCODE_MEMORY_PROVIDER?.toLowerCase();
  if (envProvider && envProvider in PROVIDERS) {
    return envProvider as SDKConfig["provider"];
  }
  
  const config = getOpenCodeConfig();
  const configProvider = detectProviderFromConfig(config);
  if (configProvider) {
    return configProvider;
  }
  
  return "openrouter";
}

function getEnvApiKey(provider: SDKConfig["provider"]): string {
  // Priority: env var > auth.json > OpenCode config > fallback
  const envVar = API_KEY_ENV_VARS[provider];
  const envKey = process.env[envVar] || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (envKey) return envKey;

  // Try auth.json (highest priority after env vars)
  const authKey = getApiKeyFromAuth(provider);
  if (authKey) return authKey;

  // Try opencode.jsonc/json
  const config = getOpenCodeConfig();
  const configKey = getApiKeyFromConfig(config, provider);
  if (configKey) return configKey;

  // Try any API key from config
  if (config?.provider) {
    for (const [, value] of Object.entries(config.provider)) {
      if (value?.options?.apiKey) {
        return value.options.apiKey;
      }
    }
  }

  return "";
}

function getEnvModel(provider: SDKConfig["provider"]): string {
  if (process.env.OPENCODE_MEMORY_MODEL) {
    return process.env.OPENCODE_MEMORY_MODEL;
  }
  
  const config = getOpenCodeConfig();
  if (config?.model) {
    let model = config.model;
    // Strip provider prefix if present (e.g., "openrouter/minimax/m2.5" -> "minimax/m2.5")
    if (provider === "openrouter") {
      model = model.replace(/^openrouter\//, "");
    }
    return model;
  }
  
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openrouter;
}

export class MemorySDK {
  private client: OpenAI;
  private model: string;
  private provider: SDKConfig["provider"];
  private _hasApiKey: boolean;
  private _warnedAboutMissingKey: boolean = false;

  constructor(config?: Partial<SDKConfig>) {
    this.provider = config?.provider || getEnvProvider();
    const apiKey = config?.apiKey || getEnvApiKey(this.provider);
    const baseURL = config?.baseURL || PROVIDERS[this.provider];
    this.model = config?.model || getEnvModel(this.provider);

    this._hasApiKey = !!apiKey && apiKey.length > 0;

    if (!this._hasApiKey) {
      console.warn(
        `[opencode-memory] No API key found for ${this.provider}. ` +
        `Set ${API_KEY_ENV_VARS[this.provider]} env var, ` +
        `add to ~/.local/share/opencode/auth.json, or ` +
        `add to ~/.config/opencode/opencode.jsonc. ` +
        `Compression will be disabled.`
      );
      this._warnedAboutMissingKey = true;
    }

    this.client = new OpenAI({
      apiKey: apiKey || "no-key",
      baseURL,
      defaultHeaders: this.provider === "openrouter" ? {
        "HTTP-Referer": "https://github.com/clouitreee/opencode-memory",
        "X-Title": "opencode-memory"
      } : undefined
    });
  }

  hasApiKey(): boolean {
    return this._hasApiKey;
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
    // Fail-fast: no API key = no compression attempt
    if (!this._hasApiKey) {
      return {
        summary: `${toolName} executed`,
        type: "note",
        files: [],
        concepts: [toolName]
      };
    }

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

      const parsed = safeParseLLMJson(response.choices[0]?.message?.content, {
        fallback: { summary: "", type: "note", files: [], concepts: [] },
      });

      if (!parsed.ok) {
        console.warn("[opencode-memory] Compression parse error:", parsed.error);
        return {
          summary: `${toolName} executed`,
          type: "note",
          files: [],
          concepts: [toolName]
        };
      }

      return {
        summary: parsed.value.summary || "",
        type: parsed.value.type || "note",
        files: parsed.value.files || [],
        concepts: parsed.value.concepts || []
      };
    } catch (error) {
      const err = error as any;
      // On 401/403, don't retry - API key issue
      if (err?.status === 401 || err?.status === 403) {
        console.warn(
          "[opencode-memory] Authentication failed (401/403). " +
          "Check your API key in ~/.local/share/opencode/auth.json or environment variables. " +
          "Compression disabled for this session."
        );
        this._hasApiKey = false;
      } else {
        console.error("[opencode-memory] Compression error:", err?.message || error);
      }
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
    // Fail-fast: no API key = no summarization attempt
    if (!this._hasApiKey) {
      return {
        request: prompts[0] || "",
        investigated: "",
        learned: "",
        completed: "",
        next_steps: ""
      };
    }

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

      const parsed = safeParseLLMJson(response.choices[0]?.message?.content, {
        fallback: { request: "", investigated: "", learned: "", completed: "", next_steps: "" },
      });

      if (!parsed.ok) {
        console.warn("[opencode-memory] Summarization parse error:", parsed.error);
        return {
          request: prompts[0] || "",
          investigated: "",
          learned: "",
          completed: "",
          next_steps: ""
        };
      }

      return {
        request: parsed.value.request || "",
        investigated: parsed.value.investigated || "",
        learned: parsed.value.learned || "",
        completed: parsed.value.completed || "",
        next_steps: parsed.value.next_steps || ""
      };
    } catch (error) {
      const err = error as any;
      if (err?.status === 401 || err?.status === 403) {
        console.warn(
          "[opencode-memory] Authentication failed (401/403). " +
          "Check your API key. Summarization disabled."
        );
        this._hasApiKey = false;
      } else {
        console.error("[opencode-memory] Summarization error:", err?.message || error);
      }
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
    // Fail-fast: no API key = skip extraction
    if (!this._hasApiKey) {
      return null;
    }

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

      const parsed = safeParseLLMJson(response.choices[0]?.message?.content, {
        fallback: { type: "note", content: "", metadata: {} },
      });

      if (!parsed.ok) {
        console.warn("[opencode-memory] User memory extraction parse error:", parsed.error);
        return null;
      }

      if (!parsed.value.content) return null;

      return {
        type: parsed.value.type || "note",
        content: parsed.value.content,
        metadata: parsed.value.metadata || {}
      };
    } catch (error) {
      const err = error as any;
      if (err?.status === 401 || err?.status === 403) {
        console.warn(
          "[opencode-memory] Authentication failed (401/403). " +
          "Check your API key. Memory extraction disabled."
        );
        this._hasApiKey = false;
      } else {
        console.error("[opencode-memory] User memory extraction error:", err?.message || error);
      }
      return null;
    }
  }
  
  async extractContext(
    observations: string[],
    query: string
  ): Promise<string> {
    // Fail-fast: no API key = skip context extraction
    if (!this._hasApiKey) {
      return "";
    }

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
      const err = error as any;
      if (err?.status === 401 || err?.status === 403) {
        console.warn(
          "[opencode-memory] Authentication failed (401/403). " +
          "Check your API key. Context extraction disabled."
        );
        this._hasApiKey = false;
      } else {
        console.error("[opencode-memory] Context extraction error:", err?.message || error);
      }
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

// Export auth functions for testing
export { getOpenCodeAuthPath, getOpenCodeAuth, getApiKeyFromAuth };
