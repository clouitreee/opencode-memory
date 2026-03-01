import { tool } from "@opencode-ai/plugin";
import { getSetting, setSetting } from "./db";

export interface ToolContext {
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  description?: string;
}

export interface RedactedSecret {
  type: string;
  value: string;
  position: number;
}

export interface RedactionResult {
  text: string;
  redactedCount: number;
  redactedSecrets: RedactedSecret[];
  warnings: string[];
}

export interface SecurityConfig {
  enabled: boolean;
  logRedactions: boolean;
  redactionPlaceholder: string;
  maxOutputSize: number;
  entropyThreshold: number;
  minSecretLength: number;
  maxSecretLength: number;
}

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enabled: true,
  logRedactions: true,
  redactionPlaceholder: "[REDACTED]",
  maxOutputSize: 8192,
  entropyThreshold: 4.0,
  minSecretLength: 16,
  maxSecretLength: 200
};

// ============ LAYER 1: Contextual Awareness ============

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /\.env($|\.)/i,
  /\.(pem|key|crt|cer|pfx|p12)$/i,
  /id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(credentials?|secrets?|tokens?)\.(json|ya?ml|toml|ini|conf|cfg)$/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
  /kubeconfig$/i,
  /\.docker\/config\.json$/i,
  /\.aws\/(credentials|config)$/i,
  /\.gcloud\/.*\.json$/i,
  /service[_-]?account.*\.json$/i,
  /\.netrc$/i,
  /htpasswd$/i,
  /shadow$/i,
  /\.pgpass$/i,
  /\.gnupg\/?\.conf$/i,
  /\.config\/(aws|gcloud|azure|aliyun)/i,
  /\.flickr$/i,
  /\.envrc$/i,
  /\.p12$/i,
  /\.keystore\/?\.jks$/i,
  /\.dockercfg$/i,
  /private\.key$/i,
  /\.ssh\/id_/i,
];

const SENSITIVE_COMMANDS: RegExp[] = [
  /\bprintenv\b/i,
  /\benv\b(?!\s+[\w-]+=)/,
  /\bcat\s+.*\.(env|pem|key)/i,
  /\becho\s+\$[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|PASS|API_KEY)/i,
  /\baws\s+configure/i,
  /\bdocker\s+(login|inspect)/i,
  /\bkubectl\s+(get|describe)\s+secret/i,
  /\bvault\s+(read|kv)/i,
  /\bgpg\s+--export-secret/i,
  /\bexport\s+[A-Z_]+=/i,
  /\bsource\s+.*\/\.env/i,
  /\bterraform\s+(apply|show)/i,
  /\bpassman\s+(show|list)/i,
];

const SENSITIVE_TOOL_INPUT_PATTERNS: RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /auth[_-]?token/i,
  /bearer/i,
  /credential/i,
];

export function isContextSensitive(ctx: ToolContext): "full_redact" | "scan" | "safe" {
  if (ctx.toolName === "Read" || ctx.toolName === "Edit" || ctx.toolName === "write" || ctx.toolName === "Write") {
    const filePath = (ctx.toolInput.filePath || ctx.toolInput.file_path || ctx.toolInput.path || "") as string;
    
    if (SENSITIVE_FILE_PATTERNS.some(p => p.test(filePath))) {
      return "full_redact";
    }
    
    if (SENSITIVE_TOOL_INPUT_PATTERNS.some(p => p.test(filePath))) {
      return "full_redact";
    }
    
    const fileName = filePath.split("/").pop() || "";
    if (/^\.env/.test(fileName) || /^id_/.test(fileName) || /key$/i.test(fileName)) {
      return "full_redact";
    }
  }
  
  if (ctx.toolName === "bash" || ctx.toolName === "Bash") {
    const command = (ctx.toolInput.command || "") as string;
    
    if (SENSITIVE_COMMANDS.some(p => p.test(command))) {
      return "full_redact";
    }
    
    const cmdLower = command.toLowerCase();
    if (cmdLower.includes("password") || cmdLower.includes("secret") || cmdLower.includes("token")) {
      return "full_redact";
    }
  }
  
  return "scan";
}

export function shouldFullyRedact(ctx: ToolContext): boolean {
  return isContextSensitive(ctx) === "full_redact";
}

