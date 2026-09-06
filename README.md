# Certus

A verifiable AI-agent trading arena on DreamDEX Event Contracts (Somnia Shannon
testnet, chain 50312). Four-to-five autonomous agents trade live BTC/ETH
Up/Down binary markets; every fill, balance, and PnL is verifiable on-chain.

**Status: Phase 1 shipped (engine core + SQLite data layer).** The workspace,
shared config, env handling, the read-only `doctor` gate, and the engine
(market poller + per-agent fills/balance/PnL ingestion + settlement resolution,
persisted to SQLite keyed by `marketId`) are in. Agents, redemption sweeper,
LLM reasoning stream, and the web arena are specified as GitHub issues, one per
phase, in build order. Work them in sequence; each issue ends with an
acceptance gate that must pass before the next one starts.

## Stack

- pnpm workspaces, TypeScript strict mode everywhere
- `apps/web` — Next.js 14+ App Router arena
- `apps/engine` — bot runner + indexer + redemption sweeper
- `packages/shared` — env loading, network constants, domain types
- `@somnia-chain/markets-sdk` 0.29.0, `viem`, `better-sqlite3`

## Quick start

```bash
pnpm install
cp .env.example .env      # add a funded testnet PRIVATE_KEY
pnpm run doctor           # wallet, balances, live markets, books (note: bare `pnpm doctor` is pnpm's built-in, use `run`)
pnpm start:engine         # market poller + SQLite ingestion (data/certus.sqlite)
pnpm dev                  # web arena (stub until the Phase 5 issue lands)
```

Get testnet funds: STT from https://testnet.somnia.network and tUSDC from the
SomniaHacks dev group faucet topic (https://t.me/+XHq0F0JXMyhmMzM0).

## Verification

`pnpm run doctor` is the Phase 0 gate: it prints the wallet, STT + tUSDC balances,
and every live binary market with its live on-chain status (gated via
`exchange.client.getMarketOnchain`, never the indexer), seconds to expiry, and
top-of-book for the Up symbol. Exit code 0 = gate passed.

## Build order

| Issue | Phase | Ships |
| --- | --- | --- |
| [#1](https://github.com/Mosas2000/Certus/issues/1) | Phase 0 gate | `pnpm run doctor` green on a funded key |
| [#2](https://github.com/Mosas2000/Certus/issues/2) | Phase 1 | Engine core + SQLite data layer: markets, fills, balances, PnL persisted |
| [#3](https://github.com/Mosas2000/Certus/issues/3) | Phase 2 | Four classic agents + shared safety harness: live testnet fills per agent |
| [#4](https://github.com/Mosas2000/Certus/issues/4) | Phase 3 | Redemption sweeper: winnings rescued on Finalized markets |
| [#5](https://github.com/Mosas2000/Certus/issues/5) | Phase 4 | LLM agent + reasoning stream: observation/thought/action/confidence rows |
| [#6](https://github.com/Mosas2000/Certus/issues/6) | Phase 5 | Web arena: live leaderboards, trade tapes, reasoning, receipts |
| [#7](https://github.com/Mosas2000/Certus/issues/7) | Phase 6 | Submission kit: README, demo script, feedback report |
| [#8](https://github.com/Mosas2000/Certus/issues/8) | Guardrails | The 12 hard constraints — applies to every phase, pinned |

Phases 0–3 and Phase 5's arena home + leaderboard are the submission; the rest
degrades gracefully but ships.
