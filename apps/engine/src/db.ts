import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentKind,
  AgentStateRow,
  BalanceSnapshotRow,
  FillRow,
  MarketRow,
  PnlSnapshotRow,
} from "@certus/shared";

const SCHEMA = `
create table if not exists markets (
  marketId text primary key,
  venueId text not null,
  asset text not null,
  intervalSec integer,
  tradingStart integer not null,
  expiry integer not null,
  status text not null,
  pool text not null,
  lastPrice text,
  lastPriceDecimals integer not null,
  quoteDecimals integer not null,
  oracleQuestionId text,
  strike text,
  winningOutcome integer,
  voided integer not null default 0,
  openingPrice text,
  closingPrice text,
  resolutionFetched integer not null default 0
);
create index if not exists idx_markets_expiry on markets (expiry);
create index if not exists idx_markets_status on markets (status);
create table if not exists fills (
  id text primary key,
  marketId text not null,
  agentKind text not null,
  txHash text not null,
  symbol text not null,
  side text not null,
  price text not null,
  quantity text not null,
  quoteQuantity text not null,
  filledAt integer not null
);
create index if not exists idx_fills_market on fills (marketId);
create index if not exists idx_fills_agent on fills (agentKind, filledAt);
create table if not exists balance_snapshots (
  id integer primary key autoincrement,
  marketId text not null,
  agentKind text not null,
  capturedAt integer not null,
  collateralBalance text not null,
  yesBalance text not null,
  noBalance text not null
);
create index if not exists idx_balance_snapshots on balance_snapshots (marketId, agentKind, capturedAt);
create table if not exists pnl_snapshots (
  id integer primary key autoincrement,
  marketId text not null,
  agentKind text not null,
  capturedAt integer not null,
  realized text,
  unrealized text
);
create index if not exists idx_pnl_snapshots on pnl_snapshots (marketId, agentKind, capturedAt);
create table if not exists agent_state (
  agentKind text primary key,
  address text not null,
  paused integer not null default 0,
  lastErrorAt integer,
  lastError text
);
`;

export type Db = Database.Database;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

const upsertMarketStmt = `
insert into markets (
  marketId, venueId, asset, intervalSec, tradingStart, expiry, status, pool,
  lastPrice, lastPriceDecimals, quoteDecimals, oracleQuestionId, strike,
  winningOutcome, voided, openingPrice, closingPrice, resolutionFetched
) values (
  @marketId, @venueId, @asset, @intervalSec, @tradingStart, @expiry, @status, @pool,
  @lastPrice, @lastPriceDecimals, @quoteDecimals, @oracleQuestionId, @strike,
  @winningOutcome, @voided, @openingPrice, @closingPrice, 0
)
on conflict (marketId) do update set
  venueId = excluded.venueId,
  asset = excluded.asset,
  intervalSec = excluded.intervalSec,
  tradingStart = excluded.tradingStart,
  expiry = excluded.expiry,
  status = excluded.status,
  pool = excluded.pool,
  lastPrice = excluded.lastPrice,
  lastPriceDecimals = excluded.lastPriceDecimals,
  quoteDecimals = excluded.quoteDecimals,
  oracleQuestionId = excluded.oracleQuestionId,
  strike = excluded.strike,
  winningOutcome = excluded.winningOutcome,
  voided = excluded.voided
`;

export function upsertMarket(db: Db, row: MarketRow): void {
  db.prepare(upsertMarketStmt).run({
    ...row,
    intervalSec: row.intervalSec,
    voided: row.voided ? 1 : 0,
  });
}

export function markResolutionFetched(
  db: Db,
  marketId: string,
  openingPrice: string | null,
  closingPrice: string | null,
): void {
  db.prepare(
    `update markets set openingPrice = ?, closingPrice = ?, resolutionFetched = 1 where marketId = ?`,
  ).run(openingPrice, closingPrice, marketId);
}

export function getMarketStatus(db: Db, marketId: string): { status: string; resolutionFetched: number } | undefined {
  return db
    .prepare(`select status, resolutionFetched from markets where marketId = ?`)
    .get(marketId) as { status: string; resolutionFetched: number } | undefined;
}

export function recentlyExpiredNonFinalized(db: Db, now: number, limit: number): string[] {
  return (
    db
      .prepare(
        `select marketId from markets where status != 'Finalized' and expiry < ? order by expiry desc limit ?`,
      )
      .all(now, limit) as { marketId: string }[]
  ).map((r) => r.marketId);
}

export function insertFill(db: Db, row: FillRow): boolean {
  const res = db
    .prepare(
      `insert or ignore into fills (
        id, marketId, agentKind, txHash, symbol, side, price, quantity, quoteQuantity, filledAt
      ) values (
        @id, @marketId, @agentKind, @txHash, @symbol, @side, @price, @quantity, @quoteQuantity, @filledAt
      )`,
    )
    .run(row);
  return res.changes > 0;
}

export function insertBalanceSnapshot(db: Db, row: BalanceSnapshotRow): void {
  db.prepare(
    `insert into balance_snapshots (marketId, agentKind, capturedAt, collateralBalance, yesBalance, noBalance)
     values (@marketId, @agentKind, @capturedAt, @collateralBalance, @yesBalance, @noBalance)`,
  ).run(row);
}

export function insertPnlSnapshot(db: Db, row: PnlSnapshotRow): void {
  db.prepare(
    `insert into pnl_snapshots (marketId, agentKind, capturedAt, realized, unrealized)
     values (@marketId, @agentKind, @capturedAt, @realized, @unrealized)`,
  ).run(row);
}

export function upsertAgentState(db: Db, row: AgentStateRow): void {
  db.prepare(
    `insert into agent_state (agentKind, address, paused, lastErrorAt, lastError)
     values (@agentKind, @address, @paused, @lastErrorAt, @lastError)
     on conflict (agentKind) do update set
       address = excluded.address,
       paused = excluded.paused,
       lastErrorAt = excluded.lastErrorAt,
       lastError = excluded.lastError`,
  ).run({ ...row, paused: row.paused ? 1 : 0 });
}

export function setAgentError(db: Db, agentKind: AgentKind, message: string): void {
  db.prepare(
    `update agent_state set lastErrorAt = ?, lastError = ? where agentKind = ?`,
  ).run(Math.floor(Date.now() / 1000), message, agentKind);
}

export function setAgentPaused(db: Db, agentKind: AgentKind, paused: boolean): void {
  db.prepare(`update agent_state set paused = ? where agentKind = ?`).run(
    paused ? 1 : 0,
    agentKind,
  );
}

export function getAgentPaused(db: Db, agentKind: AgentKind): boolean {
  const row = db
    .prepare(`select paused from agent_state where agentKind = ?`)
    .get(agentKind) as { paused: number } | undefined;
  return row?.paused === 1;
}

export function marketCount(db: Db): number {
  const row = db.prepare(`select count(*) as n from markets`).get() as { n: number };
  return row.n;
}

export function fillCount(db: Db): number {
  const row = db.prepare(`select count(*) as n from fills`).get() as { n: number };
  return row.n;
}
