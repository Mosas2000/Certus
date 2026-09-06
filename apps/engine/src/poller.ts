import type {
  BinaryMarket,
  FillRow as SdkFillRow,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk";
import { erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  SOMNIA_TESTNET_ADDRESSES,
} from "@somnia-chain/markets-sdk";
import {
  WALLET_SNAPSHOT_MARKET_ID,
  errText,
  withRetry,
  type AgentDefinition,
  type CertusEnv,
  type MarketRow,
} from "@certus/shared";
import {
  getMarketStatus,
  insertBalanceSnapshot,
  insertFill,
  insertPnlSnapshot,
  markResolutionFetched,
  recentlyExpiredNonFinalized,
  setAgentError,
  upsertAgentState,
  upsertMarket,
  type Db,
} from "./db.js";

const RETRY_DELAYS_MS: readonly number[] = [3_000];
const RECHECK_LIMIT = 10;
const AGENT_FILL_LIMIT = 200;
const BALANCE_MARKET_MAX_AGE_SEC = 86_400;

export interface CycleResult {
  liveMarkets: number;
  finalizedUpdated: number;
  rechecked: number;
  agents: number;
  newFills: number;
  balanceSnapshots: number;
  pnlSnapshots: number;
  errors: string[];
}

function toMarketRow(m: BinaryMarket, venueId: string): MarketRow {
  const quoteDecimals = m.quoteDecimals;
  return {
    marketId: m.marketId,
    venueId: m.venueId ?? venueId,
    asset: m.asset,
    intervalSec: m.intervalSec !== null && m.intervalSec !== undefined ? Number(m.intervalSec) : null,
    tradingStart: Number(m.tradingStart),
    expiry: Number(m.expiry),
    status: m.status,
    pool: m.poolAddress,
    lastPrice: m.lastPrice,
    lastPriceDecimals: quoteDecimals,
    quoteDecimals,
    oracleQuestionId: m.oracleQuestionId ?? null,
    strike: m.strike,
    winningOutcome: m.winningOutcome,
    voided: m.voided,
    openingPrice: null,
    closingPrice: null,
  };
}

async function fetchResolution(
  exchange: SomniaMarkets,
  db: Db,
  marketId: string,
  errors: string[],
): Promise<void> {
  try {
    const resolution = await withRetry(
      `getMarketResolution(${marketId})`,
      RETRY_DELAYS_MS,
      () => exchange.client.getMarketResolution(marketId),
    );
    markResolutionFetched(
      db,
      marketId,
      resolution.openingAnswer?.numericValue ?? null,
      resolution.closingAnswer?.numericValue ?? null,
    );
  } catch (err) {
    errors.push(`resolution ${marketId}: ${errText(err).split("\n")[0]}`);
  }
}

async function ingestLive(
  exchange: SomniaMarkets,
  db: Db,
  env: CertusEnv,
): Promise<number> {
  const rows = await withRetry("listLiveBinaryMarkets", RETRY_DELAYS_MS, () =>
    exchange.client.listLiveBinaryMarkets({ venueId: env.venueId, limit: 50 }),
  );
  for (const m of rows) {
    upsertMarket(db, toMarketRow(m, env.venueId));
  }
  return rows.length;
}

async function ingestFinalized(
  exchange: SomniaMarkets,
  db: Db,
  env: CertusEnv,
  errors: string[],
): Promise<number> {
  const rows = await withRetry("listBinaryMarkets(Finalized)", RETRY_DELAYS_MS, () =>
    exchange.client.listBinaryMarkets({
      venueId: env.venueId,
      status: "Finalized",
      limit: env.claimScan * 3,
    }),
  );
  const newest = rows
    .sort((a, b) => Number(b.expiry) - Number(a.expiry))
    .slice(0, env.claimScan);
  let updated = 0;
  for (const m of newest) {
    const existing = getMarketStatus(db, m.marketId);
    const needsResolution = existing === undefined || existing.resolutionFetched === 0;
    upsertMarket(db, toMarketRow(m, env.venueId));
    if (needsResolution) {
      await fetchResolution(exchange, db, m.marketId, errors);
    }
    updated += 1;
  }
  return updated;
}

async function recheckExpired(
  exchange: SomniaMarkets,
  db: Db,
  env: CertusEnv,
  errors: string[],
): Promise<number> {  const now = Math.floor(Date.now() / 1000);
  const ids = recentlyExpiredNonFinalized(db, now, RECHECK_LIMIT);
  let rechecked = 0;
  for (const marketId of ids) {
    try {
      const m = await withRetry(`getBinaryMarket(${marketId})`, RETRY_DELAYS_MS, () =>
        exchange.client.getBinaryMarket(marketId),
      );
      if (!m) continue;
      const needsResolution = m.status === "Finalized";
      upsertMarket(db, toMarketRow(m, env.venueId));
      if (needsResolution) {
        await fetchResolution(exchange, db, marketId, errors);
      }
      rechecked += 1;
    } catch (err) {
      errors.push(`recheck ${marketId}: ${errText(err).split("\n")[0]}`);
    }
  }
  return rechecked;
}

function agentSide(row: SdkFillRow, address: string): string {
  const me = address.toLowerCase();
  if (row.takerOrder && row.takerOrder.owner.toLowerCase() === me) {
    return row.takerOrder.side ?? row.takerSide ?? "?";
  }
  if (row.maker && row.maker.toLowerCase() === me) {
    return row.makerSide ?? "?";
  }
  if (row.taker && row.taker.toLowerCase() === me) {
    return row.takerSide ?? "?";
  }
  return "?";
}

function resolveSymbol(exchange: SomniaMarkets, marketId: string): string {
  try {
    return exchange.market(marketId).symbol;
  } catch {
    return "";
  }
}

interface AgentAccount {
  def: AgentDefinition;
  address: `0x${string}`;
}

async function pollAgent(
  exchange: SomniaMarkets,
  db: Db,
  env: CertusEnv,
  account: AgentAccount,
  knownMarkets: Set<string>,
  errors: string[],
  result: { newFills: number; balanceSnapshots: number; pnlSnapshots: number },
): Promise<void> {
  const { def, address } = account;
  const capturedAt = Math.floor(Date.now() / 1000);

  let fills: SdkFillRow[] = [];
  try {
    fills = await withRetry(`getUserFills(${def.kind})`, RETRY_DELAYS_MS, () =>
      exchange.client.getUserFills(address, { limit: AGENT_FILL_LIMIT }),
    );
  } catch (err) {
    errors.push(`fills ${def.kind}: ${errText(err).split("\n")[0]}`);
    setAgentError(db, def.kind, errText(err).split("\n")[0] ?? "fill poll failed");
    return;
  }

  let outOfVenue = 0;
  for (const f of fills) {
    if (!knownMarkets.has(f.market.toLowerCase())) {
      outOfVenue += 1;
      continue;
    }
    const inserted = insertFill(db, {
      id: f.id,
      marketId: f.market,
      agentKind: def.kind,
      txHash: f.txHash,
      symbol: resolveSymbol(exchange, f.market),
      side: agentSide(f, address),
      price: f.fillPrice,
      quantity: f.quantity,
      quoteQuantity: f.quoteQuantity,
      filledAt: Number(f.timestamp),
    });
    if (inserted) result.newFills += 1;
  }
  if (outOfVenue > 0) {
    errors.push(`fills ${def.kind}: ${outOfVenue} fill(s) outside configured venue ignored`);
  }

  const viem = exchange.client.getViemClient();
  const collateral = SOMNIA_TESTNET_ADDRESSES.collateral ?? SOMNIA_TESTNET_ADDRESSES.testUsdc;
  if (!collateral) throw new Error("no collateral address configured for this deployment");

  try {
    const balance = await viem.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    insertBalanceSnapshot(db, {
      marketId: WALLET_SNAPSHOT_MARKET_ID,
      agentKind: def.kind,
      capturedAt,
      collateralBalance: balance.toString(),
      yesBalance: "0",
      noBalance: "0",
    });
    result.balanceSnapshots += 1;
  } catch (err) {
    errors.push(`collateral ${def.kind}: ${errText(err).split("\n")[0]}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const marketIds = [...new Set(fills.filter((f) => knownMarkets.has(f.market.toLowerCase())).map((f) => f.market))];
  const recent = marketIds.filter((id) => {
    const row = db
      .prepare(`select expiry from markets where marketId = ?`)
      .get(id) as { expiry: number } | undefined;
    return row !== undefined && row.expiry > now - BALANCE_MARKET_MAX_AGE_SEC;
  });
  for (const marketId of recent) {
    try {
      const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
      const [yesBalance, noBalance] = await Promise.all([
        exchange.client.getOutcomeBalance({
          outcomeToken: onchain.outcomeToken,
          account: address,
          id: onchain.yesId,
        }),
        exchange.client.getOutcomeBalance({
          outcomeToken: onchain.outcomeToken,
          account: address,
          id: onchain.noId,
        }),
      ]);
      insertBalanceSnapshot(db, {
        marketId,
        agentKind: def.kind,
        capturedAt,
        collateralBalance: "0",
        yesBalance: yesBalance.toString(),
        noBalance: noBalance.toString(),
      });
      result.balanceSnapshots += 1;

      const pnl = await exchange.client.getBinaryPositionPnL(address, marketId);
      insertPnlSnapshot(db, {
        marketId,
        agentKind: def.kind,
        capturedAt,
        realized: pnl.realizedPnl?.toString() ?? null,
        unrealized: pnl.unrealizedPnl?.toString() ?? null,
      });
      result.pnlSnapshots += 1;
    } catch (err) {
      errors.push(`position ${def.kind} ${marketId}: ${errText(err).split("\n")[0]}`);
    }
  }
}

export async function runCycle(
  exchange: SomniaMarkets,
  db: Db,
  env: CertusEnv,
  agents: readonly AgentDefinition[],
): Promise<CycleResult> {
  const errors: string[] = [];
  const result: CycleResult = {
    liveMarkets: 0,
    finalizedUpdated: 0,
    rechecked: 0,
    agents: 0,
    newFills: 0,
    balanceSnapshots: 0,
    pnlSnapshots: 0,
    errors,
  };

  try {
    result.liveMarkets = await ingestLive(exchange, db, env);
  } catch (err) {
    errors.push(`live ingest: ${errText(err).split("\n")[0]}`);
  }

  try {
    result.finalizedUpdated = await ingestFinalized(exchange, db, env, errors);
  } catch (err) {
    errors.push(`finalized ingest: ${errText(err).split("\n")[0]}`);
  }

  try {
    result.rechecked = await recheckExpired(exchange, db, env, errors);
  } catch (err) {
    errors.push(`expired recheck: ${errText(err).split("\n")[0]}`);
  }

  const knownMarkets = new Set(
    (
      db.prepare(`select marketId from markets`).all() as { marketId: string }[]
    ).map((r) => r.marketId.toLowerCase()),
  );

  for (const def of agents) {
    const key = env.agentKeys[def.kind];
    if (!key) continue;
    const address = privateKeyToAccount(key).address;
    upsertAgentState(db, {
      agentKind: def.kind,
      address,
      paused: false,
      lastErrorAt: null,
      lastError: null,
    });
    result.agents += 1;
    try {
      await pollAgent(
        exchange,
        db,
        env,
        { def, address },
        knownMarkets,
        errors,
        result,
      );
    } catch (err) {
      errors.push(`agent ${def.kind}: ${errText(err).split("\n")[0]}`);
      setAgentError(db, def.kind, errText(err).split("\n")[0] ?? "poll failed");
    }
  }

  return result;
}
