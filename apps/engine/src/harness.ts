import type { MarketOnchain, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { ORDER_TYPE, type PlaceOrderResult } from "@somnia-chain/markets-sdk";
import { erc20Abi } from "viem";
import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import {
  errText,
  type AgentKind,
  type CertusEnv,
} from "@certus/shared";
import { setAgentError, setAgentPaused, type Db } from "./db.js";
import { OrderDesk, isPostOnlyCross, orderTypeLabel, type BinarySide } from "./orders.js";
import { GAS_RESERVE_STT, MIN_SECONDS_LEFT, type TradingConfig } from "./config.js";

export interface SelectedMarket {
  marketId: `0x${string}`;
  asset: string;
  intervalSec: number;
  secondsLeft: number;
}

export interface BookView {
  bestBidProb: number | null;
  bestAskProb: number | null;
  midProb: number | null;
}

export interface Positions {
  yes: bigint;
  no: bigint;
  net: bigint;
}

export type DecisionKind = "take" | "quote" | "cancel" | "flatten";

export interface Decision {
  kind: DecisionKind;
  marketId: `0x${string}`;
  side: BinarySide;
  prob: number;
  contracts: number;
  reason: string;
}

export type Outcome =
  | { status: "sent"; txHash: string; filledContracts: number; orderId?: bigint }
  | { status: "rested"; orderId: bigint }
  | { status: "crossed" }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string };

const PAUSE_LOG_INTERVAL_MS = 300_000;
const COLLATERAL = SOMNIA_TESTNET_ADDRESSES.collateral ?? SOMNIA_TESTNET_ADDRESSES.testUsdc;

export class Harness {
  readonly exchange: SomniaMarkets;
  readonly desk: OrderDesk;
  private readonly db: Db;
  private readonly env: CertusEnv;
  private readonly config: TradingConfig;
  readonly agentKind: AgentKind;
  readonly address: `0x${string}`;
  private lastPauseLog = 0;
  private lastOnchainCache = new Map<string, { at: number; onchain: MarketOnchain }>();

  constructor(
    exchange: SomniaMarkets,
    db: Db,
    env: CertusEnv,
    config: TradingConfig,
    agentKind: AgentKind,
    address: `0x${string}`,
  ) {
    this.exchange = exchange;
    this.db = db;
    this.env = env;
    this.config = config;
    this.agentKind = agentKind;
    this.address = address;
    this.desk = new OrderDesk(exchange);
  }

  log(message: string): void {
    console.log(`[agent ${this.agentKind}] ${message}`);
  }

  selectMarket(asset: string | null, intervalSec: number | null): SelectedMarket | null {
    const now = Math.floor(Date.now() / 1000);
    let sql = `select marketId, asset, intervalSec, expiry from markets where status = 'Trading' and venueId = ? and expiry > ?`;
    const args: unknown[] = [this.env.venueId, now + MIN_SECONDS_LEFT];
    if (asset !== null) {
      sql += ` and asset = ?`;
      args.push(asset);
    }
    if (intervalSec !== null) {
      sql += ` and intervalSec = ?`;
      args.push(intervalSec);
    }
    sql += ` order by expiry desc limit 1`;
    const row = this.db.prepare(sql).get(...args) as
      | { marketId: string; asset: string; intervalSec: number | null; expiry: number }
      | undefined;
    if (!row || row.intervalSec === null) return null;
    return {
      marketId: row.marketId as `0x${string}`,
      asset: row.asset,
      intervalSec: row.intervalSec,
      secondsLeft: row.expiry - now,
    };
  }

  selectAnyMarket(): SelectedMarket | null {
    const now = Math.floor(Date.now() / 1000);
    const rows = this.db
      .prepare(
        `select marketId, asset, intervalSec, expiry from markets
         where status = 'Trading' and venueId = ? and expiry > ? and intervalSec is not null
         order by expiry desc`,
      )
      .all(this.env.venueId, now + MIN_SECONDS_LEFT) as {
      marketId: string;
      asset: string;
      intervalSec: number;
      expiry: number;
    }[];
    if (rows.length === 0) return null;
    const pick = rows[Math.floor(Math.random() * rows.length)];
    if (!pick) return null;
    return {
      marketId: pick.marketId as `0x${string}`,
      asset: pick.asset,
      intervalSec: pick.intervalSec,
      secondsLeft: pick.expiry - now,
    };
  }

