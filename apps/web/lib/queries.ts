import type Database from "better-sqlite3";
import type { AgentKind, FillRow, ReasoningRow } from "@certus/shared";
import { AGENTS } from "@certus/shared";
import { getDb } from "./db";

export interface EquityPoint {
  at: number;
  collateral: number;
}

export interface AgentCard {
  kind: AgentKind;
  name: string;
  glyph: string;
  description: string;
  address: string | null;
  paused: boolean;
  lastError: string | null;
  equity: number | null;
  equityCurve: EquityPoint[];
  openPosition: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  winningsRescued: number;
  realizedPnl: number;
}

export interface AgentDetail {
  card: AgentCard;
  fills: (FillRow & { decimals: number })[];
  balances: {
    marketId: string;
    asset: string;
    intervalSec: number | null;
    status: string;
    yesBalance: number;
    noBalance: number;
    oracleQuestionId: string | null;
  }[];
  reasoning: ReasoningRow[];
}

export interface LeaderboardRow extends AgentCard {
  rank: number;
}

const FALLBACK_COLLATERAL_DECIMALS = 6;

function collateralDecimals(db: Database.Database): number {
  const row = db
    .prepare(`select quoteDecimals from markets where quoteDecimals > 0 order by expiry desc limit 1`)
    .get() as { quoteDecimals: number } | undefined;
  return row?.quoteDecimals ?? FALLBACK_COLLATERAL_DECIMALS;
}

function scaleOf(db: Database.Database): number {
  return 10 ** collateralDecimals(db);
}

function latestWalletCollateral(db: Database.Database, kind: AgentKind): { series: EquityPoint[] } {
  const rows = db
    .prepare(
      `select capturedAt, collateralBalance from balance_snapshots
       where agentKind = ? and marketId = '' order by capturedAt asc limit 500`,
    )
    .all(kind) as { capturedAt: number; collateralBalance: string }[];
  const scale = scaleOf(db);
  return {
    series: rows.map((r) => ({ at: r.capturedAt, collateral: Number(r.collateralBalance) / scale })),
  };
}

function openPosition(db: Database.Database, kind: AgentKind): number {
  const rows = db
    .prepare(
      `select b.marketId, b.capturedAt, b.yesBalance, b.noBalance, m.quoteDecimals
       from balance_snapshots b
       join markets m on m.marketId = b.marketId
       where b.agentKind = ? and m.status = 'Trading'
       order by b.capturedAt asc`,
    )
    .all(kind) as {
    marketId: string;
    capturedAt: number;
    yesBalance: string;
    noBalance: string;
    quoteDecimals: number;
  }[];
  const latest = new Map<string, { yes: number; no: number }>();
  for (const r of rows) {
    const scale = 10 ** r.quoteDecimals;
    latest.set(r.marketId, {
      yes: Number(r.yesBalance) / scale,
      no: Number(r.noBalance) / scale,
    });
  }
  let total = 0;
  for (const v of latest.values()) total += v.yes + v.no;
  return total;
}

function winStats(db: Database.Database, kind: AgentKind): { wins: number; losses: number; realized: number } {
  const rows = db
    .prepare(
      `select p.marketId, p.capturedAt, p.realized, m.quoteDecimals from pnl_snapshots p
       join markets m on m.marketId = p.marketId
       where p.agentKind = ? and m.status = 'Finalized' and p.realized is not null
       order by p.capturedAt asc`,
    )
    .all(kind) as { marketId: string; capturedAt: number; realized: string; quoteDecimals: number }[];
  const latest = new Map<string, number>();
  for (const r of rows) latest.set(r.marketId, Number(r.realized) / 10 ** r.quoteDecimals);
  let wins = 0;
  let losses = 0;
  let realized = 0;
  for (const v of latest.values()) {
    realized += v;
    if (v > 0) wins += 1;
    else if (v < 0) losses += 1;
  }
  return { wins, losses, realized };
}

