const PRIVATE_TAG = "private";
const CONTEXT_TAG = "opencode-memory-context";
const MAX_OUTPUT_SIZE = 8192;

const PRIVATE_REGEX = /<private>[\s\S]*?<\/private>/gi;
const CONTEXT_REGEX = /<opencode-memory-context>[\s\S]*?<\/opencode-memory-context>/gi;

export function stripPrivateTags(text: string): string {
  if (!text) return text;
  return text.replace(PRIVATE_REGEX, "").trim();
}

export function stripContextTags(text: string): string {
  if (!text) return text;
  return text.replace(CONTEXT_REGEX, "").trim();
}

export function stripAllMemoryTags(text: string): string {
  if (!text) return text;
  return text.replace(PRIVATE_REGEX, "").replace(CONTEXT_REGEX, "").trim();
}

export function hasPrivateContent(text: string): boolean {
  if (!text) return false;
  return PRIVATE_REGEX.test(text);
}

export function isFullyPrivate(text: string): boolean {
  if (!text) return true;
  const stripped = stripPrivateTags(text);
  return stripped.trim().length === 0;
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
    while ((match = pattern.exec(text)) !== null) {
      const file = match[1];
      if (file && file.length > 2 && !file.startsWith("http")) {
        files.add(file);
      }
    }
  }
  
  return Array.from(files);
}

export function truncateOutput(output: unknown, maxSize = MAX_OUTPUT_SIZE): string {
  const str = typeof output === "string" ? output : JSON.stringify(output);
  
  if (str.length <= maxSize) {
    return str;
  }
  
  return str.slice(0, maxSize) + "\n... [truncated, original size: " + str.length + " chars]";
}

export function truncateInput(input: unknown, maxSize = MAX_OUTPUT_SIZE): string {
  const str = typeof input === "string" ? input : JSON.stringify(input);
  
  if (str.length <= maxSize) {
    return str;
  }
  
  return str.slice(0, maxSize) + "\n... [truncated]";
}