  async onchain(marketId: `0x${string}`): Promise<MarketOnchain> {
    const cached = this.lastOnchainCache.get(marketId.toLowerCase());
    if (cached && Date.now() - cached.at < 3_000) return cached.onchain;
    const onchain = await this.exchange.client.getMarketOnchain(marketId);
    this.lastOnchainCache.set(marketId.toLowerCase(), { at: Date.now(), onchain });
    return onchain;
  }

  async book(onchain: MarketOnchain): Promise<BookView> {
    const raw = await this.exchange.client.getBinaryOrderBook(onchain.pool, { depth: 5 });
    const one = 10n ** BigInt(onchain.decimals);
    const bid = raw.yesBids[0]?.price ?? null;
    const ask = raw.yesAsks[0]?.price ?? null;
    const bidProb = bid !== null ? Number(bid) / Number(one) : null;
    const askProb = ask !== null ? Number(ask) / Number(one) : null;
    let midProb: number | null = null;
    if (bidProb !== null && askProb !== null) midProb = (bidProb + askProb) / 2;
    else if (bidProb !== null) midProb = bidProb;
    else if (askProb !== null) midProb = askProb;
    return { bestBidProb: bidProb, bestAskProb: askProb, midProb };
  }

  async positions(onchain: MarketOnchain): Promise<Positions> {
    const [yes, no] = await Promise.all([
      this.exchange.client.getOutcomeBalance({
        outcomeToken: onchain.outcomeToken,
        account: this.address,
        id: onchain.yesId,
      }),
      this.exchange.client.getOutcomeBalance({
        outcomeToken: onchain.outcomeToken,
        account: this.address,
        id: onchain.noId,
      }),
    ]);
    return { yes, no, net: yes - no };
  }

