const PRIVATE_TAG = "private";
const CONTEXT_TAG = "opencode-memory-context";
const MAX_TAGS = 100;

export function stripPrivateTags(text: string): string {
  if (!text) return text;
  
  const privateRegex = new RegExp(
    `<${PRIVATE_TAG}>[\\s\\S]*?<\\/${PRIVATE_TAG}>`,
    "gi"
  );
  
  let result = text;
  let count = 0;
  
  while (privateRegex.test(result) && count < MAX_TAGS) {
    result = result.replace(privateRegex, "");
    count++;
  }
  
  return result.trim();
}

export function stripContextTags(text: string): string {
  if (!text) return text;
  
  const contextRegex = new RegExp(
    `<${CONTEXT_TAG}>[\\s\\S]*?<\\/${CONTEXT_TAG}>`,
    "gi"
  );
  
  let result = text;
  let count = 0;
  
  while (contextRegex.test(result) && count < MAX_TAGS) {
    result = result.replace(contextRegex, "");
    count++;
  }
  
  return result.trim();
}

export function stripAllMemoryTags(text: string): string {
  return stripContextTags(stripPrivateTags(text));
}

export function hasPrivateContent(text: string): boolean {
  if (!text) return false;
  return new RegExp(`<${PRIVATE_TAG}>`, "i").test(text);
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