// ============ LAYER 2: Pattern Matching ============

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "AWS Access Key",
    pattern: /AKIA[A-Z0-9]{16}/g,
    description: "AWS access key format (AKIA...)"
  },
  {
    name: "AWS Secret Key",
    pattern: /(?<![A-Za-z0-9/+=])([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/g,
    description: "AWS secret key (base64, 40 chars)"
  },
  {
    name: "GitHub Token",
    pattern: /(?<![A-Za-z0-9_-])(ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36,40}|github_pat_[A-Za-z0-9]{22,50})(?![A-Za-z0-9_-])/g,
    description: "GitHub personal access token"
  },
  {
    name: "npm Token",
    pattern: /(?<![A-Z0-9])(npm_[A-Za-z0-9]{36})(?![A-Z0-9])/g,
    description: "npm registry token"
  },
  {
    name: "Generic API Key",
    pattern: /(?<![A-Z0-9])[A-Z0-9]{32,64}_[A-Za-z0-9]{32,64}(?![A-Z0-9])/g,
    description: "Generic API key with underscore separator"
  },
  {
    name: "Bearer Token",
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+/gi,
    description: "Bearer token in Authorization header"
  },
  {
    name: "Basic Auth",
    pattern: /Basic\s+[A-Za-z0-9]+[:=][A-Za-z0-9]+/gi,
    description: "Basic authentication header"
  },
  {
    name: "Private Key PEM",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    description: "PEM-formatted private key"
  },
  {
    name: "SSH Private Key",
    pattern: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+OPENSSH\s+PRIVATE\s+KEY-----/g,
    description: "OpenSSH private key"
  },
  {
    name: "Google API Key",
    pattern: /(?<![A-Z0-9])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
    description: "Google API key"
  },
  {
    name: "Google OAuth",
    pattern: /(?<![0-9])([0-9]{4}-[0-9]{28}\.[a-z]+\.apps\.googleusercontent\.com)/gi,
    description: "Google OAuth client ID"
  },
  {
    name: "Slack Token",
    pattern: /(?<![A-Z0-9])xox[abp]-[A-Za-z0-9]{10,24}(?![A-Za-z0-9])/gi,
    description: "Slack bot/app token"
  },
  {
    name: "Stripe Key",
    pattern: /(?<![A-Z0-9])sk_(?:live|test)_[A-Za-z0-9]{24,34}(?![A-Za-z0-9])/g,
    description: "Stripe API key"
  },
  {
    name: "Twilio Auth",
    pattern: /(?<![A-Z0-9])AC[a-f0-9]{32}(?![a-f0-9])/gi,
    description: "Twilio account SID"
  },
  {
    name: "JWT Token",
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    description: "JSON Web Token"
  },
  {
    name: "Env Assignment Sensitive",
    pattern: /(?:^|\n)\s*[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD|PASS|CRED|API_KEY)\s*=\s*["']?[^"'\n\s]+["']?/gm,
    description: "Environment variable with sensitive name"
  },
  {
    name: "URL with Auth",
    pattern: /(?:https?|postgres|mongodb|redis|mysql|postgresql):\/\/[^:\s"']+:[^:@\s"']+@/gi,
    description: "URL with embedded credentials"
  },
  {
    name: "OpenAI Key",
    pattern: /sk-(?:proj-)?[A-Za-z0-9]{16,}/g,
    description: "OpenAI API key"
  },
  {
    name: "Anthropic Key",
    pattern: /(?<![A-Z0-9])sk-ant-[A-Za-z0-9]{20,24}(?![A-Za-z0-9])/gi,
    description: "Anthropic API key"
  },
  {
    name: "HashiCorp Vault Token",
    pattern: /(?:s\.)?[vhvs]\.[a-zA-Z0-9]{24,}/g,
    description: "HashiCorp Vault token"
  },
  {
    name: "SendGrid Key",
    pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    description: "SendGrid API key"
  },
  {
    name: "Mailchimp Key",
    pattern: /(?<![A-Z0-9])[A-Za-z0-9]{32}-[A-Za-z0-9]{4}(?![A-Za-z0-9])/g,
    description: "Mailchimp API key"
  },
  {
    name: "Generic Secret Assignment",
    pattern: /(?:password|secret|token|api_key|private_key|access_key)\s*[=:]\s*["']?[^"'\s\n]+["']?/gi,
    description: "Generic secret assignment"
  },
  {
    name: "JSON Web Key",
    pattern: /"key"\s*:\s*"[A-Za-z0-9+/=]{20,}"/gi,
    description: "Key in JSON object"
  },
  {
    name: "Private Key Header",
    pattern: /-----BEGIN\s+(?:EC\s+)?(?:DSA\s+)?PRIVATE\s+KEY-----/g,
    description: "Private key header"
  },
];

export function getSecretPatterns(): SecretPattern[] {
  return SECRET_PATTERNS;
}

// ============ Layer 3: Entropy Detection ============

const ENTROPY_THRESHOLD = 4.0;
const MIN_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 200;

export function shannonEntropy(str: string): number {
  const freq = new Map<string, number>();
  
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  
  let entropy = 0;
  const len = str.length;
  
  for (const count of freq.values()) {
    const p = count / len;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  
  return entropy;
}

function findHighEntropyStrings(text: string): Array<{ match: string; entropy: number; position: number }> {
  const tokenRegex = /[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ23456789_\-]{16,200}/g;
  const results: Array<{ match: string; entropy: number; position: number }> = [];
  
  let match;
  while ((match = tokenRegex.exec(text)) !== null) {
    const candidate = match[0];
    
    const hasUppercase = /[A-Z]/.test(candidate);
    const hasLowercase = /[a-z]/.test(candidate);
    const hasDigit = /[0-9]/.test(candidate);
    const hasSpecial = /[-_]/.test(candidate);
    
    const variety = [hasUppercase, hasLowercase, hasDigit, hasSpecial].filter(Boolean).length;
    
    if (variety >= 2) {
      const entropy = shannonEntropy(candidate);
      
      if (entropy >= ENTROPY_THRESHOLD) {
        results.push({
          match: candidate,
          entropy,
          position: match.index
        });
      }
    }
  }
  
  return results;
}

// ============ Layer 4: Allowlist (False Positives) ============

const ALLOWLIST_PATTERNS: RegExp[] = [
  /^[0-9a-f]{40}$/i,
  /^[0-9a-f]{7,8}$/i,
  /^[0-9a-f]{64}$/i,
  /^[0-9a-f]{32}$/i,
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i,
  /^data:image\//i,
  /^iVBORw0KGgo/,
  /^\/9j\/4AAQSkZJRg/,
  /^[A-Za-z0-9+/]{4}={0,2}$/,
  /^v\d+\.\d+\.\d+/,
  /^https?:\/\/[^\s"'<>]+$/i,
  /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i,
  /^sha[0-9]+-/,
  /^[A-Za-z0-9]{20,}==$/,
  /^---[a-z]+\s*\d+\.\d+\.\d+/,
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  /^npm_install_/,
  /^node_modules/,
  /^\$\([^)]+\)$/,
  /^\$\{[^}]+\}$/,
  /^import\s+/,
  /^export\s+/,
  /^function\s+/,
  /^const\s+/,
  /^let\s+/,
  /^var\s+/,
];

function isAllowlisted(candidate: string): boolean {
  if (candidate.length < MIN_SECRET_LENGTH) return true;
  
  const SECRET_PREFIXES = /^(sk-|ghp_|gho_|github_pat_|npm_|AKIA|AIza|xox[abp]-|sk_live_|sk_test_|SG\.)/i;
  if (SECRET_PREFIXES.test(candidate)) return false;
  
  if (/^[0-9]+$/.test(candidate)) return true;
  if (/^[a-z]+$/i.test(candidate)) return true;
  if (/^[a-z_]+$/i.test(candidate)) return true;
  
  if (ALLOWLIST_PATTERNS.some(p => p.test(candidate))) return true;
  
  if (/^(function|const|let|var|import|export|return|if|else|for|while|class|interface|type)\s/.test(candidate)) return true;
  
  const commonWords = ['function', 'const', 'let', 'var', 'return', 'undefined', 'null', 'true', 'false', 'async', 'await', 'import', 'export', 'default', 'module', 'exports', 'require'];
  if (commonWords.includes(candidate.toLowerCase())) return true;
  
  return false;
}

// ============ Main Redaction Function ============

export function redactSecrets(
  text: string,
  context?: ToolContext,
  config: SecurityConfig = DEFAULT_SECURITY_CONFIG
): RedactionResult {
  if (!config.enabled || !text) {
    return {
      text,
      redactedCount: 0,
      redactedSecrets: [],
      warnings: []
    };
  }
  
  const warnings: string[] = [];
  const redactedSecrets: RedactedSecret[] = [];
  let result = text;
  let redactedCount = 0;
  
  // Layer 1: Full context redaction
  if (context && isContextSensitive(context) === "full_redact") {
    const placeholder = config.redactionPlaceholder;
    result = placeholder;
    redactedCount = 1;
    redactedSecrets.push({
      type: "context_sensitive",
      value: "[FULL OUTPUT REDACTED]",
      position: 0
    });
    warnings.push(`Full redaction triggered for ${context.toolName} tool`);
    
    return { text: result, redactedCount, redactedSecrets, warnings };
  }
  
  // Layer 2: Pattern matching
  for (const { name, pattern } of SECRET_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(result)) !== null) {
      const matched = match[0];
      
      if (matched && !isAllowlisted(matched)) {
        result = result.slice(0, match.index) + config.redactionPlaceholder + result.slice(match.index + matched.length);
        redactedCount++;
        redactedSecrets.push({
          type: name,
          value: matched.length > 30 ? matched.substring(0, 30) + "..." : matched,
          position: match.index
        });
        warnings.push(`Pattern match: ${name}`);
        regex.lastIndex = match.index + config.redactionPlaceholder.length;
      }
    }
  }
  
  // Layer 3: Entropy detection
  const highEntropyStrings = findHighEntropyStrings(result);
  
  for (const { match, entropy } of highEntropyStrings) {
    if (!isAllowlisted(match)) {
      const idx = result.indexOf(match);
      if (idx !== -1) {
        result = result.slice(0, idx) + config.redactionPlaceholder + result.slice(idx + match.length);
        redactedCount++;
        redactedSecrets.push({
          type: "high_entropy",
          value: match.length > 30 ? match.substring(0, 30) + "..." : match,
          position: idx
        });
        warnings.push(`High entropy detected (${entropy.toFixed(2)})`);
      }
    }
  }
  
  return { text: result, redactedCount, redactedSecrets, warnings };
}

