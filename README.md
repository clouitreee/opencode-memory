# opencode-memory

Persistent memory system for [OpenCode](https://opencode.ai) - cross-session context with AI compression.

## Features

- **Persistent Memory** - Context survives between sessions
- **AI Compression** - Observations are automatically compressed using LLMs
- **Full-Text Search** - FTS5-powered search through all past observations
- **Privacy Tags** - Use `<private>...</private>` to exclude sensitive content
- **Custom Tool** - `mem-search` tool for querying past work
- **Progressive Disclosure** - Search → Timeline → Details

## Installation

### From npm (when published)

```bash
bun add -g opencode-memory
```

### Add to OpenCode config

In your `opencode.json`:

```json
{
  "plugin": ["opencode-memory"]
}
```

Or for local development:

```json
{
  "plugin": ["./path/to/opencode-memory"]
}
```

## Configuration

Set the `OPENROUTER_API_KEY` environment variable for AI compression:

```bash
export OPENROUTER_API_KEY="your-key-here"
```

Or configure a different provider:

```bash
export OPENCODE_MEMORY_PROVIDER="openai"
export OPENAI_API_KEY="your-key-here"
```

## Usage

### Automatic Context Injection

When you start a new session, opencode-memory automatically injects context from previous sessions in the same project.

### Privacy Tags

Exclude sensitive content from memory:

```
My API key is <private>sk-xxxxx</private> but I need help with...
```

### mem-search Tool

Query past work with natural language:

```
What bugs did we fix in the auth module?
```

```
Show me recent work on this project
```

```
What decisions did we make about the database schema?
```

## Architecture

```
~/.opencode-memory/
├── memory.db          # SQLite database with FTS5
└── settings.json      # Configuration

opencode-memory/
├── src/
│   ├── plugin.ts      # Main plugin entry point
│   ├── db.ts          # SQLite operations
│   ├── sdk.ts         # AI compression SDK
│   ├── search.ts      # FTS5 search
│   ├── privacy.ts     # Tag stripping
│   └── tools/
│       └── mem-search.ts  # Custom search tool
└── migrations/
    └── 001_init.sql   # Database schema
```

## Hooks

| OpenCode Event | Action |
|----------------|--------|
| `session.created` | Inject context from previous sessions |
| `chat.message` | Save user prompts |
| `tool.execute.after` | Capture and compress tool usage |
| `session.idle` | Generate session summary |
| `session.deleted` | Mark session completed |
| `session.compacted` | Inject memory context |

## API

### MemorySDK

```typescript
import { MemorySDK } from "opencode-memory";

const sdk = new MemorySDK({
  provider: "openrouter",
  model: "openrouter/z-ai/glm-5",
  apiKey: process.env.OPENROUTER_API_KEY
});

// Compress an observation
const compressed = await sdk.compressObservation(
  "Read",
  { file_path: "/src/auth.ts" },
  "file contents..."
);

// Summarize a session
const summary = await sdk.summarizeSession(
  ["Fix the login bug"],
  ["Read: auth.ts", "Edit: auth.ts"]
);
```

### Search

```typescript
import { searchObservations, getObservationsByFile } from "opencode-memory";

// Full-text search
const results = searchObservations("authentication bug", "my-project");

// By file
const fileObs = getObservationsByFile("/src/auth.ts", "my-project");
```

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests
bun test

# Type check
bun run typecheck

# Manual database migration
bun run db:migrate
```

## Model Recommendations

For best results with AI compression:

1. **GLM-5** (via OpenRouter) - Excellent for coding context, 200K context
2. **Kimi K2.5** - Strong alternative, good for long sessions
3. **GPT-4o-mini** - Fast and cheap for simple compression
4. **Local models** - Use with Ollama for privacy

## License

MIT

## Credits

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by @thedotmack.
