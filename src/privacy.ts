const PRIVATE_REGEX = /<private>[\s\S]*?<\/private>/gi;
const CONTEXT_REGEX = /<opencode-memory-context>[\s\S]*?<\/opencode-memory-context>/gi;
const MAX_OUTPUT_SIZE = 8192;

export interface RedactionMeta {
  kind: "full_redact" | "partial_redact" | "none";
  patternId: string;
  prefix4: string;
  length: number;
  path: string;
}

export interface RedactionResult {
  redacted: unknown;
  redactions: RedactionMeta[];
  redactionRatio: number;
  originalSize: number;
  redactedSize: number;
}

export interface DryRunReport {
  wouldRedact: boolean;
  totalRedactions: number;
  fieldsAffected: string[];
  severityBreakdown: {
    full_redact: number;
    partial_redact: number;
    none: number;
  };
  redactionRatio: number;
  warning: string | null;
}

export interface RedactionConfig {
  enabled: boolean;
  dryRun: boolean;
  maxRatio: number;
  placeholder: string;
}

const DEFAULT_CONFIG: RedactionConfig = {
  enabled: true,
  dryRun: false,
  maxRatio: 0.30,
  placeholder: "[REDACTED]"
};

let config = { ...DEFAULT_CONFIG };

export function setRedactionConfig(newConfig: Partial<RedactionConfig>): void {
  config = { ...config, ...newConfig };
}

export function getRedactionConfig(): RedactionConfig {
  return { ...config };
}

export function stripPrivateTags(text: string): string {
  if (!text) return text;
  const regex = new RegExp(PRIVATE_REGEX.source, "gi");
  return text.replace(regex, "").trim();
}

export function stripContextTags(text: string): string {
  if (!text) return text;
  const regex = new RegExp(CONTEXT_REGEX.source, "gi");
  return text.replace(regex, "").trim();
}

export function stripAllMemoryTags(text: string): string {
  if (!text) return text;
  return text
    .replace(new RegExp(PRIVATE_REGEX.source, "gi"), "")
    .replace(new RegExp(CONTEXT_REGEX.source, "gi"), "")
    .trim();
}

export function hasPrivateContent(text: string): boolean {
  if (!text) return false;
  const regex = new RegExp(PRIVATE_REGEX.source, "gi");
  return regex.test(text);
}

export function isFullyPrivate(text: string): boolean {
  if (!text) return true;
  const stripped = stripPrivateTags(text);
  return stripped.trim().length === 0;
}

export function truncateOutput(output: unknown, maxSize = MAX_OUTPUT_SIZE): string {
  const str = typeof output === "string" ? output : safeStringify(output);
  
  if (str.length <= maxSize) {
    return str;
  }
  
  return str.slice(0, maxSize) + "\n... [truncated, original size: " + str.length + " chars]";
}

export function truncateInput(input: unknown, maxSize = MAX_OUTPUT_SIZE): string {
  const str = typeof input === "string" ? input : safeStringify(input);
  
  if (str.length <= maxSize) {
    return str;
  }
  
  return str.slice(0, maxSize) + "\n... [truncated]";
}

export function safeStringify(obj: unknown, indent = 0): string {
  try {
    return JSON.stringify(obj, null, indent);
  } catch {
    return "[UNSTRINGIFIABLE]";
  }
}