// ============ Convenience Functions ============

export function getSecurityConfig(): SecurityConfig {
  try {
    const dbConfig = getSetting("security_config");
    if (dbConfig) {
      try {
        return { ...DEFAULT_SECURITY_CONFIG, ...JSON.parse(dbConfig) };
      } catch {
        return DEFAULT_SECURITY_CONFIG;
      }
    }
  } catch {
    // DB not initialized or table doesn't exist
  }
  return DEFAULT_SECURITY_CONFIG;
}

export function setSecurityConfig(config: Partial<SecurityConfig>): void {
  setSetting("security_config", JSON.stringify({ ...getSecurityConfig(), ...config }));
}

export function logRedaction(
  context: ToolContext,
  result: RedactionResult
): void {
  if (result.redactedCount > 0) {
    console.warn(
      `[opencode-memory] Security: Redacted ${result.redactedCount} potential secrets from ${context.toolName} tool`
    );
    if (result.redactedSecrets.length > 0) {
      console.warn(
        `[opencode-memory] Types: ${result.redactedSecrets.map(s => s.type).join(", ")}`
      );
    }
  }
}

export function redactToolOutput(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  config?: Partial<SecurityConfig>
): RedactionResult {
  const secConfig = { ...DEFAULT_SECURITY_CONFIG, ...config };
  const context: ToolContext = { toolName, toolInput };
  
  const result = redactSecrets(toolOutput, context, secConfig);
  
  if (secConfig.logRedactions && result.redactedCount > 0) {
    logRedaction(context, result);
  }
  
  return result;
}

