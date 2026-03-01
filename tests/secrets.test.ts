import { describe, test, expect } from "bun:test";
import {
  redactSecrets,
  isContextSensitive,
  shouldFullyRedact,
  shannonEntropy,
  getSecurityConfig,
  type ToolContext,
  type SecurityConfig
} from "../src/secrets";

describe("secrets.ts", () => {
  describe("Layer 1: Contextual Awareness", () => {
    test("should fully redact .env files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/project/.env" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact .env.local files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/project/.env.local" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact .pem files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/project/cert.pem" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact SSH private keys", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/home/user/.ssh/id_rsa" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact credentials.json files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/project/credentials.json" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact AWS credentials files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/home/user/.aws/credentials" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact npmrc files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/home/user/.npmrc" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact kubeconfig files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/home/user/.kube/kubeconfig" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact 'env' bash command", () => {
      const ctx: ToolContext = {
        toolName: "bash",
        toolInput: { command: "env" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact 'printenv' bash command", () => {
      const ctx: ToolContext = {
        toolName: "bash",
        toolInput: { command: "printenv" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact 'cat .env' bash command", () => {
      const ctx: ToolContext = {
        toolName: "bash",
        toolInput: { command: "cat .env" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact 'echo $SECRET' bash command", () => {
      const ctx: ToolContext = {
        toolName: "bash",
        toolInput: { command: "echo $API_KEY" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should fully redact 'aws configure' bash command", () => {
      const ctx: ToolContext = {
        toolName: "bash",
        toolInput: { command: "aws configure" }
      };
      expect(isContextSensitive(ctx)).toBe("full_redact");
    });
    
    test("should NOT fully redact regular files", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/project/src/index.ts" }
      };
      expect(isContextSensitive(ctx)).toBe("scan");
    });
    
    test("should NOT fully redact regular bash commands", () => {
      const ctx: ToolContext = {
        toolName: "bash",
        toolInput: { command: "npm test" }
      };
      expect(isContextSensitive(ctx)).toBe("scan");
    });
    
    test("shouldFullyRedact returns correct boolean", () => {
      expect(shouldFullyRedact({ toolName: "Read", toolInput: { filePath: ".env" } })).toBe(true);
      expect(shouldFullyRedact({ toolName: "Read", toolInput: { filePath: "src/index.ts" } })).toBe(false);
    });
  });
  
  describe("Layer 2: Pattern Matching", () => {
    test("should redact AWS Access Keys", () => {
      const text = "AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact GitHub tokens", () => {
      const text = "GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("ghp_");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact OpenAI API keys", () => {
      const text = "OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("sk-proj-");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact Anthropic API keys", () => {
      const text = "ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("sk-ant-");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact JWT tokens", () => {
      const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact private keys", () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MbxClZ9HhVLrWlNm
-----END RSA PRIVATE KEY-----`;
      const result = redactSecrets(text);
      expect(result.text).not.toContain("BEGIN RSA PRIVATE KEY");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact database connection strings", () => {
      const text = "DATABASE_URL=postgres://user:password@localhost:5432/mydb";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("password");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact URL with embedded credentials", () => {
      const text = "mongodb://admin:secret123@mongodb.example.com:27017/db";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("secret123");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact Stripe API keys", () => {
      const text = "STRIPE_KEY=sk_test_NOTAREALSECRETKEY12345ABC";
      const result = redactSecrets(text);
      expect(result.text).toContain("[REDACTED]");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact Slack tokens", () => {
      const text = "SLACK_TOKEN=xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("xoxb-");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact Google API keys", () => {
      const text = "GOOGLE_API_KEY=AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("AIzaSy");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact npm tokens", () => {
      const text = "NPM_TOKEN=npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("npm_");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact SendGrid keys", () => {
      const text = "SENDGRID_KEY=SG.xxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyy";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("SG.");
      expect(result.redactedCount).toBeGreaterThan(0);
    });
    
    test("should redact Bearer tokens", () => {
      const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const result = redactSecrets(text);
      expect(result.text).toContain("[REDACTED]");
    });
    
    test("should redact generic secret assignments", () => {
      const text = "password=SuperSecret123!";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("SuperSecret123!");
    });
    
    test("should redact API_KEY assignments", () => {
      const text = "api_key=my-super-secret-key-12345";
      const result = redactSecrets(text);
      expect(result.text).not.toContain("my-super-secret-key-12345");
    });
  });
  
  describe("Layer 3: Entropy Detection", () => {
    test("should detect high entropy strings", () => {
      const highEntropyString = "xK9mP2vL8nQ5rT7wY3zA6bC4dE1fG0hJ";
      const entropy = shannonEntropy(highEntropyString);
      expect(entropy).toBeGreaterThan(4.0);
    });
    
    test("should NOT flag low entropy strings", () => {
      const lowEntropyString = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const entropy = shannonEntropy(lowEntropyString);
      expect(entropy).toBeLessThan(1.0);
    });
    
    test("should redact high entropy strings without known pattern", () => {
      const text = "API_TOKEN=aB3dE7fG9hJ2kL5mN8pQ1rS4tU6vW0xY";
      const result = redactSecrets(text);
      expect(result.redactedCount).toBeGreaterThan(0);
    });
  });
  
  describe("Layer 4: Allowlist (False Positives)", () => {
    test("should NOT redact git SHA hashes", () => {
      const text = "commit abcdef1234567890abcdef1234567890abcdef12";
      const result = redactSecrets(text);
      expect(result.text).toContain("abcdef1234567890abcdef1234567890abcdef12");
    });
    
    test("should NOT redact UUIDs", () => {
      const text = "id: 550e8400-e29b-41d4-a716-446655440000";
      const result = redactSecrets(text);
      expect(result.text).toContain("550e8400-e29b-41d4-a716-446655440000");
    });
    
    test("should NOT redact semantic versions", () => {
      const text = "version: v1.2.3";
      const result = redactSecrets(text);
      expect(result.text).toContain("v1.2.3");
    });
    
    test("should NOT redact URLs without credentials", () => {
      const text = "https://github.com/user/repo";
      const result = redactSecrets(text);
      expect(result.text).toContain("https://github.com/user/repo");
    });
    
    test("should NOT redact package names", () => {
      const text = "package: @opencode-ai/plugin";
      const result = redactSecrets(text);
      expect(result.text).toContain("@opencode-ai/plugin");
    });
    
    test("should NOT redact common code keywords", () => {
      const text = "function constTest() { return undefined; }";
      const result = redactSecrets(text);
      expect(result.text).toContain("function");
      expect(result.text).toContain("return");
      expect(result.text).toContain("undefined");
    });
  });
  
  describe("Full Redaction (Context Sensitive)", () => {
    test("should fully redact .env file content", () => {
      const ctx: ToolContext = {
        toolName: "Read",
        toolInput: { filePath: "/project/.env" }
      };
      const text = "API_KEY=supersecret123\nDB_PASSWORD=anothersecret456";
      const result = redactSecrets(text, ctx);
      expect(result.text).toBe("[REDACTED]");
      expect(result.redactedCount).toBe(1);
    });
    
    test("should fully redact 'env' command output", () => {
      const ctx: ToolContext = {
        toolName: "bash",
        toolInput: { command: "env" }
      };
      const text = "PATH=/usr/bin\nHOME=/home/user\nSECRET_TOKEN=abc123";
      const result = redactSecrets(text, ctx);
      expect(result.text).toBe("[REDACTED]");
      expect(result.redactedCount).toBe(1);
    });
  });
  
  describe("Edge Cases", () => {
    test("should handle empty text", () => {
      const result = redactSecrets("");
      expect(result.text).toBe("");
      expect(result.redactedCount).toBe(0);
    });
    
    test("should handle null gracefully", () => {
      const result = redactSecrets(null as unknown as string);
      expect(result.text).toBe(null);
      expect(result.redactedCount).toBe(0);
    });
    
    test("should handle undefined gracefully", () => {
      const result = redactSecrets(undefined as unknown as string);
      expect(result.text).toBe(undefined);
      expect(result.redactedCount).toBe(0);
    });
    
    test("should preserve normal code", () => {
      const text = `
function calculateSum(a: number, b: number): number {
  return a + b;
}

const result = calculateSum(5, 10);
console.log(result);
`;
      const result = redactSecrets(text);
      expect(result.text).toContain("function calculateSum");
      expect(result.text).toContain("return a + b");
      expect(result.text).toContain("const result");
    });
    
    test("should handle mixed content", () => {
      const text = `
// Configuration
const apiKey = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456";
const timeout = 5000;

function fetchData() {
  return fetch("https://api.example.com/data", {
    headers: { "Authorization": "Bearer secret_token_12345" }
  });
}
`;
      const result = redactSecrets(text);
      expect(result.text).toContain("const timeout = 5000");
      expect(result.text).toContain("function fetchData");
      expect(result.text).not.toContain("sk-proj-AbCdEfGh");
    });
    
    test("should respect disabled config", () => {
      const text = "API_KEY=supersecret123";
      const config: SecurityConfig = {
        enabled: false,
        logRedactions: false,
        redactionPlaceholder: "[REDACTED]",
        maxOutputSize: 8192,
        entropyThreshold: 4.0,
        minSecretLength: 16,
        maxSecretLength: 200
      };
      const result = redactSecrets(text, undefined, config);
      expect(result.text).toBe(text);
      expect(result.redactedCount).toBe(0);
    });
    
    test("should use custom placeholder", () => {
      const text = "API_KEY=supersecret123";
      const config: SecurityConfig = {
        enabled: true,
        logRedactions: false,
        redactionPlaceholder: "***SECRET***",
        maxOutputSize: 8192,
        entropyThreshold: 4.0,
        minSecretLength: 16,
        maxSecretLength: 200
      };
      const result = redactSecrets(text, undefined, config);
      expect(result.text).toContain("***SECRET***");
    });
  });
  
  describe("Multiple Secrets", () => {
    test("should redact multiple secrets in one text", () => {
      const text = `
AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DATABASE_URL=postgres://admin:secret@localhost:5432/db
`;
      const result = redactSecrets(text);
      expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.text).not.toContain("ghp_");
      expect(result.text).not.toContain("secret");
      expect(result.redactedCount).toBeGreaterThanOrEqual(3);
    });
    
    test("should track all redacted secrets", () => {
      const text = "token1=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\ntoken2=sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const result = redactSecrets(text);
      expect(result.redactedSecrets.length).toBe(result.redactedCount);
    });
  });
  
  describe("Real-world Scenarios", () => {
    test("should redact .env file content safely", () => {
      const ctx: ToolContext = { toolName: "Read", toolInput: { filePath: ".env" } };
      const text = `
NODE_ENV=production
DATABASE_URL=postgres://user:P@ssw0rd!@db.example.com:5432/production
REDIS_URL=redis://:secretredis@redis.example.com:6379
API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789
JWT_SECRET=my-super-secret-jwt-key-do-not-share
`;
      const result = redactSecrets(text, ctx);
      expect(result.text).toBe("[REDACTED]");
      expect(result.warnings.length).toBeGreaterThan(0);
    });
    
    test("should redact docker-compose.yml secrets", () => {
      const text = `
services:
  app:
    environment:
      - DATABASE_PASSWORD=SuperSecretDbPassword123!
      - API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz
`;
      const result = redactSecrets(text);
      expect(result.text).not.toContain("SuperSecretDbPassword123!");
      expect(result.text).not.toContain("sk-1234567890abcdefghijklmnopqrstuvwxyz");
    });
    
    test("should redact kubernetes secrets", () => {
      const text = `
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
stringData:
  username: admin
  password: SuperSecretPassword123!
`;
      const result = redactSecrets(text);
      expect(result.text).not.toContain("SuperSecretPassword123!");
    });
    
    test("should preserve safe file content", () => {
      const text = `
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ message: 'Hello World' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`;
      const result = redactSecrets(text);
      expect(result.text).toBe(text);
      expect(result.redactedCount).toBe(0);
    });
    
    test("should redact bash output with secrets", () => {
      const text = `
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=us-east-1
`;
      const result = redactSecrets(text);
      expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.text).not.toContain("wJalrXUtnFEMI");
    });
  });
  
  describe("Security Config", () => {
    test("should return default config", () => {
      const config = getSecurityConfig();
      expect(config.enabled).toBe(true);
      expect(config.redactionPlaceholder).toBe("[REDACTED]");
      expect(config.maxOutputSize).toBe(8192);
    });
  });
});
