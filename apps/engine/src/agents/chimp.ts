import type { AgentStrategy } from "./types.js";
import type { Decision, Harness } from "../harness.js";
import { AGENT_TICK_MS, type TradingConfig } from "../config.js";

const PRICE_PREMIUM = 0.05;

export class ChimpStrategy implements AgentStrategy {
  readonly tickIntervalMs = AGENT_TICK_MS;
  private readonly config: TradingConfig;

  constructor(config: TradingConfig) {
    this.config = config;
  }

  async tick(harness: Harness): Promise<void> {
    if (Math.random() >= this.config.chimpProb) return;
    const sel = harness.selectAnyMarket();
    if (!sel) return;
    const onchain = await harness.onchain(sel.marketId);
    if (onchain.status !== 1 || onchain.finalized) return;
    const book = await harness.book(onchain);
    if (book.midProb === null) return;

    const contracts = 1 + Math.floor(Math.random() * this.config.chimpMaxSize);
    const jitter = Math.random() * PRICE_PREMIUM;
    const buyYes = Math.random() < 0.5;

    let side: Decision["side"];
    let prob: number;
    if (buyYes) {
      side = "BUY_YES";
      prob = Math.min((book.bestAskProb ?? book.midProb) + jitter, 0.99);
    } else {
      side = "BUY_NO";
      prob = Math.max((book.bestBidProb ?? book.midProb) - jitter, 0.01);
    }

    const decision: Decision = {
      kind: "take",
      marketId: sel.marketId,
      side,
      prob,
      contracts,
      reason: `random ${sel.asset} ${sel.intervalSec / 60}m window, coin flip side`,
    };
    await harness.execute(decision, onchain);
  }
}
