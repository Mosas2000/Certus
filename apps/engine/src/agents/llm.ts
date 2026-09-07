import Anthropic from "@anthropic-ai/sdk";
import type { MarketOnchain } from "@somnia-chain/markets-sdk";
import { errText, type CertusEnv } from "@certus/shared";
import { insertReasoningRow, type Db } from "../db.js";
import type { Decision, Harness } from "../harness.js";
import type { TradingConfig } from "../config.js";
import type { AgentStrategy } from "./types.js";

export interface Observation {
  asset: string;
  intervalSec: number;
  timeToCloseSec: number;
  book: { bestBid: number | null; bestAsk: number | null; mid: number | null };
  recentFills: { price: number; quantity: number; agoSec: number }[];
  position: { up: number; down: number };
  collateral: number;
  lastPrice: number | null;
}

export interface Proposal {
  thought: string;
  side: "buy" | "sell" | "pass";
  outcome: "up" | "down";
  price: number;
  size: number;
  confidence: number;
}

const SYSTEM_PROMPT = [
  "You are a trading agent competing on DreamDEX binary Up/Down markets (Somnia chain).",
  "You receive a JSON observation of one market: order book as Up-probabilities, recent fills, time to close, your outcome position, and your collateral.",
  "Prices are probabilities in (0,1). One outcome token pays 1 if its side wins, 0 otherwise.",
  "Respond with ONLY a single JSON object, no markdown fences, exactly this shape:",
  '{"thought": string, "action": {"side": "buy"|"sell"|"pass", "outcome": "up"|"down", "price": number, "size": number}, "confidence": number}',
  "price is the probability of the outcome you are trading, clamped to 0.02-0.98.",
  "size is whole contracts, 1-5. confidence is 0-1.",
  "Prefer pass when the book is one-sided, near expiry, or you hold a large position already.",
].join(" ");

const FALLBACK_DEVIATION = 0.06;
const MIN_PROB = 0.02;
const MAX_PROB = 0.98;
const MAX_SIZE = 5;
const SENT_COOLDOWN_MS = 300_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseProposal(text: string): Proposal | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const action = (obj.action ?? {}) as Record<string, unknown>;
  const side = action.side;
  if (side !== "buy" && side !== "sell" && side !== "pass") return null;
  const outcome = action.outcome;
  if (outcome !== "up" && outcome !== "down") return null;
  const price = Number(action.price);
  const size = Number(action.size);
  const confidence = Number(obj.confidence);
  if (side !== "pass") {
    if (!Number.isFinite(price) || !Number.isFinite(size) || size < 1) return null;
  }
  const thought = typeof obj.thought === "string" ? obj.thought.slice(0, 500) : "";
  return {
    thought,
    side,
    outcome,
    price: Number.isFinite(price) ? clamp(price, MIN_PROB, MAX_PROB) : 0.5,
    size: Number.isFinite(size) ? clamp(Math.floor(size), 1, MAX_SIZE) : 1,
    confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 0.5,
  };
}

function proposalToDecision(p: Proposal, marketId: `0x${string}`): Decision {
  const isUp = p.outcome === "up";
  const upProb = isUp ? p.price : 1 - p.price;
  const side = p.side === "buy"
    ? isUp ? "BUY_YES" : "BUY_NO"
    : isUp ? "SELL_YES" : "SELL_NO";
  return {
    kind: "take",
    marketId,
    side,
    prob: clamp(upProb, MIN_PROB, MAX_PROB),
    contracts: clamp(Math.floor(p.size), 1, MAX_SIZE),
    reason: `llm proposal: ${p.thought.slice(0, 120)}`,
  };
}

export class LlmStrategy implements AgentStrategy {
  readonly tickIntervalMs = 60_000;
  private readonly config: TradingConfig;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly db: Db;
  private client: Anthropic | null = null;
  private openingMid: { marketId: string; mid: number } | null = null;
  private lastSentAt = 0;
  private parseErrors = 0;

  constructor(config: TradingConfig, env: CertusEnv, db: Db) {
    this.config = config;
    this.apiKey = env.anthropicApiKey;
    this.model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    this.db = db;
  }

  async decide(observation: Observation): Promise<{ proposal: Proposal; source: "anthropic" | "fallback" }> {
    if (this.apiKey) {
      try {
        const proposal = await this.callAnthropic(observation);
        if (proposal) return { proposal, source: "anthropic" };
      } catch (err) {
        console.error(
          `[agent llm] ANTHROPIC CALL FAILED, falling back this tick: ${errText(err).split("\n")[0]}`,
        );
      }
    }
    return { proposal: this.fallbackDecide(observation), source: "fallback" };
  }

