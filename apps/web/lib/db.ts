import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

let cached: Database.Database | null | undefined;

export function getDb(): Database.Database | null {
  if (cached !== undefined) return cached;
  const envPath = process.env.DB_PATH;
  const path = envPath && existsSync(envPath)
    ? envPath
    : join(findRepoRoot(process.cwd()), "data", "certus.sqlite");
  if (!existsSync(path)) {
    cached = null;
    return cached;
  }
  try {
    cached = new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    cached = null;
  }
  return cached;
}
