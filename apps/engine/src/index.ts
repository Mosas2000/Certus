import { AGENTS, loadEnv } from "@certus/shared";

function main() {
  const env = loadEnv();

  const funded = AGENTS.filter((a) => env.agentKeys[a.kind]).map((a) => a.kind);
  const missing = AGENTS.filter((a) => !env.agentKeys[a.kind]).map((a) => a.envKey);

  console.log("certus engine scaffold");
  console.log(`network=testnet chain=50312 dryRun=${env.dryRun}`);
  console.log(`db=${env.dbPath}`);
  console.log(`pollIntervalMs=${env.pollIntervalMs} sweepIntervalMs=${env.sweepIntervalMs}`);
  console.log(`agentKeysPresent=${funded.length}/${AGENTS.length}${funded.length ? ` [${funded.join(", ")}]` : ""}`);
  if (missing.length > 0) {
    console.log(`agentKeysMissing=${missing.join(", ")}`);
  }
  console.log("engine core is not implemented yet: work the phase issues in order");
  process.exit(0);
}

main();
