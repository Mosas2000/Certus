import type { AgentStrategy } from "./types.js";
import type { Decision, Harness } from "../harness.js";
import { AGENT_TICK_MS, type TradingConfig } from "../config.js";

const PRICE_PREMIUM = 0.02;

export class MeanReversionStrategy implements AgentStrategy {
  readonly tickIntervalMs = AGENT_TICK_MS;
  private readonly config: TradingConfig;
  private marketId: string | null = null;
  private referenceMid: number | null = null;

  constructor(config: TradingConfig) {
    this.config = config;
  }

  async tick(harness: Harness): Promise<void> {
    const sel = harness.selectMarket("ETH", 3600);
    if (!sel) return;
    const onchain = await harness.onchain(sel.marketId);
    if (onchain.status !== 1 || onchain.finalized) return;
    const book = await harness.book(onchain);
    if (book.midProb === null) return;

    if (this.marketId !== sel.marketId) {
      this.marketId = sel.marketId;
      this.referenceMid = null;
    }
    if (this.referenceMid === null) {
      this.referenceMid = book.midProb;
      return;
    }

    const deviation = book.midProb - this.referenceMid;
    const positions = await harness.positions(onchain);
    const grid = await harness.desk.grid(onchain.pool, onchain.decimals);
    const halfContract = grid.one / 2n;
    const holding = positions.net > halfContract || positions.net < -halfContract;

    if (holding && Math.abs(deviation) <= this.config.meanrevExitBand) {
      const contracts = Number(
        (positions.net > 0n ? positions.net : -positions.net) / grid.one,
      );
      if (contracts < 1) return;
      let side: Decision["side"];
      let prob: number;
      if (positions.net > 0n) {
        side = "SELL_YES";
        prob = Math.max((book.bestBidProb ?? book.midProb) - PRICE_PREMIUM, 0.01);
      } else {
        side = "SELL_NO";
        prob = Math.min((book.bestAskProb ?? book.midProb) + PRICE_PREMIUM, 0.99);
      }
      const decision: Decision = {
        kind: "flatten",
        marketId: sel.marketId,
        side,
        prob,
        contracts: Math.floor(contracts),
        reason: `deviation ${deviation >= 0 ? "+" : ""}${deviation.toFixed(3)} back inside exit band`,
      };
      await harness.execute(decision, onchain);
      return;
    }

    if (holding) return;
    if (Math.abs(deviation) < this.config.meanrevDeviation) return;

    let side: Decision["side"];
    let prob: number;
    if (deviation > 0) {
      side = "BUY_NO";
      prob = Math.max((book.bestBidProb ?? book.midProb) - PRICE_PREMIUM, 0.01);
    } else {
      side = "BUY_YES";
      prob = Math.min((book.bestAskProb ?? book.midProb) + PRICE_PREMIUM, 0.99);
    }
    const decision: Decision = {
      kind: "take",
      marketId: sel.marketId,
      side,
      prob,
      contracts: this.config.takeSizeContracts,
      reason: `deviation ${deviation >= 0 ? "+" : ""}${deviation.toFixed(3)} from opening mid ${this.referenceMid.toFixed(3)}`,
    };
    await harness.execute(decision, onchain);
  }
}