export function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function safeParseOrFallback<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function isStringifiedJson(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
         (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

export function extractFilesFromText(text: string): string[] {
  const filePatterns = [
    /(?:^|\s)([\/\w.-]+\.[\w]+)(?:\s|$)/g,
    /(?:file|path|in|at):\s*([\/\w.-]+)/gi,
    /`([^`]+\.[\w]+)`/g,
    /['"]([^'"]+\.[\w]+)['"]/g
  ];
  
  const files = new Set<string>();
  
  for (const pattern of filePatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      const file = match[1];
      if (file && file.length > 2 && !file.startsWith("http")) {
        files.add(file);
      }
    }
  }
  
  return Array.from(files);
}

function getPrefix4(value: string): string {
  if (!value || value.length <= 4) return "";
  return value.slice(0, 4);
}

export function redactValue(
  value: string,
  path: string,
  detector: (v: string) => { kind: "full_redact" | "partial_redact" | "none"; patternId: string }
): { redacted: string; redactions: RedactionMeta[] } {
  if (!value || typeof value !== "string") {
    return { redacted: value, redactions: [] };
  }
  
  const redactions: RedactionMeta[] = [];
  let result = value;
  
  const detection = detector(value);
  
  if (detection.kind !== "none") {
    const originalLength = value.length;
    const prefix4 = getPrefix4(value);
    
    redactions.push({
      kind: detection.kind,
      patternId: detection.patternId,
      prefix4,
      length: originalLength,
      path
    });
    
    if (detection.kind === "full_redact") {
      result = config.placeholder;
    } else {
      result = config.placeholder;
    }
  }
  
  return { redacted: result, redactions };
}

export function redactObject(
  obj: unknown,
  detector: (v: string, path: string) => { kind: "full_redact" | "partial_redact" | "none"; patternId: string },
  path = ""
): RedactionResult {
  const redactions: RedactionMeta[] = [];
  let originalSize = 0;
  let redactedSize = 0;
  
  if (obj === null || obj === undefined) {
    return { redacted: obj, redactions, redactionRatio: 0, originalSize: 0, redactedSize: 0 };
  }
  
  if (typeof obj === "string") {
    originalSize = obj.length;
    const result = redactValue(obj, path || "root", (v) => detector(v, path || "root"));
    redactedSize = result.redacted.length;
    redactions.push(...result.redactions);
    
    return {
      redacted: result.redacted,
      redactions,
      redactionRatio: redactions.length > 0 ? 1 : 0,
      originalSize,
      redactedSize
    };
  }
  
  if (typeof obj === "number" || typeof obj === "boolean") {
    return { redacted: obj, redactions, redactionRatio: 0, originalSize: 0, redactedSize: 0 };
  }
  
  if (Array.isArray(obj)) {
    const redactedArray: unknown[] = [];
    
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      const itemPath = `${path}[${i}]`;
      
      if (typeof item === "string") {
        originalSize += item.length;
        const result = redactValue(item, itemPath, (v) => detector(v, itemPath));
        redactedArray.push(result.redacted);
        redactedSize += result.redacted.length;
        redactions.push(...result.redactions);
      } else {
        const nested = redactObject(item, detector, itemPath);
        redactedArray.push(nested.redacted);
        redactions.push(...nested.redactions);
        originalSize += nested.originalSize;
        redactedSize += nested.redactedSize;
      }
    }
    
    return {
      redacted: redactedArray,
      redactions,
      redactionRatio: calculateRatio(redactions, originalSize),
      originalSize,
      redactedSize
    };
  }
  
  if (typeof obj === "object") {
    const redactedObj: Record<string, unknown> = {};
    const objKeys = Object.keys(obj as Record<string, unknown>);
    
    for (const key of objKeys) {
      const value = (obj as Record<string, unknown>)[key];
      const valuePath = path ? `${path}.${key}` : key;
      
      if (typeof value === "string") {
        originalSize += value.length;
        const result = redactValue(value, valuePath, (v) => detector(v, valuePath));
        redactedObj[key] = result.redacted;
        redactedSize += result.redacted.length;
        redactions.push(...result.redactions);
      } else if (value !== null && typeof value === "object") {
        const nested = redactObject(value, detector, valuePath);
        redactedObj[key] = nested.redacted;
        redactions.push(...nested.redactions);
        originalSize += nested.originalSize;
        redactedSize += nested.redactedSize;
      } else {
        redactedObj[key] = value;
      }
    }
    
    return {
      redacted: redactedObj,
      redactions,
      redactionRatio: calculateRatio(redactions, originalSize),
      originalSize,
      redactedSize
    };
  }
  
  return { redacted: obj, redactions, redactionRatio: 0, originalSize: 0, redactedSize: 0 };
}

function calculateRatio(redactions: RedactionMeta[], originalSize: number): number {
  if (originalSize === 0 || redactions.length === 0) return 0;
  
  const totalRedactedLength = redactions.reduce((sum, r) => sum + r.length, 0);
  return Math.min(totalRedactedLength / originalSize, 1);
}

export function generateDryRunReport(result: RedactionResult): DryRunReport {
  const fieldsAffected = [...new Set(result.redactions.map(r => r.path))];
  
  const severityBreakdown = {
    full_redact: result.redactions.filter(r => r.kind === "full_redact").length,
    partial_redact: result.redactions.filter(r => r.kind === "partial_redact").length,
    none: result.redactions.filter(r => r.kind === "none").length
  };
  
  const warning = result.redactionRatio > config.maxRatio
    ? `High redaction ratio: ${(result.redactionRatio * 100).toFixed(1)}% (threshold: ${config.maxRatio * 100}%)`
    : null;
  
  return {
    wouldRedact: result.redactions.length > 0,
    totalRedactions: result.redactions.length,
    fieldsAffected,
    severityBreakdown,
    redactionRatio: result.redactionRatio,
    warning
  };
}

export function redactText(
  text: string,
  detector: (v: string, path: string) => { kind: "full_redact" | "partial_redact" | "none"; patternId: string }
): { text: string; redactions: RedactionMeta[]; ratio: number } {
  if (!text) return { text, redactions: [], ratio: 0 };
  
  const cleaned = stripAllMemoryTags(text);
  
  if (isStringifiedJson(cleaned)) {
    const parsed = safeParse(cleaned);
    if (parsed !== null) {
      const result = redactObject(parsed, detector);
      return {
        text: safeStringify(result.redacted),
        redactions: result.redactions,
        ratio: result.redactionRatio
      };
    }
  }
  
  const result = redactValue(cleaned, "text", (v) => detector(v, "text"));
  return {
    text: result.redacted,
    redactions: result.redactions,
    ratio: result.redactions.length > 0 ? 1 : 0
  };
}

export function redactToolData(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: unknown,
  detector: (v: string, path: string) => { kind: "full_redact" | "partial_redact" | "none"; patternId: string }
): {
  input: Record<string, unknown>;
  output: unknown;
  redactions: RedactionMeta[];
  ratio: number;
  dryRunReport?: DryRunReport;
} {
  if (!config.enabled) {
    return {
      input: toolInput,
      output: toolOutput,
      redactions: [],
      ratio: 0
    };
  }
  
  const inputResult = redactObject(toolInput, detector, "input");
  const outputResult = redactObject(toolOutput, detector, "output");
  
  const allRedactions = [...inputResult.redactions, ...outputResult.redactions];
  const totalOriginal = inputResult.originalSize + outputResult.originalSize;
  const ratio = totalOriginal > 0 
    ? (allRedactions.reduce((s, r) => s + r.length, 0) / totalOriginal)
    : 0;
  
  const result: {
    input: Record<string, unknown>;
    output: unknown;
    redactions: RedactionMeta[];
    ratio: number;
    dryRunReport?: DryRunReport;
  } = {
    input: inputResult.redacted as Record<string, unknown>,
    output: outputResult.redacted,
    redactions: allRedactions,
    ratio
  };
  
  if (config.dryRun) {
    result.dryRunReport = generateDryRunReport({
      redacted: { input: result.input, output: result.output },
      redactions: allRedactions,
      redactionRatio: ratio,
      originalSize: totalOriginal,
      redactedSize: inputResult.redactedSize + outputResult.redactedSize
    });
  }
  
  return result;
}
