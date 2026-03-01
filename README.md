# opencode-memory

Persistent memory system for [OpenCode](https://opencode.ai) - cross-session context with AI compression.

## Features

- **Persistent Memory** - Context survives between sessions
- **AI Compression** - Observations automatically compressed via async queue
- **Temporal Decay** - Recent observations weighted higher in search
- **Smart Context Injection** - First prompt used to find relevant context
- **Full-Text Search** - FTS5 with Porter stemmer + unicode61
- **Privacy Tags** - `<private>...</private>` excludes sensitive content
- **User-Level Memory** - Cross-project preferences and patterns
- **Concept Graph** - Automatic concept extraction with frequencies
- **Memory Budget** - Garbage collection for old observations
- **Custom Tool** - `mem-search` with 11 operations

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

### API Keys

Set environment variables for the LLM provider:

```bash
# Option 1: OpenRouter (recommended, default)
export OPENROUTER_API_KEY="your-key-here"

# Option 2: OpenAI
export OPENCODE_MEMORY_PROVIDER="openai"
export OPENAI_API_KEY="your-key-here"

# Option 3: Moonshot (Kimi)
export OPENCODE_MEMORY_PROVIDER="moonshot"
export MOONSHOT_API_KEY="your-key-here"

# Option 4: Zhipu (GLM)
export OPENCODE_MEMORY_PROVIDER="zhipu"
export ZHIPU_API_KEY="your-key-here"

# Custom model
export OPENCODE_MEMORY_MODEL="openrouter/z-ai/glm-5"
```

### Memory Settings

```typescript
import { setMemoryConfig } from "opencode-memory";

setMemoryConfig({
  max_observations_per_project: 500,
  max_observations_per_user: 2000,
  max_age_days: 90,
  gc_enabled: true,
  gc_interval_hours: 24
});
```

## Usage

### Automatic Context Injection

When you start a new session, opencode-memory:
1. Analyzes your first prompt
2. Searches for relevant past observations
3. Injects context + user-level preferences

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

#### Available Operations

| Operation | Description |
|-----------|-------------|
| `search` | Full-text search with temporal decay |
| `sessions` | Search/list sessions |
| `prompts` | Search user prompts |
| `by_file` | Observations for a file |
| `by_type` | Filter by type (bugfix, feature, etc.) |
| `by_concept` | Observations by concept/tag |
| `concepts` | Top concepts with frequencies |
| `recent` | Recent observations |
| `user` | User-level memories (cross-project) |
| `stats` | Memory statistics |

## Architecture

```
~/.opencode-memory/
├── memory.db              # SQLite database with FTS5
├── memory.db-wal          # Write-ahead log
└── migrations_state/      # Migration markers

opencode-memory/
├── src/
│   ├── plugin.ts          # Main plugin entry
│   ├── db.ts              # SQLite + queue + GC
│   ├── sdk.ts             # Provider-agnostic AI SDK
│   ├── search.ts          # FTS5 with temporal decay
│   ├── privacy.ts         # Tag stripping + truncation
│   └── tools/
│       └── mem-search.ts  # Custom search tool
└── migrations/
    ├── 001_init.sql       # Base schema
    └── 002_fixes_and_features.sql  # New features
```

## Database Schema

### Core Tables

| Table | Description |
|-------|-------------|
| `sessions` | OpenCode sessions with scope |
| `observations` | Tool usage observations |
| `summaries` | AI-generated session summaries |
| `user_observations` | Cross-project user memories |

### Supporting Tables

| Table | Description |
|-------|-------------|
| `concepts` | Extracted concepts with frequencies |
| `observation_concepts` | Many-to-many relationship |
| `compression_queue` | Async compression jobs |
| `memory_config` | Configuration settings |

### FTS5 Tables

- `observations_fts` - Full-text search on observations
- `prompts_fts` - Search user prompts
- `user_observations_fts` - Search user memories

## Hooks

| OpenCode Event | Action |
|----------------|--------|
| `session.created` | Inject smart context + user memories |
| `chat.message` | Save user prompts |
| `tool.execute.after` | Queue observation for compression |
| `session.idle` | Generate summary, extract user memory |
| `session.deleted` | Mark session completed |
| `session.compacted` | Inject memory context |

## API

### MemorySDK

```typescript
import { MemorySDK } from "opencode-memory";

const sdk = new MemorySDK(); // Auto-config from env

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

// Extract user-level memory
const userMemory = await sdk.extractUserMemory([
  "Pattern: prefers TypeScript",
  "Pattern: uses Bun runtime"
]);
```

### Search

```typescript
import { searchObservations, smartContextInjection } from "opencode-memory";

// Full-text search with temporal decay
const results = searchObservations("authentication bug", "my-project");

// Smart context based on prompt
const context = smartContextInjection("my-project", "fix login bug");
```

### Database

```typescript
import { 
  getStats, 
  runGarbageCollection, 
  getTopConcepts 
} from "opencode-memory";

// Get statistics
const stats = getStats();
console.log(`Observations: ${stats.totalObservations}`);

// Run garbage collection
const gc = runGarbageCollection();
console.log(`Deleted: ${gc.observationsDeleted} observations`);

// Top concepts
const concepts = getTopConcepts(20);
```

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Type check
bun run typecheck

# Run migrations manually
bun run db:migrate

# Test
bun test
```

## Recommended Models

For AI compression, these models work well:

| Provider | Model | Notes |
|----------|-------|-------|
| OpenRouter | `z-ai/glm-5` | Default, 200K context, excellent for coding |
| OpenRouter | `moonshotai/kimi-k2` | Strong alternative |
| OpenAI | `gpt-4o-mini` | Fast and cheap |
| Local | `llama3.2` | Privacy-first via Ollama |

## Comparison vs claude-mem

| Feature | opencode-memory | claude-mem |
|---------|----------------|------------|
| Platform | OpenCode | Claude Code |
| Runtime | Bun native | Node.js + Bun |
| Compression | Async queue | Sync/blocking |
| Temporal decay | ✅ | ❌ |
| User-level memory | ✅ | ❌ |
| Concept graph | ✅ | ❌ |
| Memory budget | ✅ | ❌ |
| Smart context | ✅ | ❌ |

## License

MIT

## Credits

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by @thedotmack.