function fillCount(db: Database.Database, kind: AgentKind): number {
  const row = db
    .prepare(`select count(*) as n from fills where agentKind = ?`)
    .get(kind) as { n: number };
  return row.n;
}

function rescued(db: Database.Database, kind: AgentKind): number {
  const rows = db
    .prepare(
      `select s.rescued, m.quoteDecimals from sweeper_results s
       join markets m on m.marketId = s.marketId where s.agentKind = ?`,
    )
    .all(kind) as { rescued: string; quoteDecimals: number }[];
  let total = 0;
  for (const r of rows) total += Number(r.rescued) / 10 ** r.quoteDecimals;
  return total;
}

function agentState(
  db: Database.Database,
  kind: AgentKind,
): { address: string | null; paused: boolean; lastError: string | null } {
  const row = db
    .prepare(`select address, paused, lastError from agent_state where agentKind = ?`)
    .get(kind) as { address: string; paused: number; lastError: string | null } | undefined;
  if (!row) return { address: null, paused: false, lastError: null };
  return { address: row.address, paused: row.paused === 1, lastError: row.lastError };
}

export function getAgentCard(db: Database.Database, kind: AgentKind): AgentCard {
  const def = AGENTS.find((a) => a.kind === kind);
  const state = agentState(db, kind);
  const equity = latestWalletCollateral(db, kind);
  const last = equity.series.length > 0 ? equity.series[equity.series.length - 1] : undefined;
  const stats = winStats(db, kind);
  const decided = stats.wins + stats.losses;
  return {
    kind,
    name: def?.name ?? kind,
    glyph: def?.glyph ?? "?",
    description: def?.description ?? "",
    address: state.address,
    paused: state.paused,
    lastError: state.lastError,
    equity: last ? last.collateral : null,
    equityCurve: equity.series,
    openPosition: openPosition(db, kind),
    trades: fillCount(db, kind),
    wins: stats.wins,
    losses: stats.losses,
    winRate: decided > 0 ? stats.wins / decided : null,
    winningsRescued: rescued(db, kind),
    realizedPnl: stats.realized,
  };
}

export function getArena(): AgentCard[] {
  const db = getDbSafe();
  if (!db) return AGENTS.map((a) => emptyCard(a.kind));
  return AGENTS.map((a) => getAgentCard(db, a.kind));
}

export function getAgentDetail(kind: AgentKind): AgentDetail | null {
  const db = getDbSafe();
  if (!db) return null;
  const card = getAgentCard(db, kind);

  const fills = db
    .prepare(
      `select f.id, f.marketId, f.agentKind, f.txHash, f.symbol, f.side, f.price, f.quantity, f.quoteQuantity, f.filledAt, m.quoteDecimals as decimals
       from fills f join markets m on m.marketId = f.marketId
       where f.agentKind = ? order by f.filledAt desc limit 50`,
    )
    .all(kind) as (FillRow & { decimals: number })[];

  const balanceRows = db
    .prepare(
      `select b.marketId, b.capturedAt, b.yesBalance, b.noBalance
       from balance_snapshots b join markets m on m.marketId = b.marketId
       where b.agentKind = ? and b.marketId != ''
       order by b.capturedAt asc limit 2000`,
    )
    .all(kind) as { marketId: string; capturedAt: number; yesBalance: string; noBalance: string }[];
  const latest = new Map<string, { capturedAt: number; yes: string; no: string }>();
  for (const r of balanceRows) {
    latest.set(r.marketId, { capturedAt: r.capturedAt, yes: r.yesBalance, no: r.noBalance });
  }
  const balances = [...latest.entries()]
    .map(([marketId, b]) => {
      const market = db
        .prepare(
          `select asset, intervalSec, status, oracleQuestionId, quoteDecimals from markets where marketId = ?`,
        )
        .get(marketId) as
        | {
            asset: string;
            intervalSec: number | null;
            status: string;
            oracleQuestionId: string | null;
            quoteDecimals: number;
          }
          | undefined;
      const scale = 10 ** (market?.quoteDecimals ?? FALLBACK_COLLATERAL_DECIMALS);
      return {
        marketId,
        asset: market?.asset ?? "?",
        intervalSec: market?.intervalSec ?? null,
        status: market?.status ?? "?",
        yesBalance: Number(b.yes) / scale,
        noBalance: Number(b.no) / scale,
        oracleQuestionId: market?.oracleQuestionId ?? null,
      };
    })
    .sort((a, b) => (a.marketId < b.marketId ? 1 : -1));

  const reasoning = db
    .prepare(
      `select agentKind, marketId, observation, thought, action, confidence, source, createdAt
       from reasoning where agentKind = ? order by id desc limit 30`,
    )
    .all(kind) as ReasoningRow[];

  return { card, fills, balances, reasoning };
}