  async collateralBalance(): Promise<bigint> {
    if (!COLLATERAL) throw new Error("no collateral address configured");
    const viem = this.exchange.client.getViemClient();
    return viem.readContract({
      address: COLLATERAL,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.address],
    });
  }

  async nativeBalance(): Promise<bigint> {
    const viem = this.exchange.client.getViemClient();
    return viem.getBalance({ address: this.address });
  }

  orderExpiryNs(onchain: MarketOnchain): bigint {
    const nowSec = Math.floor(Date.now() / 1000);
    const deadMan = BigInt(nowSec + 300) * 1_000_000_000n;
    const marketExpiryNs = onchain.expiry * 1_000_000_000n;
    return deadMan > marketExpiryNs ? marketExpiryNs : deadMan;
  }

  netDelta(side: BinarySide, quantity: bigint): bigint {
    switch (side) {
      case "BUY_YES":
        return quantity;
      case "SELL_YES":
        return -quantity;
      case "BUY_NO":
        return -quantity;
      case "SELL_NO":
        return quantity;
    }
  }

  private pauseThrottled(reason: string): void {
    setAgentPaused(this.db, this.agentKind, true);
    setAgentError(this.db, this.agentKind, reason);
    if (Date.now() - this.lastPauseLog > PAUSE_LOG_INTERVAL_MS) {
      this.lastPauseLog = Date.now();
      this.log(`PAUSE: ${reason}`);
    }
  }

  private unpauseIfHealthy(): void {
    setAgentPaused(this.db, this.agentKind, false);
  }

  async execute(decision: Decision, onchain: MarketOnchain): Promise<Outcome> {
    const label = `${decision.kind} ${decision.side} ${decision.contracts} @ ${decision.prob.toFixed(3)} (${decision.reason})`;

    if (onchain.status !== 1 || onchain.finalized) {
      return { status: "skipped", reason: "market not Trading on-chain" };
    }
    const secondsLeft = Number(onchain.expiry) - Math.floor(Date.now() / 1000);
    if (secondsLeft < 300) {
      return { status: "skipped", reason: `<300s to expiry (${secondsLeft}s)` };
    }

    const grid = await this.desk.grid(onchain.pool, onchain.decimals);
    const price = this.desk.yesPriceForSide(decision.side, decision.prob, grid);
    if (price === null) {
      return { status: "skipped", reason: `price ${decision.prob.toFixed(3)} off-grid or outside (0,1)` };
    }
    const quantity = this.desk.lots(decision.contracts, grid);
    if (quantity < grid.minQuantity || quantity === 0n) {
      return { status: "skipped", reason: `size ${decision.contracts} below venue minimum` };
    }

    const positions = await this.positions(onchain);
    const cap = BigInt(this.config.positionCapContracts) * grid.one;
    const projected = positions.net + this.netDelta(decision.side, quantity);
    if (projected > cap || projected < -cap) {
      return { status: "skipped", reason: `position cap ${this.config.positionCapContracts} would be exceeded` };
    }

    const escrow = this.desk.escrowCollateral(decision.side, price, quantity, grid);
    if (escrow > 0n) {
      const collateral = await this.collateralBalance();
      if (collateral < escrow) {
        const reason = `underfunded: need ${escrow} raw collateral, wallet has ${collateral}`;
        this.pauseThrottled(reason);
        if (this.config.dryRun) {
          this.log(`DECISION ${label} — SKIPPED: ${reason} (PAUSE)`);
        }
        return { status: "skipped", reason };
      }
    } else {
      const held = decision.side === "SELL_YES" ? positions.yes : positions.no;
      if (held < quantity) {
        const reason = `no inventory to sell: holds yes=${positions.yes} no=${positions.no}`;
        if (this.config.dryRun) {
          this.log(`DECISION ${label} — SKIPPED: ${reason}`);
        }
        return { status: "skipped", reason };
      }
    }

    const native = await this.nativeBalance();
    const gasReserve = BigInt(Math.floor(GAS_RESERVE_STT * 1e18));
    if (native < gasReserve) {
      const reason = `no gas: STT balance ${native} below reserve ${gasReserve}`;
      this.pauseThrottled(reason);
      if (this.config.dryRun) {
        this.log(`DECISION ${label} — SKIPPED: ${reason} (PAUSE)`);
      }
      return { status: "skipped", reason };
    }
    this.unpauseIfHealthy();

    const orderType =
      decision.kind === "quote" ? ORDER_TYPE.POST_ONLY : ORDER_TYPE.MARKET;

    if (this.config.dryRun) {
      this.log(
        `DECISION ${label} — DRY_RUN would send ${orderTypeLabel(orderType)} on ${decision.marketId}`,
      );
      return { status: "skipped", reason: "dry run" };
    }

    try {
      const res: PlaceOrderResult = await this.desk.place(
        onchain.pool,
        decision.side,
        price,
        quantity,
        orderType,
        this.orderExpiryNs(onchain),
      );
      const filled = res.fills.reduce((sum, f) => sum + f.quantityFilled, 0n);
      if (res.orderId !== undefined && filled === 0n) {
        this.log(`RESTED ${label} order=${res.orderId} tx=${res.hash}`);
        return { status: "rested", orderId: res.orderId };
      }
      const filledContracts = Number(filled) / Number(grid.one);
      this.log(
        `SENT ${label} tx=${res.hash} filled=${filledContracts.toFixed(3)} contracts`,
      );
      const after = await this.positions(onchain);
      this.log(
        `RECONCILED yes=${Number(after.yes) / Number(grid.one)} no=${Number(after.no) / Number(grid.one)} net=${Number(after.net) / Number(grid.one)}`,
      );
      return { status: "sent", txHash: res.hash, filledContracts, orderId: res.orderId };
    } catch (err) {
      if (isPostOnlyCross(err)) {
        this.log(`REQUOTE ${label} — post-only would cross (book moved into us)`);
        return { status: "crossed" };
      }
      const message = errText(err).split("\n")[0] ?? "send failed";
      this.log(`SEND FAILED ${label}: ${message}`);
      setAgentError(this.db, this.agentKind, message);
      return { status: "error", message };
    }
  }
}
