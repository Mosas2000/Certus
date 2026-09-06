export type AgentKind =
  | "momentum"
  | "mean-reversion"
  | "market-maker"
  | "chimp"
  | "llm";

export interface AgentDefinition {
  kind: AgentKind;
  name: string;
  glyph: string;
  envKey: string;
  description: string;
}

export const AGENTS: readonly AgentDefinition[] = [
  {
    kind: "momentum",
    name: "Momentum",
    glyph: "▲",
    envKey: "AGENT_MOMENTUM_PRIVATE_KEY",
    description: "Chases short-window drift in the Up probability and rides it",
  },
  {
    kind: "mean-reversion",
    name: "Mean Reversion",
    glyph: "⇄",
    envKey: "AGENT_MEANREV_PRIVATE_KEY",
    description: "Fades deviations from the opening implied probability",
  },
  {
    kind: "market-maker",
    name: "Market Maker",
    glyph: "≡",
    envKey: "AGENT_MAKER_PRIVATE_KEY",
    description: "Two-sided post-only quoting with an inventory cap",
  },
  {
    kind: "chimp",
    name: "Chimp",
    glyph: "?",
    envKey: "AGENT_CHIMP_PRIVATE_KEY",
    description: "Uniformly random control group: the beat-me line",
  },
  {
    kind: "llm",
    name: "Reasoner",
    glyph: "✳",
    envKey: "AGENT_LLM_PRIVATE_KEY",
    description: "LLM-driven decisions wrapped in the same safety harness",
  },
];

export const AGENT_KINDS: readonly AgentKind[] = AGENTS.map((a) => a.kind);

export type AssetSymbol = "BTC" | "ETH";

export type MarketPhase = "Listed" | "Trading" | "Locked" | "Resolved" | "Finalized";

export interface MarketRow {
  marketId: string;
  venueId: string;
  asset: string;
  intervalSec: number;
  strike: string | null;
  tradingStart: number;
  expiry: number;
  status: string;
  pool: string;
  lastPrice: number | null;
  oracleQuestionId: string | null;
}

export interface FillRow {
  marketId: string;
  agentKind: AgentKind;
  txHash: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  filledAt: number;
}

export interface BalanceSnapshotRow {
  marketId: string;
  agentKind: AgentKind;
  collateralBalance: string;
  yesBalance: string;
  noBalance: string;
  capturedAt: number;
}

export interface PnlSnapshotRow {
  marketId: string;
  agentKind: AgentKind;
  realized: number | null;
  unrealized: number | null;
  capturedAt: number;
}

export interface ReasoningRow {
  agentKind: "llm";
  marketId: string;
  observation: string;
  thought: string;
  action: string;
  confidence: number;
  source: "anthropic" | "fallback";
  createdAt: number;
}

export interface SweeperResultRow {
  marketId: string;
  agentKind: AgentKind;
  outcomeIdx: 0 | 1;
  amount: string;
  txHash: string | null;
  rescued: string;
  createdAt: number;
}

export interface LeaderboardEntry {
  agentKind: AgentKind;
  name: string;
  glyph: string;
  equity: number;
  realizedPnl: number;
  openPosition: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  winningsRescued: number;
}
