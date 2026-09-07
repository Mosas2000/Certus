import { SOMNIA_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { AGENTS, errText, loadEnv, withRetry } from "@certus/shared";
import { marketCount, openDb } from "./db.js";
import { runCycle } from "./poller.js";
import { startAgents, stopAgents, type RunningAgent } from "./agents/runner.js";
import { acquireEngineLock, releaseEngineLock } from "./lock.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const db = openDb(env.dbPath);
  acquireEngineLock(env.dbPath);

  const exchange = new SomniaMarkets({
    indexerUrl: env.indexerUrl,
    chain: somniaShannon,
    wsRpcUrl: env.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey: env.privateKey,
  });

  let registryOk = true;
  try {
    await withRetry("loadMarkets", [3_000, 10_000], () => exchange.loadMarkets());
  } catch (err) {
    registryOk = false;
    console.error(`WARNING symbol registry unavailable, fill symbols will be blank: ${errText(err).split("\n")[0]}`);
  }

  const configuredAgents = AGENTS.filter((a) => env.agentKeys[a.kind]);
  console.log(
    `certus engine started: db=${env.dbPath} dryRun=${env.dryRun} pollIntervalMs=${env.pollIntervalMs} agents=${configuredAgents.length}/${AGENTS.length} registry=${registryOk ? "ok" : "degraded"}`,
  );

  let running = true;
  let cycle = 0;
  let cycleInFlight = false;

  const tick = async (): Promise<void> => {
    if (!running || cycleInFlight) return;
    cycleInFlight = true;
    cycle += 1;
    const started = Date.now();
    try {
      const result = await runCycle(exchange, db, env, configuredAgents);
      for (const err of result.errors) {
        console.error(`[cycle ${cycle}] ${err}`);
      }
      console.log(
        `[cycle ${cycle}] markets=${marketCount(db)} (live=${result.liveMarkets} finalizedUpdated=${result.finalizedUpdated} rechecked=${result.rechecked}) agents=${result.agents} newFills=${result.newFills} balanceSnapshots=${result.balanceSnapshots} pnlSnapshots=${result.pnlSnapshots} errors=${result.errors.length} took=${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      console.error(`[cycle ${cycle}] FATAL cycle error: ${errText(err)}`);
    } finally {
      cycleInFlight = false;
    }
  };

  await tick();
  const timer = setInterval(() => {
    void tick();
  }, env.pollIntervalMs);

  const agents: RunningAgent[] = await startAgents(env, db);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;
    clearInterval(timer);
    console.log(`certus engine stopping on ${signal}: markets=${marketCount(db)}`);
    void stopAgents(agents)
      .catch((err) => {
        console.error(`agent shutdown error: ${errText(err).split("\n")[0]}`);
      })
      .finally(() => {
        releaseEngineLock(env.dbPath);
        db.close();
        process.exit(0);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`certus engine failed to start: ${errText(err)}`);
  process.exit(1);
});