export function getLeaderboard(asset: "all" | "BTC" | "ETH"): LeaderboardRow[] {
  const db = getDbSafe();
  if (!db) return AGENTS.map((a, i) => ({ ...emptyCard(a.kind), rank: i + 1 }));
  const cards = AGENTS.map((a) => {
    if (asset === "all") return getAgentCard(db, a.kind);
    const scoped = scopedCard(db, a.kind, asset);
    return scoped;
  });
  const ranked = [...cards].sort((a, b) => {
    const av = a.realizedPnl + a.winningsRescued;
    const bv = b.realizedPnl + b.winningsRescued;
    return bv - av;
  });
  return ranked.map((c, i) => ({ ...c, rank: i + 1 }));
}

function scopedCard(db: Database.Database, kind: AgentKind, asset: string): AgentCard {
  const base = getAgentCard(db, kind);
  const rows = db
    .prepare(
      `select p.marketId, p.capturedAt, p.realized, m.quoteDecimals from pnl_snapshots p
       join markets m on m.marketId = p.marketId
       where p.agentKind = ? and m.status = 'Finalized' and m.asset = ? and p.realized is not null
       order by p.capturedAt asc`,
    )
    .all(kind, asset) as { marketId: string; capturedAt: number; realized: string; quoteDecimals: number }[];
  const latest = new Map<string, number>();
  for (const r of rows) latest.set(r.marketId, Number(r.realized) / 10 ** r.quoteDecimals);
  let wins = 0;
  let losses = 0;
  let realized = 0;
  for (const v of latest.values()) {
    realized += v;
    if (v > 0) wins += 1;
    else if (v < 0) losses += 1;
  }
  const decided = wins + losses;
  const fills = (
    db
      .prepare(
        `select count(*) as n from fills f join markets m on m.marketId = f.marketId
         where f.agentKind = ? and m.asset = ?`,
      )
      .get(kind, asset) as { n: number }
  ).n;
  const rescuedRows = db
    .prepare(
      `select s.rescued, m.quoteDecimals from sweeper_results s
       join markets m on m.marketId = s.marketId
       where s.agentKind = ? and m.asset = ?`,
    )
    .all(kind, asset) as { rescued: string; quoteDecimals: number }[];
  let rescuedScoped = 0;
  for (const r of rescuedRows) rescuedScoped += Number(r.rescued) / 10 ** r.quoteDecimals;
  return {
    ...base,
    trades: fills,
    wins,
    losses,
    winRate: decided > 0 ? wins / decided : null,
    realizedPnl: realized,
    winningsRescued: rescuedScoped,
  };
}

function emptyCard(kind: AgentKind): AgentCard {
  const def = AGENTS.find((a) => a.kind === kind);
  return {
    kind,
    name: def?.name ?? kind,
    glyph: def?.glyph ?? "?",
    description: def?.description ?? "",
    address: null,
    paused: false,
    lastError: null,
    equity: null,
    equityCurve: [],
    openPosition: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    winningsRescued: 0,
    realizedPnl: 0,
  };
}

function getDbSafe(): Database.Database | null {
  return getDb();
}
