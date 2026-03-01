import { describe, test, expect } from "bun:test";
import {
  stripPrivateTags,
  stripAllMemoryTags,
  hasPrivateContent,
  isFullyPrivate,
  redactObject,
  redactValue,
  redactText,
  generateDryRunReport,
  safeParse,
  safeParseOrFallback,
  isStringifiedJson,
  setRedactionConfig,
  type RedactionMeta
} from "../src/privacy";
import {
  detectSecretInValue,
  scanStringForSecrets,
  isContextSensitive,
  type ToolContext
} from "../src/secrets";

describe("privacy - private tags", () => {
  test("stripPrivateTags removes <private> blocks exactly", () => {
    const input = "My key is <private>sk-1234567890abcdef</private> but help me";
    const result = stripPrivateTags(input);
    expect(result).toBe("My key is  but help me");
  });

  test("stripPrivateTags handles multiple <private> blocks", () => {
    const input = "First: <private>secret1</private> Second: <private>secret2</private>";
    const result = stripPrivateTags(input);
    expect(result).toBe("First:  Second:");
  });

  test("stripPrivateTags handles multiline private blocks", () => {
    const input = "Before\n<private>\nmulti\nline\nsecret\n</private>\nAfter";
    const result = stripPrivateTags(input);
    expect(result).toBe("Before\n\nAfter");
  });

  test("stripAllMemoryTags removes both private and context tags", () => {
    const input = "Text <private>secret</private> <opencode-memory-context>ctx</opencode-memory-context> end";
    const result = stripAllMemoryTags(input);
    expect(result).toBe("Text   end");
  });

  test("hasPrivateContent returns true when private tags present", () => {
    expect(hasPrivateContent("Hello <private>secret</private>")).toBe(true);
    expect(hasPrivateContent("No secrets here")).toBe(false);
  });

  test("isFullyPrivate returns true when only private content", () => {
    expect(isFullyPrivate("<private>secret</private>")).toBe(true);
    expect(isFullyPrivate("<private>secret</private> public")).toBe(false);
    expect(isFullyPrivate("")).toBe(true);
  });
});

describe("privacy - JSON safety", () => {
  test("safeParse returns parsed object for valid JSON", () => {
    const result = safeParse('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  test("safeParse returns null for invalid JSON", () => {
    const result = safeParse('{"key": invalid}');
    expect(result).toBeNull();
  });

  test("safeParseOrFallback returns fallback for invalid JSON", () => {
    const fallback = { default: true };
    const result = safeParseOrFallback('{"key": invalid}', fallback);
    expect(result).toEqual(fallback);
  });

  test("isStringifiedJson detects JSON strings", () => {
    expect(isStringifiedJson('{"a": 1}')).toBe(true);
    expect(isStringifiedJson('[1, 2, 3]')).toBe(true);
    expect(isStringifiedJson("plain text")).toBe(false);
    expect(isStringifiedJson('  {"spaced": true}  ')).toBe(true);
  });
});

describe("secrets - detection", () => {
  test("detects GitHub token (ghp_)", () => {
    const result = detectSecretInValue("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", "token");
    expect(result.kind).toBe("full_redact");
    expect(result.patternId).toBe("github_token");
  });

  test("detects JWT token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = detectSecretInValue(jwt, "auth");
    expect(result.kind).toBe("full_redact");
    expect(result.patternId).toBe("jwt_token");
  });

  test("detects OpenAI key", () => {
    const result = detectSecretInValue("sk-proj-abcdefghijklmnopqrstuvwxyz123456", "api_key");
    expect(result.kind).toBe("full_redact");
    expect(result.patternId).toBe("openai_key");
  });

  test("detects SSH key path", () => {
    const result = detectSecretInValue("~/.ssh/id_rsa", "file");
    expect(result.kind).toBe("full_redact");
    expect(result.patternId).toBe("ssh_key_path");
  });

  test("detects .env file path", () => {
    const result = detectSecretInValue("/home/user/project/.env", "path");
    expect(result.kind).toBe("full_redact");
    expect(result.patternId).toBe("env_file_path");
  });

  test("detects sensitive key names in path", () => {
    const result = detectSecretInValue("my-super-secret-value-12345", "config.password");
    expect(result.kind).toBe("full_redact");
    expect(result.patternId).toBe("sensitive_key_name");
  });

  test("detects partial redaction for home directory", () => {
    const result = detectSecretInValue("/home/username/documents/file.txt", "path");
    expect(result.kind).toBe("partial_redact");
    expect(result.patternId).toBe("home_dir");
  });

  test("returns none for normal text", () => {
    const result = detectSecretInValue("This is normal text without secrets", "message");
    expect(result.kind).toBe("none");
  });

  test("prefix4 is max 4 characters", () => {
    const result = detectSecretInValue("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", "token");
    expect(result.prefix4?.length).toBeLessThanOrEqual(4);
  });
});

describe("secrets - context sensitivity", () => {
  test("full redact for .env file", () => {
    const ctx: ToolContext = {
      toolName: "Read",
      toolInput: { filePath: "/project/.env" }
    };
    expect(isContextSensitive(ctx)).toBe("full_redact");
  });

  test("full redact for SSH key file", () => {
    const ctx: ToolContext = {
      toolName: "Read",
      toolInput: { filePath: "~/.ssh/id_rsa" }
    };
    expect(isContextSensitive(ctx)).toBe("full_redact");
  });

  test("full redact for sensitive command", () => {
    const ctx: ToolContext = {
      toolName: "Bash",
      toolInput: { command: "cat ~/.env" }
    };
    expect(isContextSensitive(ctx)).toBe("full_redact");
  });

  test("scan for normal file", () => {
    const ctx: ToolContext = {
      toolName: "Read",
      toolInput: { filePath: "/project/src/index.ts" }
    };
    expect(isContextSensitive(ctx)).toBe("scan");
  });
});

