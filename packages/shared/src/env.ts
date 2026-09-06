import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "dotenv";
import {
  DEFAULT_INDEXER_URL,
  DEFAULT_RPC_URL,
  DEFAULT_VENUE_ID,
  DEFAULT_WS_RPC_URL,
} from "./network";
import { AGENTS } from "./types";

export interface CertusEnv {
  privateKey: `0x${string}`;
  venueId: `0x${string}`;
  rpcUrl: string;
  wsRpcUrl: string;
  indexerUrl: string;
  dryRun: boolean;
  dbPath: string;
  pollIntervalMs: number;
  claimScan: number;
  sweepIntervalMs: number;
  agentKeys: Record<string, `0x${string}` | undefined>;
  anthropicApiKey: string | undefined;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function requireHex0x(name: string, value: string | undefined): `0x${string}` {
  if (!value || value === "0x...") {
    throw new Error(`Missing ${name}. Copy .env.example to .env and set it.`);
  }
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed hex string.`);
  }
  return value as `0x${string}`;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Math.floor(n);
}

export function loadEnv(): CertusEnv {
  const root = findRepoRoot(process.cwd());
  const envPath = join(root, ".env");
  if (existsSync(envPath)) {
    config({ path: envPath });
  }

  const privateKey = requireHex0x("PRIVATE_KEY", process.env.PRIVATE_KEY);
  const venueId = requireHex0x("VENUE_ID", process.env.VENUE_ID ?? DEFAULT_VENUE_ID);

  const agentKeys: Record<string, `0x${string}` | undefined> = {};
  for (const agent of AGENTS) {
    const raw = process.env[agent.envKey];
    agentKeys[agent.kind] =
      raw && raw !== "" && raw !== "0x..." && /^0x[0-9a-fA-F]+$/.test(raw)
        ? (raw as `0x${string}`)
        : undefined;
  }

  const dbPathRaw = process.env.DB_PATH ?? "data/certus.sqlite";

  return {
    privateKey,
    venueId,
    rpcUrl: process.env.RPC_URL ?? DEFAULT_RPC_URL,
    wsRpcUrl: process.env.WS_RPC_URL ?? DEFAULT_WS_RPC_URL,
    indexerUrl: process.env.INDEXER_URL ?? DEFAULT_INDEXER_URL,
    dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
    dbPath: resolve(root, dbPathRaw),
    pollIntervalMs: readInt("POLL_INTERVAL_MS", 30_000),
    claimScan: readInt("CLAIM_SCAN", 20),
    sweepIntervalMs: readInt("SWEEP_INTERVAL_MS", 600_000),
    agentKeys,
    anthropicApiKey:
      process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== ""
        ? process.env.ANTHROPIC_API_KEY
        : undefined,
  };
}
