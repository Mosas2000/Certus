import {
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { AGENTS, explorerAddressUrl, loadEnv } from "@certus/shared";

const LINE = "-".repeat(88);
const LOG_SCAN_WINDOWS = 60;
const LOG_SCAN_BLOCKS = 1000;

const MARKET_CREATED_EVENT = {
  type: "event",
  name: "MarketCreated",
  inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "market", type: "address", indexed: true },
    { name: "pool", type: "address", indexed: true },
    { name: "yesId", type: "uint256" },
    { name: "noId", type: "uint256" },
    { name: "collateral", type: "address" },
    { name: "asset", type: "string" },
    { name: "strike", type: "uint256" },
    { name: "tradingStart", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "oracleQuestionId", type: "uint256" },
    { name: "question", type: "string" },
    { name: "intervalSec", type: "uint64" },
  ],
} as const;

interface DoctorMarket {
  marketId: `0x${string}`;
  asset: string;
  interval: string;
  expiry: number;
}

function fmtSeconds(sec: number): string {
  if (sec <= 0) return "expired";
  if (sec < 90) return `${Math.round(sec)}s`;
  return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

const STATUS_NAMES: Record<number, string> = {
  0: "Listed",
  1: "Trading",
  2: "Locked",
  3: "Settling",
  4: "Resolved",
  5: "Voided",
};

function statusName(status: number, finalized: boolean): string {
  if (finalized) return `${STATUS_NAMES[status] ?? `status=${status}`} (finalized)`;
  return STATUS_NAMES[status] ?? `status=${status}`;
}

function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? ` ${err.cause.message}` : "";
  return `${msg}${cause}`;
}

function isTransient(err: unknown): boolean {
  return /timeout|abort|econnreset|etimedout|econnrefused|fetch failed|socket|network|502|503|504/i.test(
    errText(err),
  );
}

