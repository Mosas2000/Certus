"use client";

import type { AgentDetail } from "@/lib/queries";
import { usePolling } from "@/lib/use-polling";
import { Sparkline } from "./sparkline";
import { AGENTS } from "@certus/shared/types";

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://shannon-explorer.somnia.network";
const ORACLE_PREFIX = "https://prd.oracle.somnia.host/questions/";

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function TradeTape({ fills }: { fills: AgentDetail["fills"] }) {
  if (fills.length === 0) {
    return <p className="dim">no fills recorded yet</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>time</th>
          <th>market</th>
          <th>side</th>
          <th>price</th>
          <th>qty</th>
          <th>tx</th>
        </tr>
      </thead>
      <tbody>
        {fills.map((f) => (
          <tr key={f.id}>
            <td>{fmtTime(f.filledAt)}</td>
            <td>{f.symbol !== "" ? f.symbol : f.marketId.slice(2, 10)}</td>
            <td className={f.side.startsWith("BUY") ? "side-buy" : "side-sell"}>{f.side}</td>
            <td>{(Number(f.price) / 1e6).toFixed(3)}</td>
            <td>{(Number(f.quantity) / 1e6).toFixed(2)}</td>
            <td>
              <a href={`${EXPLORER}/tx/${f.txHash}`} target="_blank" rel="noreferrer">
                {f.txHash.slice(0, 8)}…
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Balances({ balances }: { balances: AgentDetail["balances"] }) {
  const held = balances.filter((b) => b.yesBalance > 0 || b.noBalance > 0);
  if (held.length === 0) {
    return <p className="dim">no outcome balances held (ERC-6909)</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>market</th>
          <th>asset</th>
          <th>window</th>
          <th>up</th>
          <th>down</th>
          <th>status</th>
          <th>oracle</th>
        </tr>
      </thead>
      <tbody>
        {held.map((b) => (
          <tr key={b.marketId}>
            <td title={b.marketId}>{b.marketId.slice(2, 10)}</td>
            <td>{b.asset}</td>
            <td>{b.intervalSec !== null ? `${b.intervalSec / 60}m` : "—"}</td>
            <td>{b.yesBalance > 0 ? b.yesBalance.toFixed(2) : "—"}</td>
            <td>{b.noBalance > 0 ? b.noBalance.toFixed(2) : "—"}</td>
            <td>{b.status}</td>
            <td>
              {b.oracleQuestionId ? (
                <a href={`${ORACLE_PREFIX}${b.oracleQuestionId}`} target="_blank" rel="noreferrer">
                  resolution
                </a>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Reasoning({ rows }: { rows: AgentDetail["reasoning"] }) {
  if (rows.length === 0) {
    return <p className="dim">no reasoning rows yet — the reasoner ticks once a minute</p>;
  }
  return (
    <ul className="reasoning-list">
      {rows.map((r, i) => (
        <li key={`${r.createdAt}-${i}`} className="reasoning-row">
          <div className="reasoning-head">
            <span className="dim">{fmtTime(r.createdAt)}</span>
            <span className={`pill ${r.source === "anthropic" ? "pill-live" : "pill-dim"}`}>{r.source}</span>
            <span className="reasoning-conf">{(r.confidence * 100).toFixed(0)}%</span>
          </div>
          <p className="reasoning-thought">{r.thought}</p>
          <p className="reasoning-action">{r.action}</p>
          <details>
            <summary className="dim">observation</summary>
            <pre className="reasoning-obs">{r.observation}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function AgentDetailBody({ kind }: { kind: string }) {
  const { data, error } = usePolling<AgentDetail>(`/api/agents/${kind}`, 15_000);
  const def = AGENTS.find((a) => a.kind === kind);

  if (error !== null) {
    return (
      <div className="panel panel-error">
        <p>agent data unavailable: {error}</p>
      </div>
    );
  }
  if (data === null) {
    return <div className="panel" aria-busy="true"><p className="dim">loading…</p></div>;
  }

  const { card, fills, balances, reasoning } = data;
  return (
    <div className="agent-detail">
      <header className="agent-detail-head">
        <span className="agent-glyph">{def?.glyph ?? "?"}</span>
        <h1>{def?.name ?? kind}</h1>
        {card.paused ? <span className="pill pill-warn">paused</span> : null}
        {card.address ? (
          <a className="agent-address" href={`${EXPLORER}/address/${card.address}`} target="_blank" rel="noreferrer">
            {card.address.slice(0, 10)}…
          </a>
        ) : null}
      </header>
      <p className="agent-desc">{def?.description}</p>

      <section className="agent-detail-stats">
        <div>
          <span className="dim">equity</span>
          <div className="agent-equity">
            <Sparkline points={card.equityCurve.map((p) => p.collateral)} />
            <span className="agent-equity-value">{card.equity !== null ? card.equity.toFixed(2) : "—"}</span>
          </div>
        </div>
        <div>
          <span className="dim">realized pnl</span>
          <span className={card.realizedPnl >= 0 ? "side-buy" : "side-sell"}>
            {card.realizedPnl.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="dim">rescued</span>
          <span>{card.winningsRescued.toFixed(2)}</span>
        </div>
        <div>
          <span className="dim">win rate</span>
          <span>{card.winRate !== null ? `${(card.winRate * 100).toFixed(0)}%` : "—"}</span>
        </div>
      </section>

      <Panel title="trade tape">
        <TradeTape fills={fills} />
      </Panel>
      <Panel title="outcome balances (ERC-6909)">
        <Balances balances={balances} />
      </Panel>
      <Panel title="reasoning stream">
        <Reasoning rows={reasoning} />
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">{title}</div>
      {children}
    </section>
  );
}
