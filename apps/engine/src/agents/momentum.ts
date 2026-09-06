import type { AgentStrategy } from "./types.js";
import type { Harness } from "../harness.js";
import type { Decision } from "../harness.js";
import { AGENT_TICK_MS, type TradingConfig } from "../config.js";

const LOOKBACK = 8;
const MAX_SAMPLES = 24;
const COOLDOWN_MS = 45_000;
const PRICE_PREMIUM = 0.02;

export class MomentumStrategy implements AgentStrategy {
  readonly tickIntervalMs = AGENT_TICK_MS;
  private readonly config: TradingConfig;
  private marketId: string | null = null;
  private mids: { t: number; p: number }[] = [];
  private lastTakeAt = 0;

  constructor(config: TradingConfig) {
    this.config = config;
  }

  async tick(harness: Harness): Promise<void> {
    const sel = harness.selectMarket("BTC", 3600);
    if (!sel) return;
    const onchain = await harness.onchain(sel.marketId);
    if (onchain.status !== 1 || onchain.finalized) return;
    const book = await harness.book(onchain);
    if (book.midProb === null) return;

    if (this.marketId !== sel.marketId) {
      this.marketId = sel.marketId;
      this.mids = [];
    }
    this.mids.push({ t: Date.now(), p: book.midProb });
    if (this.mids.length > MAX_SAMPLES) this.mids.shift();
    if (this.mids.length < LOOKBACK) return;

    const oldest = this.mids[this.mids.length - LOOKBACK];
    if (!oldest) return;
    const drift = book.midProb - oldest.p;
    if (Math.abs(drift) < this.config.momentumDrift) return;
    if (Date.now() - this.lastTakeAt < COOLDOWN_MS) return;

    let side: Decision["side"];
    let prob: number;
    if (drift > 0) {
      side = "BUY_YES";
      prob = Math.min((book.bestAskProb ?? book.midProb) + PRICE_PREMIUM, 0.99);
    } else {
      side = "BUY_NO";
      prob = Math.max((book.bestBidProb ?? book.midProb) - PRICE_PREMIUM, 0.01);
    }

    const decision: Decision = {
      kind: "take",
      marketId: sel.marketId,
      side,
      prob,
      contracts: this.config.takeSizeContracts,
      reason: `mid drift ${drift >= 0 ? "+" : ""}${drift.toFixed(3)} over ${LOOKBACK} ticks`,
    };
    const outcome = await harness.execute(decision, onchain);
    if (outcome.status === "sent") {
      this.lastTakeAt = Date.now();
      this.mids = [];
    }
  }
}
