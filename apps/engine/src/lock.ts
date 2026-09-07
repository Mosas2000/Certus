import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function engineLockPath(dbPath: string): string {
  return join(dirname(dbPath), "engine.lock");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireEngineLock(dbPath: string): void {
  const lockPath = engineLockPath(dbPath);
  if (existsSync(lockPath)) {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid && pidAlive(pid)) {
      console.error(
        `REFUSING TO START: another engine (pid ${pid}) holds ${lockPath}. Two engines on one key race nonces — stop the other process first.`,
      );
      process.exit(1);
    }
  }
  writeFileSync(lockPath, `${process.pid}\n`);
}

export function releaseEngineLock(dbPath: string): void {
  const lockPath = engineLockPath(dbPath);
  if (!existsSync(lockPath)) return;
  const raw = readFileSync(lockPath, "utf8").trim();
  if (Number(raw) === process.pid) {
    rmSync(lockPath);
  }
}
