# opencode-memory Cloudflare Worker

Shortlink installer for opencode-memory.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/install` | Installation script |
| `/uninstall` | Uninstallation script |
| `/verify` | Verification script |
| `/health` | Health check |

## Deploy

```bash
# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
cd cloudflare-worker
wrangler deploy
```

## Version Pinning

Default version is set in `wrangler.toml` (`DEFAULT_REF`).

Override with query param:
```bash
curl -fsSL "https://i.longmem.workers.dev/install?ref=v0.1.0" | bash
```

## Local Development

```bash
wrangler dev

# Test
curl -fsSL http://127.0.0.1:8787/install | head
curl -fsSL http://127.0.0.1:8787/health
```

## Updating Default Version

1. Create a new release/tag on GitHub
2. Update `DEFAULT_REF` in `wrangler.toml`
3. Run `wrangler deploy`
