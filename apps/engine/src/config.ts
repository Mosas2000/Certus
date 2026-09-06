import type { AgentKind } from "@certus/shared";

export interface TradingConfig {
  dryRun: boolean;
  positionCapContracts: number;
  takeSizeContracts: number;
  momentumDrift: number;
  meanrevDeviation: number;
  meanrevExitBand: number;
  mmSpread: number;
  mmQuoteSize: number;
  chimpProb: number;
  chimpMaxSize: number;
}

function readNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return n;
}

export function loadTradingConfig(dryRun: boolean): TradingConfig {
  return {
    dryRun,
    positionCapContracts: readNum("AGENT_POSITION_CAP", 20),
    takeSizeContracts: readNum("AGENT_TAKE_SIZE", 2),
    momentumDrift: readNum("MOMENTUM_DRIFT", 0.05),
    meanrevDeviation: readNum("MEANREV_DEVIATION", 0.08),
    meanrevExitBand: readNum("MEANREV_EXIT_BAND", 0.03),
    mmSpread: readNum("MM_SPREAD", 0.03),
    mmQuoteSize: readNum("MM_QUOTE_SIZE", 3),
    chimpProb: readNum("CHIMP_PROB", 0.15),
    chimpMaxSize: readNum("CHIMP_MAX_SIZE", 3),
  };
}

export interface AgentWindow {
  asset: string;
  intervalSec: number;
}

export const AGENT_WINDOWS: Record<AgentKind, AgentWindow | null> = {
  momentum: { asset: "BTC", intervalSec: 3600 },
  "mean-reversion": { asset: "ETH", intervalSec: 3600 },
  "market-maker": { asset: "BTC", intervalSec: 3600 },
  chimp: null,
  llm: null,
};

export const AGENT_TICK_MS = 15_000;
export const MIN_SECONDS_LEFT = 600;
export const GAS_RESERVE_STT = 0.7;
