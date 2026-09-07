"use client";

import Link from "next/link";
import type { AgentCard } from "@/lib/queries";
import { usePolling } from "@/lib/use-polling";
import { Sparkline } from "./sparkline";

function fmtUsd(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

function fmtPct(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function AgentCardView({ agent }: { agent: AgentCard }) {
  return (
    <article className="agent-card" data-agent={agent.kind}>
      <div className="agent-card-head">
        <span className="agent-glyph">{agent.glyph}</span>
        <h2>
          <Link href={`/agents/${agent.kind}`}>{agent.name}</Link>
        </h2>
        {agent.paused ? <span className="pill pill-warn">paused</span> : null}
      </div>
      <p className="agent-desc">{agent.description}</p>
      <div className="agent-equity">
        <Sparkline points={agent.equityCurve.map((p) => p.collateral)} />
        <span className="agent-equity-value">{fmtUsd(agent.equity)}</span>
      </div>
      <dl className="agent-meta">
        <dt>open position</dt>
        <dd>{agent.openPosition > 0 ? agent.openPosition.toFixed(2) : "—"}</dd>
        <dt>win rate</dt>
        <dd>{fmtPct(agent.winRate)}</dd>
        <dt>trades</dt>
        <dd>{agent.trades > 0 ? agent.trades : "—"}</dd>
        <dt>rescued</dt>
        <dd>{agent.winningsRescued > 0 ? agent.winningsRescued.toFixed(2) : "—"}</dd>
      </dl>
      {agent.lastError ? <p className="agent-error" title={agent.lastError}>{agent.lastError}</p> : null}
    </article>
  );
}

export function AgentCards() {
  const { data, error } = usePolling<{ agents: AgentCard[] }>("/api/arena", 10_000);

  if (error !== null) {
    return (
      <div className="panel panel-error">
        <p>arena data unavailable: {error}</p>
      </div>
    );
  }
  if (data === null) {
    return (
      <section className="agent-grid" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="agent-card agent-card-loading" />
        ))}
      </section>
    );
  }
  const hasData = data.agents.some((a) => a.equity !== null || a.trades > 0);
  if (!hasData) {
    return (
      <div className="panel">
        <p className="dim">no agent data yet — start the engine (`pnpm start:engine`) and fund the agent keys</p>
      </div>
    );
  }
  return (
    <section className="agent-grid">
      {data.agents.map((agent) => (
        <AgentCardView key={agent.kind} agent={agent} />
      ))}
    </section>
  );
}
