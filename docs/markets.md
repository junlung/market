# Markets

A market is a question with 2–6 named outcomes that members stake points on. Markets
belong to a league (see `docs/leagues.md`); settlement follows the parimutuel math in
`docs/economy.md`.

## Status machine

`MarketStatus` (`prisma/schema.prisma`):

```
PROPOSED ──approve──▶ DRAFT ──open──▶ OPEN ──close──▶ CLOSED ──resolve──▶ RESOLVED
    │         └─(approve-and-open goes straight to OPEN)
    └──reject──▶ REJECTED
```

- Cancel is reachable from every non-settled state. PROPOSED/DRAFT cancellation is a
  plain status write; a market with stakes cancels through a full-refund settlement so
  every staked point returns via `MARKET_REFUND` ledger entries.
- `RESOLVED` implies `winningOutcomeId != null`. A canceled market is identified by
  status alone — no winning outcome, no resolution outcome value.

Transitions live in `src/lib/server/market-service.ts` and are audit-logged to `AppLog`
(`PROPOSAL_ACTION` / `ADMIN_ACTION`).

## Outcomes

- 2–6 `Outcome` rows, fixed in number and order at creation (`sortOrder` never
  changes). Labels, colors, and emoji are editable until the first bet.
- `Outcome.pool` is the live staked total; `poolFinal` freezes the pool at settlement.
- Outcome colors come from the `--oc-*` token set (`src/lib/outcome-colors.ts`,
  `globals.css`), validated for color-blind-safe adjacency in both themes.

Validation rules (count, label rules, duplicate detection) live in
`src/lib/markets.ts`.

## Where a market lives

- A market with no explicit league belongs to the **Global League** (`seasonId` null —
  Global markets are never season-pinned; standings attribute them by resolution
  month, per `docs/leagues.md`).
- A **custom-league** market requires that league to have an ACTIVE season. The market
  is pinned to that season (`seasonId`), must close before the season ends, and
  inherits the league's `defaultRakeBps` / `defaultMaxStakePerUser` verbatim — there
  are no per-market economy overrides in custom leagues.

## Proposals and authorization

- Any member may propose a market in a league they belong to (status `PROPOSED`).
- Operators approve (to `DRAFT`, or straight to `OPEN`), reject with a reason, edit,
  open, close, resolve, and cancel. **Operator** = league `OWNER`/`MOD`, or an app
  `ADMIN` anywhere (`requireMarketOperator`, `src/lib/server/market-service.ts`).
  Global League members all hold the plain `MEMBER` league role, so Global operations
  are effectively admin-only.
- Editability: PROPOSED/DRAFT markets are fully editable; an OPEN market is editable
  only until its first bet (`firstBetAt`), after which question, outcomes, close time,
  and economy settings are all frozen.

## Bet writes

`placeBet` (`src/lib/server/bet-service.ts`) performs one serializable transaction:

1. Insert the `Bet` row with **post-bet snapshots** `outcomePoolAfter` /
   `totalPoolAfter`. These snapshots make activity feeds O(1) (no replay needed),
   survive user deletion, and let the achievements evaluator reconstruct pre-bet
   implied odds (`preBetImpliedProb`, `src/lib/achievements.ts`).
2. Upsert `PoolStake` — the per-user-per-outcome aggregate (rows exist only where
   amount > 0). Settlement pays from these aggregates.
3. Increment `Outcome.pool` and touch the `Market` row — the row touch is the
   write-write conflict fence that serializes bets against a concurrent resolution.
4. Write the negative `BET_PLACED` ledger entry.

## Settlement

`writeSettlement` (`src/lib/server/market-service.ts`) handles resolve and cancel in
one serializable transaction:

- **Status guards:** resolve accepts OPEN/CLOSED only; cancel accepts anything not
  already RESOLVED/CANCELED. These transitions are the primary re-entry protection —
  a settlement cannot run twice.
- **Trust boundaries:** the winning outcome must belong to the market; per-outcome
  stake sums are cross-checked against outcome pools, and stake rows pointing at
  foreign outcomes abort the settlement.
- Writes: `MARKET_PAYOUT`/`MARKET_REFUND` ledger rows, `poolFinal` freezes, the
  conservation re-check (economy doc), the Global-only rake→gem conversion with its
  own conservation check, and a `MarketResolution` audit row (`winningPool`,
  `losingPool`, `rakeAmount`, `dustAmount`, `totalPaidOut`, `gemsMinted`).
- `previewSettlement` runs the same math as a dry run to power the resolve form;
  `replayProbabilities` rebuilds the odds-over-time chart from bet snapshots.

**Achievements run after the transaction commits**, not inside it — evaluating them
in-transaction would balloon the SERIALIZABLE read set and multiply retry conflicts.
A failed post-commit pass is logged at WARN and repaired by the daily cron, which
re-sweeps the last 48 hours of resolutions (`src/lib/server/achievement-service.ts`).

## Legacy dual-writes

Binary (2-outcome) markets dual-write a set of legacy columns on every write path:
`Market.finalOutcome/yesPool/noPool`, `Bet.side/yesPoolAfter/noPoolAfter`,
`PoolStake.yesStake/noStake`, `MarketResolution.outcome/yesPoolFinal/noPoolFinal`, plus
the `MarketOutcome`/`BetSide` enums. Nothing reads them; they exist so the schema can
roll back one release. Dropping them (and their write sites in `bet-service.ts` /
`market-service.ts`) is tracked in **GitHub issue junlung/market#1**. Until that lands:
keep the dual-writes intact, and never build new features on these columns.

## Reads

`market-service.ts` also owns the read paths: `getDashboardMarkets` (league-scoped,
category tabs + search), `getMarketDetail`, `getActiveStakes` / `getResolvedStakes`
(portfolio and history — these mix all of the viewer's leagues, with each row linking
to its market's canonical URL). Global markets live at `/markets/[id]`; league markets
at `/l/[slug]/markets/[id]` (`marketPath`, `src/lib/leagues.ts`). A market requested
through the wrong route redirects to its canonical URL.
