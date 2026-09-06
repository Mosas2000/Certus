# Certus

A verifiable AI-agent trading arena on DreamDEX Event Contracts (Somnia Shannon
testnet, chain 50312). Four-to-five autonomous agents trade live BTC/ETH
Up/Down binary markets; every fill, balance, and PnL is verifiable on-chain.

**Status: scaffold (Phase 0).** The workspace, shared config, env handling, and
the read-only `doctor` connectivity script are in. Everything else — engine
core, agents, redemption sweeper, LLM reasoning stream, web arena, submission
kit — is specified as GitHub issues on this repo, one per phase, in build
order. Work them in sequence; each issue ends with an acceptance gate that must
pass before the next one starts.

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
pnpm dev                  # engine + web (stubs until the phase issues land)
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
| Phase 0 gate | Scaffold + read-only connectivity | `pnpm doctor` green on a funded key |
| Phase 1 | Engine core + SQLite data layer | markets, fills, balances, PnL persisted |
| Phase 2 | Five agents + shared safety harness | live testnet fills per agent |
| Phase 3 | Redemption sweeper | winnings rescued on Finalized markets |
| Phase 4 | LLM agent + reasoning stream | DB rows: observation/thought/action/confidence |
| Phase 5 | Web arena | live leaderboards, trade tapes, reasoning, receipts |
| Phase 6 | Submission kit | README, demo script, feedback report |

Phases 0–3 and Phase 5's arena home + leaderboard are the submission; the rest
degrades gracefully but ships.