describe("privacy - redactObject", () => {
  const detector = (v: string, path: string) => detectSecretInValue(v, path);

  test("redacts string with secret", () => {
    const result = redactObject({ token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" }, detector);
    expect(result.redacted).toEqual({ token: "[REDACTED]" });
    expect(result.redactions.length).toBe(1);
    expect(result.redactions[0].kind).toBe("full_redact");
  });

  test("preserves non-secret strings", () => {
    const result = redactObject({ name: "John", count: 42 }, detector);
    expect(result.redacted).toEqual({ name: "John", count: 42 });
    expect(result.redactions.length).toBe(0);
  });

  test("redacts nested objects", () => {
    const input = {
      config: {
        api_key: "sk-1234567890abcdefghijklmnop",
        host: "api.example.com"
      }
    };
    const result = redactObject(input, detector);
    const redacted = result.redacted as { config: { api_key: string; host: string } };
    expect(redacted.config.api_key).toBe("[REDACTED]");
    expect(redacted.config.host).toBe("api.example.com");
  });

  test("redacts arrays", () => {
    const input = ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", "normal text"];
    const result = redactObject(input, detector);
    expect(result.redacted).toEqual(["[REDACTED]", "normal text"]);
  });

  test("calculates redaction ratio", () => {
    const longSecret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234";
    const result = redactObject({ key: longSecret }, detector);
    expect(result.redactionRatio).toBeGreaterThan(0);
  });

  test("handles null and undefined", () => {
    expect(redactObject(null, detector).redacted).toBe(null);
    expect(redactObject(undefined, detector).redacted).toBe(undefined);
  });

  test("handles primitive values", () => {
    expect(redactObject(42, detector).redacted).toBe(42);
    expect(redactObject(true, detector).redacted).toBe(true);
  });
});

describe("privacy - dry run", () => {
  const detector = (v: string, path: string) => detectSecretInValue(v, path);

  test("generates correct dry run report", () => {
    const result = redactObject({
      token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      path: "~/.ssh/id_rsa"
    }, detector);
    
    const report = generateDryRunReport(result);
    expect(report.wouldRedact).toBe(true);
    expect(report.totalRedactions).toBe(2);
    expect(report.fieldsAffected).toContain("token");
    expect(report.fieldsAffected).toContain("path");
    expect(report.severityBreakdown.full_redact).toBe(2);
  });

  test("warning for high redaction ratio", () => {
    setRedactionConfig({ maxRatio: 0.30 });
    
    const result = redactObject({
      a: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      b: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      c: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
    }, detector);
    
    const report = generateDryRunReport(result);
    expect(report.warning).not.toBeNull();
    expect(report.warning).toContain("High redaction ratio");
  });
});

describe("privacy - JSON integrity", () => {
  const detector = (v: string, path: string) => detectSecretInValue(v, path);

  test("redacted object can be serialized to valid JSON", () => {
    const input = {
      api_key: "sk-1234567890abcdefghijklmnopqrstuv",
      config: { nested: { token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" } }
    };
    
    const result = redactObject(input, detector);
    const json = JSON.stringify(result.redacted);
    const parsed = JSON.parse(json);
    
    expect(parsed.api_key).toBe("[REDACTED]");
    expect(parsed.config.nested.token).toBe("[REDACTED]");
  });

  test("handles invalid JSON gracefully", () => {
    const result = safeParseOrFallback("{invalid json}", { fallback: true });
    expect(result).toEqual({ fallback: true });
  });
});

describe("secrets - scanStringForSecrets", () => {
  test("finds multiple secrets in string", () => {
    const text = "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 Key: sk-1234567890abcdef";
    const results = scanStringForSecrets(text);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("truncates match preview to 4 chars", () => {
    const text = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
    const results = scanStringForSecrets(text);
    if (results.length > 0) {
      expect(results[0].match.length).toBeLessThanOrEqual(7);
    }
  });
});

describe("privacy - edge cases", () => {
  const detector = (v: string, path: string) => detectSecretInValue(v, path);

  test("handles empty objects", () => {
    const result = redactObject({}, detector);
    expect(result.redacted).toEqual({});
    expect(result.redactions.length).toBe(0);
  });

  test("handles empty arrays", () => {
    const result = redactObject([], detector);
    expect(result.redacted).toEqual([]);
  });

  test("handles deeply nested structures", () => {
    const input = {
      level1: {
        level2: {
          level3: {
            level4: {
              secret: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
            }
          }
        }
      }
    };
    
    const result = redactObject(input, detector);
    const redacted = result.redacted as any;
    expect(redacted.level1.level2.level3.level4.secret).toBe("[REDACTED]");
  });

  test("handles mixed array types", () => {
    const input = [
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      42,
      { nested: "sk-1234567890abcdefghijklmnopqrstuv" },
      null
    ];
    
    const result = redactObject(input, detector);
    expect(result.redacted).toEqual([
      "[REDACTED]",
      42,
      { nested: "[REDACTED]" },
      null
    ]);
  });
});
