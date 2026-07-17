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

**Effective close cutoff** (`Market.effectiveCloseAt`, nullable): event markets get a
generous `closeTime` and are closed manually after the event, leaving a sniping window
where the outcome is already known. The close form can backdate the cutoff to the
moment betting *should* have stopped, and the resolve form can set or correct it while
the market is CLOSED (validated `openedAt ≤ effectiveCloseAt ≤ closedAt`). A bet is
void iff `bet.createdAt > effectiveCloseAt`. Voiding executes at settlement, inside the
settlement transaction: void portions are carved out of the parimutuel math
(`docs/economy.md`), refunded as `BET_VOID_REFUND` entries, and removed from the
`PoolStake` rows — so a bettor whose entire position was void has no participation for
standings or achievements, and late bets can't set the longshot probability. The
bettor's position card flags void points before settlement; settlement previews compute
from valid stakes only. Null means no backdating and settlement is identical to a
market without the field.

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

## Categories

`Market.category` is a plain String column constrained at the service layer
(`assertCategoryAllowed` in `market-service.ts`), not in Postgres — remapping stays a
data update, never a migration.

- **Global markets** take a slug from the canonical list in `src/lib/categories.ts`
  (`{ slug, label, emoji, achievementEligible }`). **Misc** is the escape hatch for
  jokes and one-offs — it earns no achievements. Adding a category is a one-line
  change; slugs are effectively permanent once category achievements mint, because
  achievement keys embed them.
- **Custom-league markets** take one of the league's owner-curated labels
  (`League.categories`, edited in league settings — see `docs/leagues.md`). No slugs,
  no achievements.
- Edits may keep a market's existing category even if it's no longer in the list
  (values that predate a list change or the one-time slug remap), but any *change*
  must land on a current option.
- Display goes through `categoryDisplay`/`categoryLabel`: canonical slugs render
  emoji + label, anything else renders as stored. Dashboard tabs still derive from
  whatever open markets exist (`getOpenCategories`).

## Closest-guess markets

`Market.kind` splits the game: `PARIMUTUEL` (the default — everything above and below)
or `CLOSEST_GUESS`, for questions with a date answer ("when is the baby born?"). The
kind is fixed at creation and the two never mix: bets bounce off guess markets, guesses
bounce off parimutuel markets, and each kind has its own settlement path.

- **Entry**: every entrant antes the same `Market.anteAmount` (charged once as a
  `BET_PLACED` ledger entry; pot = entrants × ante) and claims a date. Dates are
  **first-come-first-claimed** per market (`Guess` `[marketId, value]` unique — the
  timeline is a land grab) and one guess per member (`[marketId, userId]`). Guess
  values are calendar dates pinned to **UTC midnight** (stored, compared, and displayed
  as that calendar date regardless of anyone's timezone). Guesses are open (everyone
  sees the board) and **movable until close** for free — the ante stays in the pot. `placeGuess` (`guess-service.ts`) is the money-moving write path and runs
  in `withSerializableRetry`.
- **Settlement** (`resolveClosestGuessMarket` + pure math in `src/lib/closest-guess.ts`):
  the operator enters the actual date; guesses rank by distance (competition ranking —
  ties share a rank and split the consumed podium positions' shares). The pot pays
  **60/25/15** across the podium; with fewer than 3 entrants the unclaimed shares roll
  to 1st. **No rake, no gems** — flooring remainders burn as dust, and
  `totalIn === totalOut + dust` is re-checked at runtime. Each guess freezes its
  `finalRank` and `payout`; the resolution row stores `actualValue` with
  `winningPool = pot`, `losingPool = 0`, `winningOutcomeId` null (guess markets have no
  outcomes — the RESOLVED ⇒ winning-outcome invariant is parimutuel-only).
- **Standings and achievements**: entrants count as participants (ante + payout ledger
  entries drive standings); for achievements, **rank 1 is the win** — podium money
  without first place advances volume and category counts but not win streaks.
  Longshot never applies (no odds). Cancel refunds every ante in full.
- **UI**: the market page swaps odds machinery for the claimed-dates board
  (`GuessMarketView` hosting `GuessTimelineWidget`): a horizontally scrollable
  day timeline where each claim is a flag with the member's avatar, with a list
  view as the second mode. Long empty stretches collapse into tappable gap chips
  (guess dates are unbounded), and a jump-to-date input covers far-away targets —
  it doubles as the accessible fallback alongside the list. While open, tapping a
  free day arms a claim/move confirm bar (claimed days show the owner instead —
  the client pre-blocks taken dates, the `[marketId, value]` unique stays the
  authority); after resolution the same track marks the answer with a vertical
  line, medals the podium flags, and dims the rest. Timeline math lives on
  yyyy-mm-dd date keys via `src/lib/guess-dates.ts` — all rendering pins to UTC.
  The dashboard card shows pot/ante/entrants. On the create form, the game type
  sits collapsed behind a "Game type: Default · change" line (parimutuel is the
  overwhelming default) that expands to illustrated selection cards. Management
  lives on the market page — `/admin/markets/[id]` redirects guess markets there.
  The effective close cutoff (above) is a parimutuel feature; closest-guess markets
  close on `closeTime` or the manual close, with no backdating in v1.

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
- Operators work inline from the market page itself: an operator-only **Manage tab**
  (`src/components/markets/market-detail-view.tsx`, deep-linkable as `?tab=manage`)
  carries proposal review, open/close, resolve and cancel with settlement previews,
  and — while the market is still editable — a collapsible edit form. It appears for
  operators on global and custom-league markets alike. On custom-league markets the
  edit form hides the economy fields (rake and stake cap always come from the
  league's settings); on global markets admins can edit them. The admin dashboard's
  `/admin/markets/[id]` page is a second path to the same actions, with per-user
  stake and settlement detail the public page doesn't show.

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

## Reads

`market-service.ts` also owns the read paths: `getDashboardMarkets` (league-scoped,
category tabs + search), `getMarketDetail`, `getActiveStakes` / `getResolvedStakes`
(portfolio and history — these mix all of the viewer's leagues, with each row linking
to its market's canonical URL). Global markets live at `/markets/[id]`; league markets
at `/l/[slug]/markets/[id]` (`marketPath`, `src/lib/leagues.ts`). A market requested
through the wrong route redirects to its canonical URL.
