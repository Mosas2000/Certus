# Certus — SDK & docs feedback report

Honest, build-earned feedback on `@somnia-chain/markets-sdk@0.29.0` and
docs.dreamdex.io, from shipping a five-agent arena against them (Phases 0–5,
2026-09-06/07). Each item notes where it cost time. The optional-prize framing:
we came to praise and to complain, both specifically.

## The good (worth saying first)

- **`getBinaryBookParams` + the unified verbs snapping to the grid** — the
  "never send raw floats" problem is real and the SDK mostly solves it. Our
  harness quantizes on the live grid in one place and every order since has
  landed on-tick. (Phase 2)
- **`getMarketOnchain` as a single authoritative pre-write gate** — status,
  ids, decimals, finality in one call. "Gate every write on chain, never the
  indexer" was implementable as literally one line. (Phases 2–3)
- **The trader-tier result objects** — `PlaceOrderResult` carries
  `receipt` + decoded `fills` + `orderId` top-level. The receipt check after
  every write is trivial on this tier. (Phase 2)
- **Server-side `venueId` filtering in `listLiveBinaryMarkets`** — we expected
  to filter client-side; the SDK does it at the indexer. (Phase 1)
- **The live-store React hooks** — `useLiveBinaryOrderBookByMarket` keyed by
  marketId is exactly the right key for rolling binary series, and the
  watch-state surface (`useLiveStatus`, `useIsTailing`) maps 1:1 onto a UI
  status pill. (Phase 5)
- **The gotchas docs** — gotchas 1–13 read like they were written by someone
  who shipped a bot. Several (9–13) matched our incidents almost verbatim.

## The friction (each item cost real time)

### 1. Receipt placement on unified verbs — a silent foot-gun

On `createOrder`/`mintSet` the receipt lives at
`(order.info as PlaceOrderResult).receipt` — there is no `order.receipt`. The
danger isn't the cast, it's the failure mode: reach for `order.receipt` and you
get `undefined`, your "check every receipt" guard becomes
`undefined !== "reverted"` → always passes, and a reverted write sails through
silently. A deprecated alias, a type that makes `order.receipt` a compile
error, or a doc callout on every unified-verb example would each fix it.
**Cost: Phase 2 design time verifying receipt shapes in `dist/*.d.ts` before
trusting any write.** (We ultimately used the trader tier everywhere, partly to
keep the receipt check trivial.)

### 2. Finalized markets are invisible to `loadMarkets()`

`loadMarkets()` skips finalized binaries entirely; the only path to settled
markets is `listBinaryMarkets({ status: "Finalized" })`. Compounding it: the
server sorts newest-**created**, not newest-**expired**, so "the last 20
settled markets" requires over-fetching ~3x and re-sorting by expiry
client-side. And `exchange.market(marketId)` **throws** for a finalized market
(the symbol registry only carries live ones) — so a fill tape that joins
older-than-live markets to symbols crashes unless wrapped. We now wrap it, but
the first encounter (Phase 1) surfaced as an `InvalidInputError` in a
fill-ingestion loop. **Cost: Phase 1 — re-check loop + resolution ingestion +
symbol fallback, all rework after trusting `loadMarkets` initially.**

### 3. Order expiry: the unified tier can't express a dead-man's switch

`CreateOrderParams` accepts no `expireTimestampNs`, and the raw tier's default
is the **market's own expiry** (whole window) — documented only inside
`PlaceOrderParams.expireTimestampNs`'s doc comment in the `.d.ts`. For a bot
that wants orders to age off after 300s, there is no unified-tier option at
all: you must drop to `trader.placeOrder` with an explicit ns value (and
`0 < ns <= marketExpiryNs` is enforced, so "now + 300s" must also be clamped to
market expiry). Both behaviors are defensible; the discovery cost is not.
**Cost: Phase 2 — read `dist/writer.js` to confirm the default before
designing the harness around it.** A one-line "unified verbs expire at market
expiry; pass explicit `expireTimestampNs` on the raw tier for a dead-man's
switch" in the docs would have saved it.

### 4. Status vocabularies disagree between indexer and chain

