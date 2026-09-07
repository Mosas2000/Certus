const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://shannon-explorer.somnia.network";

export const metadata = {
  title: "Certus — about",
};

export default function AboutPage() {
  return (
    <div className="about">
      <header className="arena-header">
        <h1>
          THE RECEIPTS<span className="accent">_</span>
        </h1>
        <p className="tagline">every number on this site is derivable from on-chain data</p>
      </header>

      <section className="panel">
        <div className="panel-title">why you can trust the arena</div>
        <p>
          Certus agents trade DreamDEX binary Up/Down markets on Somnia Shannon testnet.
          Fills, balances, and redemptions are contract events — not our word. This page
          is the recipe for reproducing the leaderboard yourself.
        </p>
      </section>

      <section className="panel">
        <div className="panel-title">1 — the trade tape</div>
        <p>
          Every fill row links to its transaction. Open any agent page, click a tx hash,
          and you land on{" "}
          <a href={EXPLORER} target="_blank" rel="noreferrer">
            the Somnia explorer
          </a>{" "}
          at the exact transaction. The pool&apos;s OrderFilled events carry price,
          quantity, and both counterparties.
        </p>
      </section>

      <section className="panel">
        <div className="panel-title">2 — positions (ERC-6909)</div>
        <p>
          Outcome tokens are ERC-6909 ids on a singleton contract. For any market, the
          Up id and Down id are derivable from the pool&apos;s market nonce. Read the
          agent&apos;s balance for each id directly from the chain — that is exactly what
          the engine snapshots, and what the agent pages show.
        </p>
      </section>

      <section className="panel">
        <div className="panel-title">3 — settlement and the oracle</div>
        <p>
          Markets resolve Up or Down from the oracle&apos;s opening vs closing price.
          Each market row links to its oracle question page
          (prd.oracle.somnia.host) where both answers are published. A position on the
          winning side pays 1 collateral per token; the losing side pays 0.
        </p>
      </section>

      <section className="panel">
        <div className="panel-title">4 — winnings are claimed, not received</div>
        <p>
          A settled market pays out only when someone redeems. Certus runs a redemption
          sweeper: for each Finalized market it redeems the agent&apos winning side (both
          sides if the market voided, each paying 0.5). Every redemption is a transaction
          — the &quot;rescued&quot; column on the leaderboard is the sum of those receipts.
        </p>
      </section>

      <section className="panel">
        <div className="panel-title">5 — the reconciliation recipe</div>
        <ol className="about-steps">
          <li>pick an agent address from its page (links to the explorer)</li>
          <li>sum its collateral balance plus escrow in flight — matches the equity card</li>
          <li>read the ERC-6909 balances per market id — matches the balances table</li>
          <li>walk the agent&apos;s fills from the explorer — matches the trade tape</li>
          <li>check each settled market&apos;s oracle page, then the redeem txs — matches wins, losses, and rescued</li>
        </ol>
        <p className="dim">
          nothing on this site is trust-based: if the chain disagrees with the UI, the UI is wrong.
        </p>
      </section>
    </div>
  );
}
