# LongMem (lmem)

LongMem is an **active memory layer** for terminal-based AI workflows.

Unlike static instruction files (`claude.md`) or manual memory dumps (`memory.md`), LongMem actively observes, extracts, stores, and injects relevant technical context while your agent works.

## Why LongMem

Terminal agents are good at short, local reasoning, but they usually forget everything between sessions.

That creates repeated work:
- Re-explaining project setup
- Repeating environment constraints
- Re-solving the same errors
- Losing technical decisions made in earlier sessions

LongMem solves this by:
- **Watching** your session and extracting useful memories automatically
- **Storing** relevant context locally with semantic embeddings
- **Feeding** the right context back when you need it

## What makes it different

| Static files | LongMem |
|--------------|---------|
| Manual updates | Automatic extraction |
| User maintains | System observes and learns |
| Static context | Dynamic, relevant context |
| Copy/paste | Pipes and streams |

## MVP Scope

This repository currently focuses on a small local MVP.

**Included:**
- Active memory capture via `watch` command
- Local JSON-based persistence
- Semantic retrieval using local embeddings
- Context block generation for prompt injection
- Basic secret filtering

**Not included yet:**
- Background daemon
- File watch mode
- Shell hooks
- Remote sync
- Multi-user support

## Commands

### Core commands

- `init` — Initialize LongMem state
- `capture` — Store a conversation turn manually
- `retrieve` — Search for relevant memories
- `list` — List stored memories
- `stats` — Show memory statistics
- `delete` — Delete a memory by ID

### Runtime commands (active memory)

- `watch` — Watch stdin and extract memories automatically
- `context` — Get relevant context for a task

Run help:
```bash
longmem --help
```

## Installation

### Option 1: Local developer build

```bash
git clone https://github.com/clouitreee/lmem.git
cd lmem
cargo build --release
./target/release/longmem --help
```

### Option 2: Local cargo install

```bash
cargo install --path .
longmem --help
```

### Option 3: Prebuilt binary

When release binaries are available, installation instructions will be provided here.

## Quick Start

Initialize local state:

```bash
longmem init --project my-project
```

### Manual workflow (capture)

Capture a memory from a session:

```bash
longmem capture -u "I hit a 502 error" -m "nginx -t showed an upstream config issue"
```

### Active workflow (watch + context)

Watch a session and extract memories automatically:

```bash
# Pipe agent output to lmem watch
some-agent-command | longmem watch --project my-project

# Or manually pipe text
echo "Error: port 8080 blocked. Fixed by changing to port 3000." | longmem watch
```

Get relevant context for a task:

```bash
longmem context "fix port errors"
```

List stored memories:

```bash
longmem list
```

Show stats:

```bash
longmem stats
```

## Storage

LongMem stores data locally on the machine.

Default storage location:
- Linux: `~/.local/share/com.longmem.LongMem/`
- macOS: `~/Library/Application Support/com.longmem.LongMem/`
- Windows: `%LOCALAPPDATA%\com.longmem.LongMem\`

Custom path can be specified with `--path` flag or `LONGMEM_PATH` environment variable.

Storage structure:
```
<storage_path>/
├── config.json      # Configuration
└── memories/        # Individual memory files (JSON)
```

## Embeddings and Retrieval

LongMem uses local embeddings for semantic retrieval without external APIs.

The current implementation uses a lightweight hash-based embedding approach suitable for MVP. This can be replaced with more sophisticated embedding models in future versions.

All computation happens locally on the user's machine.

## Security and Privacy

LongMem is designed to keep memory data local. No data is sent to external services by default.

**Basic secret filtering** is implemented in `watch` mode:
- Detects common patterns: API keys, passwords, tokens, secrets
- Skips lines matching these patterns
- **Warning**: This is NOT comprehensive. Do not rely on it for sensitive data.

Stored memories may include technical context such as:
- File paths
- Commands
- Environment details
- Error descriptions

Review local file permissions and avoid storing secrets in plain text.

## Limitations

Current limitations include:

- MVP scope only (limited features)
- No remote sync
- Simple embedding strategy
- No advanced memory consolidation pipeline
- CLI-first workflow only

## Development

Format and lint:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
```

Run tests:

```bash
cargo test
```

Build release binary:

```bash
cargo build --release
```

## Testing

Recommended verification flow:

1. Initialize LongMem: `longmem init --project test`
2. Capture at least one memory: `longmem capture -u "test" -m "response"`
3. Retrieve that memory with a related query: `longmem retrieve -q "test"`
4. Confirm output is stable and readable

## Roadmap

Planned next steps (in no particular order):

- Better memory scoring and ranking
- Project-level isolation
- Safer persistence format evolution (schema migrations)
- Optional shell integration
- Better install and release packaging
- Import/export functionality

## License

TBD
