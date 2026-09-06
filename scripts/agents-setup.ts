import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AGENTS } from "@certus/shared";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function findEnvPath(): string {
  const direct = join(repoRoot, ".env");
  if (existsSync(direct)) return direct;
  throw new Error("No .env found at the repo root. Run: cp .env.example .env");
}

function setVar(raw: string, name: string, value: string): string {
  const lines = raw.split("\n");
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${name}=`)) {
      found = true;
      const current = trimmed.slice(name.length + 1);
      if (current !== "") return line;
      return `${name}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${name}=${value}`);
  return next.join("\n");
}

function currentValue(raw: string, name: string): string | undefined {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const v = trimmed.slice(name.length + 1);
      return v === "" ? undefined : v;
    }
  }
  return undefined;
}

function main(): void {
  const envPath = findEnvPath();
  const raw = readFileSync(envPath, "utf8");
  let next = raw;
  const generated: string[] = [];
  const existing: string[] = [];

  for (const agent of AGENTS) {
    const current = currentValue(raw, agent.envKey);
    if (current) {
      existing.push(`${agent.kind}  ${privateKeyToAccount(current as `0x${string}`).address}  (existing key)`);
      continue;
    }
    const key = generatePrivateKey();
    next = setVar(next, agent.envKey, key);
    generated.push(`${agent.kind}  ${privateKeyToAccount(key).address}  (new key)`);
  }

  if (generated.length > 0) {
    if (!next.endsWith("\n")) next += "\n";
    writeFileSync(envPath, next);
  }

  console.log(`.env updated in place: ${generated.length} new key(s), ${existing.length} existing left untouched`);
  console.log("");
  console.log("agent addresses to fund (STT for gas + tUSDC for collateral each):");
  for (const line of [...generated, ...existing]) console.log(`  ${line}`);
  console.log("");
  console.log("STT faucet:    https://testnet.somnia.network");
  console.log("tUSDC faucet:  SomniaHacks dev group faucet topic https://t.me/+XHq0F0JXMyhmMzM0");
  console.log("");
  console.log("Keys stay in .env (gitignored). Addresses only are printed here.");
}

main();