export function isOutputSensitive(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string
): boolean {
  const context: ToolContext = { toolName, toolInput };
  const sensitivity = isContextSensitive(context);
  
  if (sensitivity === "full_redact") return true;
  
  const quickPatterns = [
    /(?:password|secret|token|api_key|private_key)\s*[:=]/i,
    /-----BEGIN.*PRIVATE KEY-----/,
    /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*/,
  ];
  
  for (const pattern of quickPatterns) {
    if (pattern.test(toolOutput)) {
      return true;
    }
  }
  
  return false;
}

export function sanitizeForLLM(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string
): { safe: boolean; output: string; redactedCount: number } {
  const context: ToolContext = { toolName, toolInput };
  
  if (isContextSensitive(context) === "full_redact") {
    return {
      safe: true,
      output: "[CONTENT REDACTED - SENSITIVE FILE/COMMAND]",
      redactedCount: 1
    };
  }
  
  const result = redactSecrets(toolOutput, context);
  
  return {
    safe: result.redactedCount === 0,
    output: result.text,
    redactedCount: result.redactedCount
  };
}

export function sanitizeToolInput(
  toolName: string,
  toolInput: Record<string, unknown>
): Record<string, unknown> {
  const sanitized = { ...toolInput };
  
  if (toolName === "Read" || toolName === "Edit" || toolName === "write" || toolName === "Write") {
    const filePath = (sanitized.filePath || sanitized.file_path || sanitized.path || "") as string;
    if (SENSITIVE_FILE_PATTERNS.some(p => p.test(filePath))) {
      if (sanitized.content) {
        sanitized.content = "[CONTENT REDACTED]";
      }
    }
  }
  
  if (toolName === "bash" || toolName === "Bash") {
    const command = (sanitized.command || "") as string;
    if (SENSITIVE_COMMANDS.some(p => p.test(command))) {
      sanitized.command = "[COMMAND REDACTED]";
    }
  }
  
  return sanitized;
}

