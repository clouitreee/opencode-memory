import { describe, test, expect } from "bun:test";
import { safeParseLLMJson } from "../src/utils/safeJson";

describe("safeParseLLMJson", () => {
  const fallback = { compressed_summary: "", concepts: [], confidence: 0 };

  describe("Direct parse", () => {
    test("should parse valid JSON", () => {
      const input = '{"compressed_summary": "test", "concepts": ["a"], "confidence": 0.9}';
      const result = safeParseLLMJson(input, { fallback });
      expect(result.ok).toBe(true);
      expect(result.value.compressed_summary).toBe("test");
      expect(result.value.concepts).toEqual(["a"]);
      expect(result.value.confidence).toBe(0.9);
    });

    test("should handle empty string", () => {
      const result = safeParseLLMJson("", { fallback });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("empty content");
      expect(result.value).toEqual(fallback);
    });

    test("should handle non-string input", () => {
      const result = safeParseLLMJson(null, { fallback });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("empty content");
    });
  });

  describe("Fenced block extraction", () => {
    test("should extract JSON from ```json block", () => {
      const input = '```json\n{"compressed_summary": "test", "concepts": ["a"], "confidence": 0.9}\n```';
      const result = safeParseLLMJson(input, { fallback });
      expect(result.ok).toBe(true);
      expect(result.value.compressed_summary).toBe("test");
    });

    test("should extract JSON from ``` block without json tag", () => {
      const input = '```\n{"compressed_summary": "test", "concepts": ["a"], "confidence": 0.9}\n```';
      const result = safeParseLLMJson(input, { fallback });
      expect(result.ok).toBe(true);
      expect(result.value.compressed_summary).toBe("test");
    });

    test("should extract JSON from ```json block with extra text", () => {
      const input = 'Here is the result:\n```json\n{"compressed_summary": "test", "concepts": ["a"], "confidence": 0.9}\n```\nLet me know if you need more.';
      const result = safeParseLLMJson(input, { fallback });
      expect(result.ok).toBe(true);
      expect(result.value.compressed_summary).toBe("test");
    });
  });

  describe("Substring extraction", () => {
    test("should extract JSON between first { and last }", () => {
      const input = 'Here is the result: {"compressed_summary": "test", "concepts": ["a"], "confidence": 0.9} end';
      const result = safeParseLLMJson(input, { fallback });
      expect(result.ok).toBe(true);
      expect(result.value.compressed_summary).toBe("test");
    });

    test("should handle unterminated string in JSON (edge case)", () => {
      const input = '{"compressed_summary": "test';
      const result = safeParseLLMJson(input, { fallback });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("json_parse_failed");
    });
  });

  describe("Fallback and error handling", () => {
    test("should return fallback when all parse attempts fail", () => {
      const input = "this is not valid json at all {";
      const result = safeParseLLMJson(input, { fallback });
      expect(result.ok).toBe(false);
      expect(result.value).toEqual(fallback);
      expect(result.error).toContain("json_parse_failed");
    });

    test("should include truncated snippet in error", () => {
      const input = "some very long text that is not json at all and goes on and on and on";
      const result = safeParseLLMJson(input, { fallback, maxSnippet: 50 });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("snippet=");
      expect(result.error.length).toBeLessThan(200);
    });

    test("should use custom maxSnippet", () => {
      const input = "a".repeat(1000);
      const result = safeParseLLMJson(input, { fallback, maxSnippet: 100 });
      expect(result.ok).toBe(false);
      expect(result.error.length).toBeLessThan(500);
    });
  });
});
