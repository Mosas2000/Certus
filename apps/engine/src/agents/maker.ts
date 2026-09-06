import type { AgentStrategy } from "./types.js";
import type { Decision, Harness } from "../harness.js";
import { AGENT_TICK_MS, type TradingConfig } from "../config.js";

const REQUOTE_MS = 30_000;
const MIN_PROB = 0.02;
const MAX_PROB = 0.98;

export class MarketMakerStrategy implements AgentStrategy {
  readonly tickIntervalMs = AGENT_TICK_MS;
  private readonly config: TradingConfig;
  private marketId: string | null = null;
  private quoteYesOrderId: bigint | null = null;
  private quoteNoOrderId: bigint | null = null;
  private lastQuoteAt = 0;

  constructor(config: TradingConfig) {
    this.config = config;
  }

  private clearQuotes(): void {
    this.quoteYesOrderId = null;
    this.quoteNoOrderId = null;
  }

  async shutdown(harness: Harness): Promise<void> {
    await this.cancelWorkingQuotes(harness);
  }

  private async cancelWorkingQuotes(harness: Harness): Promise<void> {
    if (this.marketId === null) return;
    const onchain = await harness.onchain(this.marketId as `0x${string}`);
    if (this.quoteYesOrderId !== null) {
      await harness.desk.cancel(onchain.pool, this.quoteYesOrderId);
    }
    if (this.quoteNoOrderId !== null) {
      await harness.desk.cancel(onchain.pool, this.quoteNoOrderId);
    }
    this.clearQuotes();
  }

  async tick(harness: Harness): Promise<void> {
    const sel = harness.selectMarket("BTC", 3600);
    if (!sel) return;
    const onchain = await harness.onchain(sel.marketId);
    if (onchain.status !== 1 || onchain.finalized) return;
    const book = await harness.book(onchain);
    if (book.midProb === null) return;

    if (this.marketId !== sel.marketId) {
      this.clearQuotes();
      this.marketId = sel.marketId;
      this.lastQuoteAt = 0;
    }

    const stale = Date.now() - this.lastQuoteAt >= REQUOTE_MS;
    if (!stale) return;

    if (this.quoteYesOrderId !== null || this.quoteNoOrderId !== null) {
      await this.cancelWorkingQuotes(harness);
    }

    const positions = await harness.positions(onchain);
    const grid = await harness.desk.grid(onchain.pool, onchain.decimals);
    const cap = BigInt(this.config.positionCapContracts) * grid.one;
    const quoteYes = positions.net < cap;
    const quoteNo = positions.net > -cap;

    this.lastQuoteAt = Date.now();

    if (quoteYes) {
      const decision: Decision = {
        kind: "quote",
        marketId: sel.marketId,
        side: "BUY_YES",
        prob: Math.max(book.midProb - this.config.mmSpread, MIN_PROB),
        contracts: this.config.mmQuoteSize,
        reason: `two-sided quote, mid ${book.midProb.toFixed(3)} - spread`,
      };
      const outcome = await harness.execute(decision, onchain);
      if (outcome.status === "rested" && outcome.orderId !== undefined) {
        this.quoteYesOrderId = outcome.orderId;
      }
    }

    if (quoteNo) {
      const decision: Decision = {
        kind: "quote",
        marketId: sel.marketId,
        side: "BUY_NO",
        prob: Math.min(book.midProb + this.config.mmSpread, MAX_PROB),
        contracts: this.config.mmQuoteSize,
        reason: `two-sided quote, mid ${book.midProb.toFixed(3)} + spread`,
      };
      const outcome = await harness.execute(decision, onchain);
      if (outcome.status === "rested" && outcome.orderId !== undefined) {
        this.quoteNoOrderId = outcome.orderId;
      }
    }
  }
}
