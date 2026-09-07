import { explorerTxUrl } from "@certus/shared";
import { errText, type CertusEnv, type SweeperResultRow } from "@certus/shared";
import type { Db } from "./db.js";
import { insertSweeperResult, setAgentError } from "./db.js";
import type { Harness } from "./harness.js";
import type { TradingConfig } from "./config.js";

export interface SweepSummary {
  scanned: number;
  eligible: number;
  held: number;
  redeemed: number;
  rescued: bigint;
}

const VOID_PAYOUT_DIVISOR = 2n;

function log(agentKind: string, message: string): void {
  console.log(`[sweep ${agentKind}] ${message}`);
}

export async function sweepAgent(
  harness: Harness,
  db: Db,
  env: CertusEnv,
  config: TradingConfig,
): Promise<SweepSummary> {
  const kind = harness.agentKind;
  const summary: SweepSummary = {
    scanned: 0,
    eligible: 0,
    held: 0,
    redeemed: 0,
    rescued: 0n,
  };

  const rows = db
    .prepare(
      `select marketId from markets where status = 'Finalized' and venueId = ? order by expiry desc limit ?`,
    )
    .all(env.venueId, env.claimScan) as { marketId: string }[];
  summary.scanned = rows.length;

  for (const row of rows) {
    const marketId = row.marketId as `0x${string}`;
    try {
      const oc = await harness.onchain(marketId);
      if (!oc.isResolved && !oc.isVoided) continue;
      summary.eligible += 1;

      if (!oc.isVoided && oc.winningOutcome !== 0 && oc.winningOutcome !== 1) {
        log(kind, `skip ${marketId}: resolved but winningOutcome=${oc.winningOutcome} is not a valid side`);
        continue;
      }

      const [yes, no] = await Promise.all([
        harness.exchange.client.getOutcomeBalance({
          outcomeToken: oc.outcomeToken,
          account: harness.address,
          id: oc.yesId,
        }),
        harness.exchange.client.getOutcomeBalance({
          outcomeToken: oc.outcomeToken,
          account: harness.address,
          id: oc.noId,
        }),
      ]);

      const toClaim: (0 | 1)[] = oc.isVoided ? [0, 1] : [oc.winningOutcome === 0 ? 0 : 1];

      for (const outcomeIdx of toClaim) {
        const amount = outcomeIdx === 0 ? yes : no;
        if (amount === 0n) continue;
        summary.held += 1;

        const rescued =
          oc.isVoided ? amount / VOID_PAYOUT_DIVISOR : amount;
        const sideLabel = outcomeIdx === 0 ? "Up" : "Down";

        if (config.dryRun) {
          log(
            kind,
            `DRY_RUN would redeem ${sideLabel} on ${marketId}${oc.isVoided ? " (voided)" : ""}: ${amount} raw for ${rescued} raw collateral`,
          );
          continue;
        }

        const res = await harness.exchange.trader.redeem({
          marketId,
          market: oc.marketAddress,
          outcomeToken: oc.outcomeToken,
          outcomeIdx,
          amount,
        });
        if (res.receipt.status === "reverted") {
          const msg = `redeem reverted on-chain: tx ${res.hash}`;
          log(kind, msg);
          setAgentError(db, kind, msg);
          continue;
        }

        const record: SweeperResultRow = {
          marketId,
          agentKind: kind,
          outcomeIdx,
          amount: amount.toString(),
          txHash: res.hash,
          rescued: rescued.toString(),
          createdAt: Math.floor(Date.now() / 1000),
        };
        insertSweeperResult(db, record);
        summary.redeemed += 1;
        summary.rescued += rescued;
        log(
          kind,
          `WINNINGS RESCUED ${sideLabel} on ${marketId}: ${amount} raw for ${rescued} raw collateral — tx ${res.hash} (${explorerTxUrl(res.hash)})`,
        );
      }
    } catch (err) {
      const msg = `sweep ${marketId}: ${errText(err).split("\n")[0]}`;
      log(kind, msg);
      setAgentError(db, kind, msg);
    }
  }

  if (summary.held === 0) {
    log(
      kind,
      `verified zero across the last ${summary.scanned} Finalized market(s): nothing held, nothing to claim`,
    );
  }

  return summary;
}
