import { SOMNIA_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { errText, withRetry, AGENTS, type AgentKind, type CertusEnv } from "@certus/shared";
import { upsertAgentState, type Db } from "../db.js";
import { Harness } from "../harness.js";
import { loadTradingConfig, type TradingConfig } from "../config.js";
import type { AgentStrategy } from "./types.js";
import { MomentumStrategy } from "./momentum.js";
import { MeanReversionStrategy } from "./meanrev.js";
import { MarketMakerStrategy } from "./maker.js";
import { ChimpStrategy } from "./chimp.js";

export interface RunningAgent {
  kind: AgentKind;
  address: `0x${string}`;
  harness: Harness;
  strategy: AgentStrategy;
  timer: NodeJS.Timeout;
}

function buildStrategy(kind: AgentKind, config: TradingConfig): AgentStrategy | null {
  switch (kind) {
    case "momentum":
      return new MomentumStrategy(config);
    case "mean-reversion":
      return new MeanReversionStrategy(config);
    case "market-maker":
      return new MarketMakerStrategy(config);
    case "chimp":
      return new ChimpStrategy(config);
    default:
      return null;
  }
}

export async function startAgents(env: CertusEnv, db: Db): Promise<RunningAgent[]> {
  const config = loadTradingConfig(env.dryRun);
  const running: RunningAgent[] = [];

  for (const def of AGENTS) {
    const key = env.agentKeys[def.kind];
    if (!key) continue;
    const strategy = buildStrategy(def.kind, config);
    if (!strategy) {
      console.log(`[agent ${def.kind}] not started yet (ships in a later phase)`);
      continue;
    }

    const exchange = new SomniaMarkets({
      indexerUrl: env.indexerUrl,
      chain: somniaShannon,
      wsRpcUrl: env.wsRpcUrl,
      addresses: SOMNIA_TESTNET_ADDRESSES,
      privateKey: key,
    });
    try {
      await withRetry(`loadMarkets(${def.kind})`, [3_000], () => exchange.loadMarkets());
    } catch (err) {
      console.error(
        `[agent ${def.kind}] WARNING symbol registry unavailable, logging by marketId: ${errText(err).split("\n")[0]}`,
      );
    }

    const address = privateKeyToAccount(key).address;
    upsertAgentState(db, {
      agentKind: def.kind,
      address,
      paused: false,
      lastErrorAt: null,
      lastError: null,
    });
    const harness = new Harness(exchange, db, env, config, def.kind, address);
    const agent: RunningAgent = {
      kind: def.kind,
      address,
      harness,
      strategy,
      timer: null as unknown as NodeJS.Timeout,
    };

    const tickSafe = async (): Promise<void> => {
      try {
        await strategy.tick(harness);
      } catch (err) {
        console.error(`[agent ${def.kind}] TICK FAILED: ${errText(err).split("\n")[0]}`);
      }
    };
    agent.timer = setInterval(() => {
      void tickSafe();
    }, strategy.tickIntervalMs);
    setTimeout(() => {
      void tickSafe();
    }, 3_000);

    running.push(agent);
    console.log(
      `[agent ${def.kind}] started on ${address} tick=${strategy.tickIntervalMs}ms dryRun=${config.dryRun}`,
    );
  }

  return running;
}

export async function stopAgents(running: RunningAgent[]): Promise<void> {
  for (const agent of running) {
    clearInterval(agent.timer);
    try {
      await agent.strategy.shutdown?.(agent.harness);
    } catch (err) {
      console.error(`[agent ${agent.kind}] shutdown cancel failed: ${errText(err).split("\n")[0]}`);
    }
  }
}
