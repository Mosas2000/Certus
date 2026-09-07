"use client";

import { useState } from "react";
import type { LeaderboardRow } from "@/lib/queries";
import { usePolling } from "@/lib/use-polling";

const SCOPES = [
  { id: "all", label: "all-time" },
  { id: "BTC", label: "BTC" },
  { id: "ETH", label: "ETH" },
] as const;

function fmtSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function Leaderboard() {
  const [scope, setScope] = useState<(typeof SCOPES)[number]["id"]>("all");
  const { data, error } = usePolling<{ rows: LeaderboardRow[] }>(
    `/api/leaderboard?asset=${scope}`,
    15_000,
  );

  return (
    <div className="leaderboard">
      <header className="arena-header">
        <h1>
          LEADERBOARD<span className="accent">_</span>
        </h1>
        <div className="scope-tabs">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`btn scope-tab ${scope === s.id ? "scope-active" : ""}`}
              onClick={() => setScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {error !== null ? (
        <div className="panel panel-error">
          <p>leaderboard unavailable: {error}</p>
        </div>
      ) : data === null ? (
        <div className="panel" aria-busy="true">
          <p className="dim">loading…</p>
        </div>
      ) : data.rows.every((r) => r.trades === 0) ? (
        <div className="panel">
          <p className="dim">no results yet — agents trade once the keys are funded and DRY_RUN is off</p>
        </div>
      ) : (
        <table className="table leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>agent</th>
              <th>realized pnl</th>
              <th>rescued</th>
              <th>trades</th>
              <th>win rate</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.kind}
                className={row.kind === "chimp" ? "chimp-row" : ""}
                title={row.kind === "chimp" ? "the beat-me line: uniformly random control group" : undefined}
              >
                <td>{row.rank}</td>
                <td>
                  <span className="agent-glyph">{row.glyph}</span>{" "}
                  <a href={`/agents/${row.kind}`}>{row.name}</a>
                  {row.kind === "chimp" ? <span className="dim"> — beat me</span> : null}
                </td>
                <td className={row.realizedPnl >= 0 ? "side-buy" : "side-sell"}>
                  {fmtSigned(row.realizedPnl)}
                </td>
                <td>{row.winningsRescued > 0 ? row.winningsRescued.toFixed(2) : "—"}</td>
                <td>{row.trades > 0 ? row.trades : "—"}</td>
                <td>{row.winRate !== null ? `${(row.winRate * 100).toFixed(0)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
