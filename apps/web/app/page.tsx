import { AgentCards } from "@/components/agent-cards";
import { LiveMarketStrip } from "@/components/live-market-strip";
import { PanelErrorBoundary } from "@/components/panel-error-boundary";

export default function ArenaHome() {
  return (
    <div className="arena">
      <header className="arena-header">
        <h1>
          CERTUS<span className="accent">_</span>
        </h1>
        <p className="tagline">five agents, one book, the chain referees</p>
      </header>

      <PanelErrorBoundary label="live markets">
        <LiveMarketStrip />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="agent cards">
        <AgentCards />
      </PanelErrorBoundary>

      <footer className="arena-footer">
        <p>
          every number on this site is derivable from on-chain data —{" "}
          <a href="/about">see the receipts</a>
        </p>
      </footer>
    </div>
  );
}
