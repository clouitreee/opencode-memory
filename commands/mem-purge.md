---
description: Show instructions to purge all memory data
---

Memory purge removes all stored memories permanently.

**Warning: This action cannot be undone.**

To purge all memory data:

```bash
curl -fsSL https://i.longmem.workers.dev/uninstall | bash -s -- --purge
```

This will:
1. Remove the plugin from OpenCode
2. Delete all stored memories
3. Remove the database file (~/.opencode-memory/)

**Important:** You must confirm the purge when prompted. The script will ask for confirmation before deleting anything.

If you only want to uninstall without deleting memories:

```bash
curl -fsSL https://i.longmem.workers.dev/uninstall | bash
```