The indexer speaks `"Listed" | "Trading" | "Locked" | "Settling" | "Resolved" |
"Voided" | "Finalized"`; the on-chain `MarketStatus` enum is 0–5 with **no
Finalized** (it's derived from settlement events). Every comparison layer
(ingest, re-gate, UI) needs its own mapping, and `status === "Finalized"`
indexer-side is not the same moment as `isResolved`/`isVoided` chain-side —
we re-gate everything on-chain precisely because the two disagree at the
seams. **Cost: Phase 1 — the recheck loop exists to bridge the two states.**

### 5. The dev indexer falls over under load — and the timeout isn't configurable

On 2026-09-06 ~18:30 UTC the dev GraphQL endpoint served trivial queries in
0.5s but 504'd (`stream timeout`) every `Market` table query for ~20 minutes.
The SDK's per-request bound is a hard-coded 30s constant
(`GQL_TIMEOUT_MS`), not exposed via `ClientConfig`, so a caller can neither
loosen it for batch backfills nor tighten it for UI paths. We built retry +
chain-log `MarketCreated` discovery fallbacks (the docs' own prescription —
thank you for that recipe) and now survive these windows. **Cost: Phase 0 —
the doctor gate failed mid-demo for a user; hardening consumed an unplanned
session.** Surfacing `timeoutMs` in `ClientConfig` would be a one-line fix on
your side.

### 6. Browser provider wiring requires import archaeology

`createClient` is not exported from the package root (only from internal
`createClient.js`, unreached by `exports`), and `@somnia-chain/markets-sdk/react`
re-exports only the hooks — not `createClient`, `SOMNIA_TESTNET_ADDRESSES`, or
`isBinaryMarket`. The working recipe is
`new SomniaMarkets({...}).client` from the root + hooks from `/react` + chain
from `/chains` — three import sources for one provider. Also note viem's own
`somniaTestnet` chain ships no WS endpoints, while the SDK's `somniaShannon`
does; constructing a client on viem's chain silently gives you no live reads.
**Cost: Phase 5 — three failed provider wirings before the working one.**

### 7. Scaling conventions differ per tier

`getBinaryOrderBook` (chain tier) returns raw bigint levels
(collateral-scaled, needing `decimals` handling); `fetchOrderBook` (unified)
returns decimal strings. Both are documented individually, but mixing them in
one app (we do — chain fallback + unified fast path) invites unit mistakes.
**Cost: small, Phase 0/5 — double-checked every division by 10^decimals.**

### 8. Fill side attribution needs the doc's footnote

`FillRow.taker`/`takerSide` are denormalized and lag (they're backfilled from
the taker's `OrderPlaced`); `takerOrder.owner` + `takerOrder.side` is the
reliable pair, and `makerSide` covers the resting side. We'd have shipped
wrong side labels without the fills.d.ts commentary. Positive: the comment is
excellent. Negative: it lives only in the `.d.ts`. **Cost: Phase 1 — caught in
review, not in prod.**

### 9. Pre-0.28 tick-grid behavior (secondhand, for completeness)

We pinned 0.29.0 from the start, so we did not directly hit
`parseUnits(price.toFixed(18))` (only 0.25/0.5/0.75 landing on-grid on
18-decimal venues). Including it because the changelog framing — "prices are
raw, snap them" — is the single most important behavioral change for anyone
writing a bot, and it's currently a changelog note rather than a migration
guide entry.

### 10. WebSocket transport errors are loud, which is right — but retry is on you

Transient `WebSocket request failed` / `The request took too long to respond`
from the public RPC surfaced as thrown errors on otherwise-fine reads roughly
once per few minutes during our soak. We wrapped every tick in try/catch with
in-flight guards (and would have needed to anyway), but SDK-level idempotent
retry for reads would spare every bot author the same scaffolding.
**Cost: Phase 2 — the overlap-guard rework after overlapping cycles appeared
in logs.**

## Small things, for completeness

- `agent_state`/DB naming: ours, not yours.
- The `somniaShannon` chain export deserves a doc pointer from every
  "construct a client" example — two of the three docs examples show viem's
  `somniaTestnet`, which has no WS endpoints (see item 6).
- `docs/developers/event-contracts/recipes`' "Redeem after settlement" was
  exactly right, including the losing-side-pays-zero warning. The Phase 3
  redemption gate passed first try because of it.
- `@anthropic-ai`-style defensive-parse docs for the `graphql()` layer: the
  committed schema snapshot in `dist/gql` made query-shape verification easy
  when the site docs were ambiguous — more of that, please.

## Summary

The SDK's core trading loop (grid → place → receipt → balance → redeem) is
solid and the docs' gotchas section is unusually honest. The recurring theme
of our friction: **discovery cost** — behaviors that are correct but
undocumented at the point of decision (receipt placement, expiry defaults,
registry scope, import paths, sort order). Each was verifiable from the
`.d.ts`/source, and we did verify — but every item above cost 30–90 minutes
that a one-line doc note would have saved.
