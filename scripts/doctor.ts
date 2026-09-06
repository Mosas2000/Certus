import {
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { erc20Abi, formatUnits } from "viem";
import { AGENTS, explorerAddressUrl, loadEnv } from "@certus/shared";

const LINE = "-".repeat(88);

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

  await exchange.loadMarkets();

  console.log(LINE);
  console.log("live binary markets");
  console.log(LINE);

  const rows = await exchange.client.listLiveBinaryMarkets({ limit: 50 });
  const now = Date.now() / 1000;
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

  let gatePassed = false;
  const notes: string[] = [];
  let errors = 0;

  for (const m of inVenue) {
    const secondsLeft = Number(m.expiry) - now;
    const label = `market ${m.marketId}`;

    try {
      const onchain = await exchange.client.getMarketOnchain(m.marketId);
      const tradable = exchange.market(m.marketId);
      const book = await exchange.fetchOrderBook(tradable.symbol, 5);
      const bestBid = book.bids[0]?.[0];
      const bestAsk = book.asks[0]?.[0];
      const bidSize = book.bids[0]?.[1];
      const askSize = book.asks[0]?.[1];
      const hasBook = bestBid !== undefined || bestAsk !== undefined;
      const isTrading = onchain.status === 1 && !onchain.finalized;

      console.log("");
      console.log(
        `${m.asset ?? "?"}  window=${m.interval ?? "?"}  ${statusName(onchain.status, onchain.finalized)}  ${fmtSeconds(secondsLeft)} left`,
      );
      console.log(`  marketId ${m.marketId}`);
      console.log(`  up       ${tradable.symbol}`);
      console.log(`  pool     ${onchain.pool}`);
      console.log(
        hasBook
          ? `  book     bid ${bestBid ?? "—"} x ${bidSize ?? "—"} / ask ${bestAsk ?? "—"} x ${askSize ?? "—"}`
          : "  book     empty",
      );

      if (isTrading && secondsLeft >= 300 && hasBook && m.asset === "BTC") {
        gatePassed = true;
      }
      if (isTrading && secondsLeft < 300 && m.asset === "BTC") {
        notes.push(`BTC market ${m.marketId} has <300s left — rerun doctor for the next window`);
      }
    } catch (err) {
      errors += 1;
      console.log("");
      console.log(`${m.asset ?? "?"} ${label} read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (rows.length > 0 && inVenue.length === 0) {
    notes.push(
      `no live markets on VENUE_ID ${env.venueId}: update it in .env from the venueIds printed above`,
    );
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
  console.error(`doctor failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