async function withRetry<T>(label: string, delays: number[], op: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      const delay = delays[attempt];
      if (delay === undefined || !isTransient(err)) break;
      console.log(
        `  ${label} failed: ${errText(err).split("\n")[0]} — retrying in ${delay / 1000}s (${attempt + 1}/${delays.length})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function fmtRaw(value: bigint, decimals: number): string {
  return String(Number(value) / 10 ** decimals);
}

async function discoverMarketsViaLogs(
  rpcUrl: string,
  collateral: `0x${string}`,
): Promise<DoctorMarket[]> {
  const pub = createPublicClient({ chain: somniaShannon, transport: http(rpcUrl) });
  const head = await pub.getBlockNumber();
  const seen = new Map<string, DoctorMarket>();
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < LOG_SCAN_WINDOWS; i++) {
    const to = head - BigInt(i * LOG_SCAN_BLOCKS);
    try {
      const logs = await pub.getLogs({
        event: MARKET_CREATED_EVENT,
        fromBlock: to - BigInt(LOG_SCAN_BLOCKS - 1),
        toBlock: to,
      });
      for (const log of logs) {
        const args = log.args;
        const marketId = args.marketId;
        const expiry = args.expiry;
        const token = args.collateral;
        if (!marketId || expiry === undefined || !token) continue;
        if (Number(expiry) <= now + 120) continue;
        if (token.toLowerCase() !== collateral.toLowerCase()) continue;
        seen.set(marketId.toLowerCase(), {
          marketId: marketId as `0x${string}`,
          asset: args.asset ?? "?",
          interval: `${Number(args.intervalSec ?? 0n) / 60}m`,
          expiry: Number(expiry),
        });
      }
    } catch {
      continue;
    }
  }

  return [...seen.values()].sort((a, b) => a.expiry - b.expiry);
}

async function main() {
  const env = loadEnv();

  const exchange = new SomniaMarkets({
    indexerUrl: env.indexerUrl,
    chain: somniaShannon,
    wsRpcUrl: env.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey: env.privateKey,
  });

  const viem = exchange.client.getViemClient();
  const wallet = exchange.walletAddress;
  if (!wallet) throw new Error("no signer: check PRIVATE_KEY");

  const collateral = SOMNIA_TESTNET_ADDRESSES.collateral ?? SOMNIA_TESTNET_ADDRESSES.testUsdc;
  if (!collateral) {
    throw new Error("SOMNIA_TESTNET_ADDRESSES carries no collateral address for this deployment");
  }

  console.log(LINE);
  console.log("certus doctor");
  console.log(LINE);
  console.log("network        testnet (Somnia Shannon, chain 50312)");
  console.log(`rpc            ${env.rpcUrl}`);
  console.log(`ws             ${env.wsRpcUrl}`);
  console.log(`indexer        ${env.indexerUrl}`);
  console.log(`venueId        ${env.venueId}`);
  console.log(`dryRun         ${env.dryRun}`);
  console.log(`wallet         ${wallet}`);
  console.log(`wallet url     ${explorerAddressUrl(wallet)}`);

  const [native, collateralRaw, collateralDecimals] = await Promise.all([
    viem.getBalance({ address: wallet }),
    viem.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    viem.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  const funded = AGENTS.filter((a) => env.agentKeys[a.kind]);

  console.log(LINE);
  console.log("balances");
  console.log(LINE);
  console.log(`STT (gas)      ${formatUnits(native, 18)}`);
  console.log(
    `USDso (collat) ${formatUnits(collateralRaw, collateralDecimals)} (${collateralDecimals} decimals, read on-chain)`,
  );
  console.log(
    `agent keys     ${funded.length}/${AGENTS.length}${funded.length ? ` [${funded.map((a) => a.kind).join(", ")}]` : ""}`,
  );
  if (collateralRaw === 0n) {
    console.log("");
    console.log("wallet has no testnet collateral: get STT at https://testnet.somnia.network");
    console.log("and request tUSDC in the SomniaHacks dev group faucet topic");
  }

  console.log(LINE);
  console.log("live binary markets");
  console.log(LINE);

  let markets: DoctorMarket[] = [];
  let indexerOk = true;
  let registryOk = true;

  try {
    const rows = await withRetry("listLiveBinaryMarkets", [2_000, 8_000], () =>
      exchange.client.listLiveBinaryMarkets({ limit: 50 }),
    );
    const inVenue = rows.filter(
      (m) => (m.venueId ?? "").toLowerCase() === env.venueId.toLowerCase(),
    );
    const outOfVenue = rows.filter(
      (m) => (m.venueId ?? "").toLowerCase() !== env.venueId.toLowerCase(),
    );
    console.log(
      `indexer returned ${rows.length} live market(s): ${inVenue.length} on the configured venue, ${outOfVenue.length} elsewhere`,
    );
    if (outOfVenue.length > 0) {
      const otherVenues = [
        ...new Set(outOfVenue.map((m) => m.venueId ?? "(null)").map((v) => v.toLowerCase())),
      ];
      console.log(`  other venueIds on live rows: ${otherVenues.join(", ")}`);
    }
    markets = inVenue.map((m) => ({
      marketId: m.marketId as `0x${string}`,
      asset: m.asset ?? "?",
      interval: m.interval ?? "?",
      expiry: Number(m.expiry),
    }));
  } catch (err) {
    indexerOk = false;
    registryOk = false;
    console.log(`WARNING indexer market list unavailable (${errText(err).split("\n")[0]})`);
    console.log("falling back to MarketCreated chain-log discovery (indexer-independent)");
    markets = await discoverMarketsViaLogs(env.rpcUrl, collateral);
    console.log(
      `chain-log scan found ${markets.length} live market(s) in the ${collateral} collateral`,
    );
    if (markets.length > 0) {
      console.log("venue attribution unavailable without the indexer — showing all live markets");
    }
  }

  if (indexerOk) {
    try {
      await withRetry("loadMarkets", [2_000, 5_000, 15_000], () => exchange.loadMarkets());
    } catch (err) {
      registryOk = false;
      console.log(
        `WARNING unified symbol registry unavailable (${errText(err).split("\n")[0]})`,
      );
      console.log("falling back to chain-only book reads; symbols hidden for this run");
    }
  }

  const now = Date.now() / 1000;
  let gatePassed = false;
  const notes: string[] = [];
  let errors = 0;

  for (const m of markets) {
    const secondsLeft = m.expiry - now;

    try {
      const onchain = await exchange.client.getMarketOnchain(m.marketId);
      const isTrading = onchain.status === 1 && !onchain.finalized;

      let bookLine: string;
      let hasBook: boolean;

      if (registryOk) {
        const tradable = exchange.market(m.marketId);
        const book = await exchange.fetchOrderBook(tradable.symbol, 5);
        const bestBid = book.bids[0]?.[0];
        const bestAsk = book.asks[0]?.[0];
        const bidSize = book.bids[0]?.[1];
        const askSize = book.asks[0]?.[1];
        hasBook = bestBid !== undefined || bestAsk !== undefined;
        bookLine = hasBook
          ? `bid ${bestBid ?? "—"} x ${bidSize ?? "—"} / ask ${bestAsk ?? "—"} x ${askSize ?? "—"}`
          : "empty";
        console.log("");
        console.log(
          `${m.asset}  window=${m.interval}  ${statusName(onchain.status, onchain.finalized)}  ${fmtSeconds(secondsLeft)} left`,
        );
        console.log(`  marketId ${m.marketId}`);
        console.log(`  up       ${tradable.symbol}`);
        console.log(`  pool     ${onchain.pool}`);
        console.log(`  book     ${bookLine}`);
      } else {
        const book = await exchange.client.getBinaryOrderBook(onchain.pool, { depth: 5 });
        const bestBid = book.yesBids[0];
        const bestAsk = book.yesAsks[0];
        hasBook = bestBid !== undefined || bestAsk !== undefined;
        bookLine = hasBook
          ? `bid ${bestBid ? fmtRaw(bestBid.price, onchain.decimals) : "—"} x ${bestBid ? fmtRaw(bestBid.quantity, onchain.decimals) : "—"} / ask ${bestAsk ? fmtRaw(bestAsk.price, onchain.decimals) : "—"} x ${bestAsk ? fmtRaw(bestAsk.quantity, onchain.decimals) : "—"}`
          : "empty";
        console.log("");
        console.log(
          `${m.asset}  window=${m.interval}  ${statusName(onchain.status, onchain.finalized)}  ${fmtSeconds(secondsLeft)} left`,
        );
        console.log(`  marketId ${m.marketId}`);
        console.log("  up       (symbol n/a — book read on-chain)");
        console.log(`  pool     ${onchain.pool}`);
        console.log(`  book     ${bookLine}`);
      }

      if (isTrading && secondsLeft >= 300 && hasBook && m.asset === "BTC") {
        gatePassed = true;
      }
      if (isTrading && secondsLeft < 300 && m.asset === "BTC") {
        notes.push(`BTC market ${m.marketId} has <300s left — rerun doctor for the next window`);
      }
    } catch (err) {
      errors += 1;
      console.log("");
      console.log(`${m.asset} market ${m.marketId} read failed: ${errText(err).split("\n")[0]}`);
    }
  }

  if (indexerOk && markets.length === 0) {
    notes.push(
      `no live markets on VENUE_ID ${env.venueId}: update it in .env from the venueIds printed above`,
    );
  }
  if (!indexerOk) {
    notes.push("indexer degraded this run: market list discovered from chain logs, books read on-chain");
  } else if (!registryOk) {
    notes.push("unified symbol registry degraded this run — chain reads verified the venue; rerun when the indexer recovers");
  }

  console.log("");
  console.log(LINE);
  console.log("phase 0 gate");
  console.log(LINE);
  console.log(
    `live BTC market in status 1 with a non-empty book: ${gatePassed ? "PASS" : "FAIL"}`,
  );
  for (const note of notes) console.log(`  note: ${note}`);
  if (errors > 0) console.log(`  note: ${errors} market read(s) failed — see errors above`);
  console.log(LINE);

  process.exit(gatePassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`doctor failed: ${errText(err)}`);
  process.exit(1);
});
