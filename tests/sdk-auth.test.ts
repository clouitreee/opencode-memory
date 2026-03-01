import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getOpenCodeAuthPath, getOpenCodeAuth, getApiKeyFromAuth } from "../src/sdk";

describe("SDK Authentication (isolated in /tmp)", () => {
  let tempDir = "";
  let authPath = "";

  beforeEach(() => {
    // Create temp directory for this test
    tempDir = mkdtempSync(join(tmpdir(), "opencode-memory-test-"));
    authPath = join(tempDir, "auth.json");
    // Override the path via env var - this isolates tests completely
    process.env.OPENCODE_AUTH_PATH = authPath;
  });

  afterEach(() => {
    // Clean up env var
    delete process.env.OPENCODE_AUTH_PATH;
    // Clean up temp directory
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Already deleted or permission issue
      }
    }
  });

  describe("getOpenCodeAuthPath", () => {
    test("should return env var path when OPENCODE_AUTH_PATH is set", () => {
      const path = getOpenCodeAuthPath();
      expect(path).toBe(authPath);
      expect(path).toContain("opencode-memory-test-");
    });

    test("should return default path when env var not set", () => {
      delete process.env.OPENCODE_AUTH_PATH;
      const path = getOpenCodeAuthPath();
      expect(path).toContain(".local");
      expect(path).toContain("opencode");
      expect(path).toContain("auth.json");
    });
  });

  describe("getOpenCodeAuth", () => {
    test("should read valid auth.json from temp location", () => {
      const testAuth = {
        openrouter: {
          type: "api",
          key: "sk-or-v1-test-key-12345"
        },
        openai: {
          type: "api",
          apiKey: "sk-test-key-openai-67890"
        }
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const auth = getOpenCodeAuth();
      expect(auth).not.toBeNull();
      expect(auth?.openrouter).toBeDefined();
      expect(auth?.openai).toBeDefined();
    });

    test("should return null if auth.json does not exist", () => {
      // Don't write any file - authPath doesn't exist
      const auth = getOpenCodeAuth();
      expect(auth).toBeNull();
    });

    test("should return null if auth.json is invalid JSON", () => {
      // Write invalid JSON
      writeFileSync(authPath, "{ invalid json }", "utf8");
      const auth = getOpenCodeAuth();
      expect(auth).toBeNull();
    });

    test("should return null if auth.json is empty", () => {
      writeFileSync(authPath, "", "utf8");
      const auth = getOpenCodeAuth();
      expect(auth).toBeNull();
    });
  });

  describe("getApiKeyFromAuth", () => {
    test("should extract 'key' field from auth entry", () => {
      const testAuth = {
        openrouter: {
          type: "api",
          key: "sk-or-v1-from-key-field"
        }
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const key = getApiKeyFromAuth("openrouter");
      expect(key).toBe("sk-or-v1-from-key-field");
    });

    test("should extract 'apiKey' field from auth entry", () => {
      const testAuth = {
        openai: {
          type: "api",
          apiKey: "sk-from-apiKey-field"
        }
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const key = getApiKeyFromAuth("openai");
      expect(key).toBe("sk-from-apiKey-field");
    });

    test("should extract 'token' field from auth entry", () => {
      const testAuth = {
        anthropic: {
          type: "api",
          token: "sk-from-token-field"
        }
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const key = getApiKeyFromAuth("anthropic");
      expect(key).toBe("sk-from-token-field");
    });

    test("should prefer 'key' over 'apiKey' and 'token'", () => {
      const testAuth = {
        multikey: {
          type: "api",
          key: "prefer-key",
          apiKey: "fallback-apiKey",
          token: "fallback-token"
        }
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const key = getApiKeyFromAuth("multikey");
      expect(key).toBe("prefer-key");
    });

    test("should return null if provider not in auth.json", () => {
      const testAuth = {
        openrouter: {
          type: "api",
          key: "some-key"
        }
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const key = getApiKeyFromAuth("nonexistent");
      expect(key).toBeNull();
    });

    test("should return null if auth.json missing", () => {
      // No file written
      const key = getApiKeyFromAuth("openrouter");
      expect(key).toBeNull();
    });

    test("should return null if auth entry has no key/apiKey/token", () => {
      const testAuth = {
        openrouter: {
          type: "api"
          // No key, apiKey, or token fields
        }
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const key = getApiKeyFromAuth("openrouter");
      expect(key).toBeNull();
    });

    test("should return null if auth entry is empty object", () => {
      const testAuth = {
        openrouter: {}
      };
      writeFileSync(authPath, JSON.stringify(testAuth), "utf8");

      const key = getApiKeyFromAuth("openrouter");
      expect(key).toBeNull();
    });
  });

  describe("Safety: no real homedir auth.json touched", () => {
    test("should not access homedir when OPENCODE_AUTH_PATH env var is set", () => {
      // Even though the real auth.json might exist, we're using our temp file
      const auth = getOpenCodeAuth();
      // With empty temp dir, should return null (no file there)
      expect(auth).toBeNull();

      // Write to our temp file
      writeFileSync(authPath, JSON.stringify({ test: { key: "test-value" } }), "utf8");
      const auth2 = getOpenCodeAuth();
      expect(auth2).not.toBeNull();
      expect(auth2?.test).toBeDefined();
    });
  });
});
