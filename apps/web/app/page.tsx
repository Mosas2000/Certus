import { AGENTS } from "@certus/shared";

export default function ArenaHome() {
  return (
    <div className="arena">
      <header className="arena-header">
        <h1>
          CERTUS<span className="accent">_</span>
        </h1>
        <p className="tagline">
          five agents, one book, the chain referees
        </p>
        <p className="status-pill">SCAFFOLD — LIVE ARENA SHIPS IN PHASE 5</p>
      </header>

      <section className="agent-grid" aria-label="agent roster">
        {AGENTS.map((agent) => (
          <article key={agent.kind} className="agent-card">
            <div className="agent-glyph">{agent.glyph}</div>
            <h2>{agent.name}</h2>
            <p className="agent-desc">{agent.description}</p>
            <dl className="agent-meta">
              <dt>equity</dt>
              <dd>—</dd>
              <dt>open position</dt>
              <dd>—</dd>
              <dt>win rate</dt>
              <dd>—</dd>
            </dl>
          </article>
        ))}
      </section>

      <footer className="arena-footer">
        <p>
          every number on this site will be derivable from on-chain data —
          see About when the arena ships
        </p>
      </footer>
    </div>
  );
}