export function validateSecurity(result: RedactionResult): void {
  const dangerousPatterns = [
    /(?<![A-Z0-9])[A-Z0-9]{16}_[A-Z0-9]{16}_[A-Z0-9]{16}_[A-Z0-9]{16}/,
    /sk-[A-Za-z0-9]{20,}/,
    /ghp_[A-Za-z0-9]{36}/,
    /-----BEGIN.*PRIVATE KEY-----/,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(result.text)) {
      console.error(
        `[opencode-memory] SECURITY WARNING: Potentially dangerous pattern still present after redaction!`
      );
    }
  }
}

export function auditLog(
  context: ToolContext,
  result: RedactionResult
): void {
  const auditEntry = {
    timestamp: new Date().toISOString(),
    tool: context.toolName,
    inputFile: (context.toolInput.filePath || context.toolInput.file_path || context.toolInput.path) as string | undefined,
    command: context.toolInput.command as string | undefined,
    redactedCount: result.redactedCount,
    secretTypes: result.redactedSecrets.map(s => s.type),
    warnings: result.warnings
  };
  
  console.log(
    `[opencode-memory] Security audit: ${auditEntry.tool} - ${auditEntry.redactedCount} secrets redacted`
  );
}

export type SeverityKind = "full_redact" | "partial_redact" | "none";

export interface DetectionResult {
  kind: SeverityKind;
  patternId: string;
  prefix4?: string;
}

