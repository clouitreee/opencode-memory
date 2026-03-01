# opencode-memory

Persistent memory system for [OpenCode](https://opencode.ai) - cross-session context with AI compression.

## Install

```bash
curl -fsSL https://i.longmem.workers.dev/install | bash
```

## Uninstall

```bash
curl -fsSL https://i.longmem.workers.dev/uninstall | bash
```

Purge all data:

```bash
curl -fsSL https://i.longmem.workers.dev/uninstall | bash -s -- --purge
```

## Manual

```bash
curl -fsSLo install.sh https://i.longmem.workers.dev/install
cat install.sh
bash install.sh
```

## How It Works

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Your Session   │───>│  opencode-memory │───>│  SQLite + FTS5  │
│  (tools, chat)  │    │  (compression)   │    │  (persistent)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                                              │
         └──────────── Context Injection ──────────────┘
                     (next session)
```

### Automatic Flow

1. **You work** → Plugin observes tool usage
2. **Session ends** → AI compresses observations
3. **New session** → Relevant context injected automatically

## Features

| Feature | Description |
|---------|-------------|
| **Persistent Memory** | Context survives between sessions |
| **AI Compression** | Observations compressed to essentials |
| **Temporal Decay** | Recent work weighted higher |
| **Smart Injection** | Only relevant context loaded |
| **Full-Text Search** | FTS5 with Porter stemmer |
| **Privacy Tags** | `<private>...</private>` excludes content |
| **User-Level Memory** | Cross-project preferences |
| **Secrets Detection** | Automatic redaction of API keys |
| **Memory Budget** | Garbage collection for old data |

## Slash Commands

After installation, these commands are available in OpenCode:

| Command | Description |
|---------|-------------|
| `/mem-stats` | Show memory statistics |
| `/mem-doctor` | Run diagnostics with detailed logs |
| `/mem-purge` | Show instructions to purge all data |

## Configuration

### API Keys (Automatic)

The plugin reads API keys from OpenCode's config automatically. No manual setup needed!

If you want to override:

```bash
# Option 1: Environment variable
export OPENROUTER_API_KEY="your-key"

# Option 2: OpenCode config (~/.config/opencode/config.json)
{
  "provider": {
    "openrouter": {
      "options": {
        "apiKey": "your-key"
      }
    }
  }
}
```

### Provider Selection

```bash
# Use OpenAI instead of OpenRouter
export OPENCODE_MEMORY_PROVIDER="openai"
export OPENAI_API_KEY="your-key"

# Or use a specific model
export OPENCODE_MEMORY_MODEL="gpt-4o-mini"
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

### mem-search Tool

Query past work with natural language:

```
What bugs did we fix in the auth module?
```

```
Show me recent work on this project
```

#### Operations

| Operation | Description | Example |
|-----------|-------------|---------|
| `search` | Full-text search | `mem-search search "database schema"` |
| `sessions` | List sessions | `mem-search sessions` |
| `prompts` | Search prompts | `mem-search prompts "bug fix"` |
| `by_file` | By file path | `mem-search by_file "auth.ts"` |
| `by_type` | By type | `mem-search by_type "bugfix"` |
| `concepts` | Top concepts | `mem-search concepts` |
| `recent` | Recent work | `mem-search recent 20` |
| `user` | User memories | `mem-search user` |
| `stats` | Statistics | `mem-search stats` |

### Privacy Tags

Exclude sensitive content from memory:

```
My API key is <private>sk-xxxxx</private> but I need help with...
```

## Troubleshooting

### Plugin not loading

```bash
# Check if installed
ls ~/.local/share/opencode/plugins/opencode-memory/dist/plugin.js

# Check config
cat ~/.config/opencode/config.json | grep opencode-memory

# Re-run install
curl -fsSL https://i.longmem.workers.dev/install | bash
```

### "No API key found" warning

The plugin couldn't find an API key. Solutions:

1. **Your OpenCode config already has one**: Just restart opencode
2. **Set env var**: `export OPENROUTER_API_KEY="your-key"`
3. **Add to config**: See Configuration section above

### Database errors

```bash
# Check database
bun -e '
  const { Database } = require("bun:sqlite");
  const db = new Database(process.env.HOME + "/.opencode-memory/memory.db");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='"'"'table'"'"'").all();
  console.log("Tables:", tables.map(t => t.name).join(", "));
'

# Reset database (WARNING: deletes all memories)
rm -rf ~/.opencode-memory
```

### Compression errors

```bash
# Check your API key is valid
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models

# Try a different model
export OPENCODE_MEMORY_MODEL="anthropic/claude-3.5-haiku"
```

### Tool not found

```bash
# Verify plugin is loaded
opencode run "mem-search stats" --print-logs 2>&1 | grep -i memory

# Restart opencode
# The plugin registers the tool at startup
```

### Complete reset

```bash
# Uninstall completely
curl -fsSL https://i.longmem.workers.dev/uninstall | bash -s -- --purge

# Reinstall
curl -fsSL https://i.longmem.workers.dev/install | bash
```

## Architecture

```
~/.opencode-memory/
├── memory.db              # SQLite database with FTS5
├── memory.db-wal          # Write-ahead log
└── migrations_state/      # Migration markers
```

### Database Tables

| Table | Description |
|-------|-------------|
| `sessions` | OpenCode sessions |
| `observations` | Tool usage (compressed) |
| `summaries` | Session summaries |
| `user_observations` | Cross-project memories |
| `concepts` | Extracted concepts |
| `compression_queue` | Async compression |

### Hooks

| Event | Action |
|-------|--------|
| `session.created` | Inject context |
| `chat.message` | Save prompts |
| `tool.execute.after` | Queue observation |
| `session.idle` | Generate summary |
| `session.deleted` | Mark completed |

## Development

```bash
# Clone and install
git clone https://github.com/clouitreee/opencode-memory
cd opencode-memory
bun install

# Build
bun run build

# Test
bun test

# Run locally
bun link
# Then add to OpenCode config: "plugin": ["opencode-memory"]
```

## Recommended Models

| Provider | Model | Notes |
|----------|-------|-------|
| OpenRouter | `anthropic/claude-haiku-4.5` | Default, fast & cheap |
| OpenRouter | `anthropic/claude-sonnet-4.6` | Better quality |
| OpenAI | `gpt-4o-mini` | Fast and cheap |
| Local | `llama3.2` | Privacy via Ollama |

## Security

### Secrets Detection

The plugin automatically redacts:
- AWS keys (`AKIA...`)
- GitHub tokens (`ghp_...`)
- OpenAI keys (`sk-...`)
- JWT tokens (`eyJ...`)
- Private keys (`-----BEGIN...`)
- Database URLs with passwords
- Environment files (`.env`)

### Threat Model

| Asset | Threat | Impact | Mitigation |
|-------|--------|--------|------------|
| Install scripts | Malicious code injection | System compromise | Review before running; use version pinning |
| API keys | Credential theft | Account compromise | Read from OpenCode config; never log; redact in memory |
| Memory DB | Data exposure | Information leak | Local only; secrets redacted; user controls data |
| Config files | Tampering | Plugin behavior change | Timestamped backups; idempotent operations |

### Supply Chain

- **Install script**: Served via Cloudflare Worker with version pinning
- **Version pinning**: Use `?ref=v0.1.0` to pin to specific version
- **npm package**: Will be signed when published
- **Dependencies**: Minimal (only `openai` SDK + `@opencode-ai/plugin`)

## Comparison vs claude-mem

| Feature | opencode-memory | claude-mem |
|---------|----------------|------------|
| Platform | OpenCode | Claude Code |
| API Key Config | Automatic | Manual env var |
| Compression | Async queue | Sync/blocking |
| Temporal decay | ✅ | ❌ |
| User-level memory | ✅ | ❌ |
| Secrets detection | ✅ | ❌ |
| Memory budget | ✅ | ❌ |
| Shortlink installer | ✅ | ❌ |

## License

MIT