  async callAnthropic(observation: Observation): Promise<Proposal | null> {
    if (!this.apiKey) return null;
    if (this.client === null) {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(observation) }],
    });
    const text = res.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    const proposal = parseProposal(text);
    if (!proposal) {
      this.parseErrors += 1;
      console.error(
        `[agent llm] MALFORMED MODEL RESPONSE (#${this.parseErrors}), counting as pass: ${text.slice(0, 200)}`,
      );
      return { thought: `malformed model response counted as pass`, side: "pass", outcome: "up", price: 0.5, size: 0, confidence: 0.3 };
    }
    return proposal;
  }

  fallbackDecide(observation: Observation): Proposal {
    const mid = observation.book.mid ?? observation.lastPrice ?? 0.5;
    if (this.openingMid === null || this.openingMid.marketId !== `${observation.asset}:${observation.intervalSec}`) {
      this.openingMid = { marketId: `${observation.asset}:${observation.intervalSec}`, mid };
      return { thought: `fallback: establishing opening reference mid ${mid.toFixed(3)}`, side: "pass", outcome: "up", price: 0.5, size: 0, confidence: 0.3 };
    }
    const deviation = mid - this.openingMid.mid;
    if (Math.abs(deviation) < FALLBACK_DEVIATION) {
      return { thought: `fallback: deviation ${deviation.toFixed(3)} below threshold, no edge`, side: "pass", outcome: "up", price: 0.5, size: 0, confidence: 0.3 };
    }
    const fadeDown = deviation > 0;
    return {
      thought: `fallback: mid moved ${deviation >= 0 ? "+" : ""}${deviation.toFixed(3)} from opening ${this.openingMid.mid.toFixed(3)}, fading the move`,
      side: "buy",
      outcome: fadeDown ? "down" : "up",
      price: clamp(fadeDown ? 1 - mid : mid, MIN_PROB, MAX_PROB),
      size: 2,
      confidence: clamp(0.3 + Math.abs(deviation) * 4, 0.3, 0.85),
    };
  }

  async buildObservation(
    harness: Harness,
    sel: { marketId: `0x${string}`; asset: string; intervalSec: number; secondsLeft: number },
    onchain: MarketOnchain,
  ): Promise<Observation> {
    const [book, positions, collateral] = await Promise.all([
      harness.book(onchain),
      harness.positions(onchain),
      harness.collateralBalance(),
    ]);
    const bookView = {
      bestBid: book.bestBidProb,
      bestAsk: book.bestAskProb,
      mid: book.midProb,
    };
    let recentFills: { price: number; quantity: number; agoSec: number }[] = [];
    try {
      const fills = await harness.exchange.client.getFills(onchain.pool, { limit: 5 });
      const now = Date.now() / 1000;
      recentFills = fills.map((f) => ({
        price: Number(f.fillPrice) / 10 ** onchain.decimals,
        quantity: Number(f.quantity) / 10 ** onchain.decimals,
        agoSec: Math.max(0, Math.round(now - Number(f.timestamp))),
      }));
    } catch {
      recentFills = [];
    }
    const marketRow = this.db
      .prepare(`select lastPrice, quoteDecimals from markets where marketId = ?`)
      .get(sel.marketId) as { lastPrice: string | null; quoteDecimals: number } | undefined;
    const lastPrice =
      marketRow?.lastPrice !== null && marketRow?.lastPrice !== undefined && marketRow.quoteDecimals > 0
        ? Number(marketRow.lastPrice) / 10 ** marketRow.quoteDecimals
        : null;
    const scale = 10 ** onchain.decimals;
    return {
      asset: sel.asset,
      intervalSec: sel.intervalSec,
      timeToCloseSec: sel.secondsLeft,
      book: bookView,
      recentFills,
      position: {
        up: Number(positions.yes) / scale,
        down: Number(positions.no) / scale,
      },
      collateral: Number(collateral) / scale,
      lastPrice,
    };
  }

  async tick(harness: Harness): Promise<void> {
    const sel = harness.selectMarket("BTC", 3600);
    if (!sel) return;
    const onchain = await harness.onchain(sel.marketId);
    if (onchain.status !== 1 || onchain.finalized) return;

    const observation = await this.buildObservation(harness, sel, onchain);
    const { proposal, source } = await this.decide(observation);

    let actionText: string;
    if (proposal.side === "pass") {
      actionText = `pass (${proposal.thought})`;
    } else if (Date.now() - this.lastSentAt < SENT_COOLDOWN_MS) {
      actionText = `proposed ${proposal.side} ${proposal.outcome} ${proposal.size} @ ${proposal.price.toFixed(3)} — vetoed: cooldown after last send`;
    } else {
      const decision = proposalToDecision(proposal, sel.marketId);
      const outcome = await harness.execute(decision, onchain);
      switch (outcome.status) {
        case "sent":
          this.lastSentAt = Date.now();
          actionText = `proposed ${proposal.side} ${proposal.outcome} ${proposal.size} @ ${proposal.price.toFixed(3)} — SENT tx=${outcome.txHash} filled=${outcome.filledContracts}`;
          break;
        case "rested":
          actionText = `proposed ${proposal.side} ${proposal.outcome} ${proposal.size} @ ${proposal.price.toFixed(3)} — RESTED order=${outcome.orderId}`;
          break;
        case "crossed":
          actionText = `proposed ${proposal.side} ${proposal.outcome} ${proposal.size} @ ${proposal.price.toFixed(3)} — vetoed: post-only would cross, requote next tick`;
          break;
        case "skipped":
          actionText = `proposed ${proposal.side} ${proposal.outcome} ${proposal.size} @ ${proposal.price.toFixed(3)} — vetoed: ${outcome.reason}`;
          break;
        case "error":
          actionText = `proposed ${proposal.side} ${proposal.outcome} ${proposal.size} @ ${proposal.price.toFixed(3)} — error: ${outcome.message}`;
          break;
      }
    }

    insertReasoningRow(this.db, {
      agentKind: "llm",
      marketId: sel.marketId,
      observation: JSON.stringify(observation),
      thought: proposal.thought,
      action: actionText,
      confidence: proposal.confidence,
      source,
      createdAt: Math.floor(Date.now() / 1000),
    });
    harness.log(`REASONING [${source}] ${actionText} (confidence ${proposal.confidence.toFixed(2)})`);
  }
}
