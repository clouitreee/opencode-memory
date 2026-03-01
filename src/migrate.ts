import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Database } from "bun:sqlite";

const DATA_DIR = join(homedir(), ".opencode-memory");
const DB_PATH = join(DATA_DIR, "memory.db");
const MIGRATION_PATH = join(import.meta.dir, "..", "migrations", "001_init.sql");

console.log("opencode-memory migration tool");
console.log("==============================");
console.log(`Database path: ${DB_PATH}`);
console.log("");

if (!existsSync(DATA_DIR)) {
  console.log(`Creating data directory: ${DATA_DIR}`);
  Bun.write(join(DATA_DIR, ".gitkeep"), "");
}

console.log("Running migrations...");

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

if (existsSync(MIGRATION_PATH)) {
  const migration = readFileSync(MIGRATION_PATH, "utf-8");
  db.exec(migration);
  console.log("✓ Migrations applied successfully");
} else {
  console.error("✗ Migration file not found:", MIGRATION_PATH);
  process.exit(1);
}

const tables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
`).all() as Array<{ name: string }>;

console.log("");
console.log("Tables created:");
for (const t of tables) {
  console.log(`  - ${t.name}`);
}

db.close();
console.log("");
console.log("Done!");