const FULL_REDACT_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "aws_access_key", pattern: /AKIA[A-Z0-9]{16}/ },
  { id: "github_token", pattern: /(?:ghp_|gho_|github_pat_)[A-Za-z0-9]{22,50}/ },
  { id: "npm_token", pattern: /npm_[A-Za-z0-9]{36}/ },
  { id: "jwt_token", pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/ },
  { id: "private_key_pem", pattern: /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+)?PRIVATE\s+KEY-----/ },
  { id: "openai_key", pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/ },
  { id: "anthropic_key", pattern: /sk-ant-[A-Za-z0-9]{20,}/ },
  { id: "google_api_key", pattern: /AIza[A-Za-z0-9_-]{35}/ },
  { id: "stripe_key", pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/ },
  { id: "slack_token", pattern: /xox[abp]-[A-Za-z0-9]{10,24}/ },
  { id: "vault_token", pattern: /(?:s\.)?[vhvs]\.[a-zA-Z0-9]{24,}/ },
  { id: "sendgrid_key", pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { id: "bearer_token", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/i },
  { id: "url_with_auth", pattern: /(?:https?|postgres|mongodb|redis|mysql|postgresql):\/\/[^:\s"']+:[^:@\s"']+@/i },
  { id: "ssh_key_path", pattern: /~\/\.ssh\/id_[a-z0-9]+/i },
  { id: "env_file_path", pattern: /\.env(?:\.|$)/i },
];

const PARTIAL_REDACT_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "home_dir", pattern: /^~\/|^\/home\/[^/]+\// },
  { id: "ssh_dir", pattern: /\/\.ssh\// },
  { id: "keychain_path", pattern: /keychain|\.keychain/i },
  { id: "aws_config", pattern: /\/\.aws\/(credentials|config)/i },
  { id: "gcloud_config", pattern: /\/\.config\/gcloud|\/\.gcloud\//i },
  { id: "docker_config", pattern: /\/\.docker\/config\.json/i },
  { id: "kubeconfig", pattern: /kubeconfig|\.kube\//i },
  { id: "env_var_assignment", pattern: /[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD|API_KEY)\s*=/ },
  { id: "sensitive_file", pattern: /\.(pem|key|crt|cer|pfx|p12)$/i },
];

export function detectSecretInValue(value: string, path: string): DetectionResult {
  if (!value || typeof value !== "string") {
    return { kind: "none", patternId: "" };
  }
  
  if (value.length < 8) {
    return { kind: "none", patternId: "" };
  }
  
  for (const { id, pattern } of FULL_REDACT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags || "");
    if (regex.test(value)) {
      const prefix4 = value.length > 4 ? value.slice(0, 4) : value;
      return { kind: "full_redact", patternId: id, prefix4 };
    }
  }
  
  for (const { id, pattern } of PARTIAL_REDACT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags || "");
    if (regex.test(value)) {
      const prefix4 = value.length > 4 ? value.slice(0, 4) : value;
      return { kind: "partial_redact", patternId: id, prefix4 };
    }
  }
  
  const SECRET_KEY_NAMES = /^(?:password|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?token|bearer|credential|apikey)$/i;
  const pathParts = path.split(/[.\[\]]/).filter(Boolean);
  for (const part of pathParts) {
    if (SECRET_KEY_NAMES.test(part)) {
      const prefix4 = value.length > 4 ? value.slice(0, 4) : value;
      return { kind: "full_redact", patternId: "sensitive_key_name", prefix4 };
    }
  }
  
  if (value.length >= 16) {
    const entropy = shannonEntropy(value);
    if (entropy >= 4.0) {
      const hasUpper = /[A-Z]/.test(value);
      const hasLower = /[a-z]/.test(value);
      const hasDigit = /[0-9]/.test(value);
      const hasSpecial = /[-_=+\/]/.test(value);
      const variety = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;
      
      if (variety >= 2) {
        const prefix4 = value.slice(0, 4);
        return { kind: "full_redact", patternId: "high_entropy", prefix4 };
      }
    }
  }
  
  return { kind: "none", patternId: "" };
}

export function createDetector(): (value: string, path: string) => DetectionResult {
  return detectSecretInValue;
}

export function scanStringForSecrets(text: string): Array<{ kind: SeverityKind; patternId: string; match: string; position: number }> {
  const results: Array<{ kind: SeverityKind; patternId: string; match: string; position: number }> = [];
  
  if (!text || typeof text !== "string") return results;
  
  for (const { id, pattern } of FULL_REDACT_PATTERNS) {
    const regex = new RegExp(pattern.source, "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({
        kind: "full_redact",
        patternId: id,
        match: match[0].length > 4 ? match[0].slice(0, 4) + "..." : match[0],
        position: match.index
      });
    }
  }
  
  for (const { id, pattern } of PARTIAL_REDACT_PATTERNS) {
    const regex = new RegExp(pattern.source, "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({
        kind: "partial_redact",
        patternId: id,
        match: match[0].length > 4 ? match[0].slice(0, 4) + "..." : match[0],
        position: match.index
      });
    }
  }
  
  return results;
}
