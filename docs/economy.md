# Economy

ProllyMarket runs two currencies. **Points** are the betting currency: league-scoped,
zero-sum by construction, spent on market stakes. **Gems** are a persistent meta-currency:
one global wallet per user, earned from Global League activity, spent in the cosmetics
store. Neither is ever purchasable for money, and gems never buy bets.

## Points: the ledger

There is no balance column anywhere. A user's balance is `SUM(LedgerEntry.amount)` over an
append-only ledger — computed on read, never denormalized. Entry types
(`prisma/schema.prisma`):

| Type | Sign | Meaning |
|---|---|---|
| `INITIAL_GRANT` | + | Starting balance, granted once at account approval |
| `WEEKLY_ALLOWANCE` | + | Weekly faucet (see below) |
| `SEASON_STACK` | + | Per-season starting stack in fresh-stack leagues |
| `BET_PLACED` | − | Stake leaving the balance |
| `MARKET_PAYOUT` | + | Winnings (stake + share of the losing pool) |
| `MARKET_REFUND` | + | Stake returned by a canceled or all-refund settlement |

Every entry carries `leagueId` (and `seasonId` where the league's balance policy needs
it). Balance reads are always league-scoped through `getLeagueBalance` / `balanceWhere`
(`src/lib/server/league-service.ts`):

- `PERSISTENT` (the Global League): sum every entry in the league.
- `FRESH_PER_SEASON` (custom leagues): sum only the active season's entries. With no
  active season the query matches nothing and the balance reads 0 — a dormant league
  holds no spendable points, never a stale stack.

`src/lib/ledger.ts` builds the user-facing balance breakdown and reconciles it against
the raw sum; the two must always agree.

**Auditability:** rake and dust are recorded on `MarketResolution` rows rather than in
any user's ledger, so the whole economy checks out as
`Σ balances + Σ open-market pools + Σ burned = Σ points ever granted`.

## Faucet and sink

- **Faucet:** `INITIAL_GRANT` (default 500) at approval, plus a weekly allowance
  (default 100) credited lazily the first time the user loads the app each ISO week.
  The week key is a UTC `YYYY-Wnn` string (`src/lib/allowance.ts`); missed weeks are
  never back-paid, and the grant is idempotent via the unique
  `[userId, leagueId, allowanceWeek]` (`src/lib/server/allowance-service.ts`).
  Custom leagues set their own `weeklyAllowance` (0 disables it); their allowances
  require league membership and an ACTIVE season and are stamped with the season.
- **Sink:** rake — `floor(losingPool × rakeBps / 10000)` (default 500 bps = 5%) taken
  from the losing pool at settlement — plus integer-rounding dust. Winners always get
  at least their stake back; rake only ever comes out of losers' money.

Defaults live in `src/lib/config.ts` (`appConfig`) and are env-tunable
(`STARTING_BALANCE`, `WEEKLY_ALLOWANCE`, `RAKE_BPS`, `DEFAULT_MAX_STAKE_PER_USER`,
`MAX_BET_AMOUNT`, bet rate-limit knobs), validated in `src/env.ts`. Custom leagues
snapshot their own economy settings on the `League` row (`startingStack`,
`weeklyAllowance`, `defaultRakeBps`, `defaultMaxStakePerUser`); these lock once the
league's first season starts.

## Parimutuel math

All settlement math is pure and lives in `src/lib/parimutuel.ts`:

- **Odds** shown anywhere = `outcomePool / totalPool`; an empty market shows a uniform
  `1/N` prior across its N outcomes.
- **Settlement** groups all of a user's stakes per market into one payout row. A winner
  receives `winningStake + floor(winningStake × (losingPool − rake) / winningPool)`.
- **Refund-all:** if the winning outcome has no backers but other outcomes hold stakes,
  every staker is refunded in full and no rake is taken. A market with no stakes at all
  settles empty.
- **Conservation:** `totalIn === totalOut + rake + dust`, checked by
  `checkConservation` in the pure math **and re-checked at runtime inside the
  settlement transaction** before any row is written
  (`writeSettlement`, `src/lib/server/market-service.ts`). Unit tests fuzz this
  property across thousands of randomized markets. Never bypass either check.

## Concurrency

Balance checks are `SUM(...)` predicates, which row locks cannot guard. Every write that
moves money or claims a uniquely-held slot therefore runs in
`withSerializableRetry` (`src/lib/server/tx.ts`): a SERIALIZABLE transaction retried up
to 3 times with jitter. Four paths use it — **bet placement, settlement (resolve and
cancel), store purchase, and cosmetic equip**.

The wrapper retries unique-constraint violations (Prisma `P2002`) as well as
serialization failures (`P2034`, SQLSTATE 40001/40P01), so races on upserts and partial
uniques collapse into clean re-runs. Consequence: **any code inside the wrapper must
tolerate being re-run from the top** — no external side effects, no accumulating state.

## Bet constraints

Bets pass through three layers:

1. **Input validation** (`betSchema`, `src/lib/validation.ts`, applied by the server
   action): stake is an integer ≥ 1 and ≤ `maxBetAmount`.
2. **Pre-transaction checks** in `placeBet` (`src/lib/server/bet-service.ts`): a
   per-user-per-market rate limit (in-memory fixed-window counter,
   `src/lib/rate-limit.ts`; `skipRateLimit` exists for seed/test code only).
3. **Inside the serializable transaction:**
   - Market must be OPEN and before `closeTime`.
   - The bettor must be a member of the market's league; the balance check runs
     against that league's scope (and season, for fresh-stack leagues). Points never
     cross leagues.
   - Per-market exposure cap: total stake per user ≤ the market's `maxStakePerUser`
     (frozen on the market row at creation).

Stakes are add-only — you can top up any outcome while a market is open, but never
withdraw.

## Gems

`GemLedgerEntry` mirrors the points design: append-only, balance = SUM, one global
wallet per user (no league scoping). Each entry type carries exactly one provenance
anchor (`marketId`, `seasonId`, `achievementKey`, or `itemId`):

| Type | Sign | Source |
|---|---|---|
| `STARTING_GRANT` | + | One-time 1000-gem allowance at approval; idempotent per user via partial unique |
| `RAKE_CONVERSION` | + | Market rake converted at settlement (below) |
| `ACHIEVEMENT` | + | Achievement grants (`src/lib/achievements.ts`) |
| `SEASON_PLACEMENT` | + | Season top-3: 100 / 50 / 25 gems |
| `ADMIN_ADJUST` | ± | Manual admin adjustment |
| `STORE_PURCHASE` | − | Store spend |

**Gems mint from Global League activity only.** Custom leagues grant trophies but never
gems — league owners set their own stacks, so custom-league activity minting a
persistent currency would be farmable. The rake conversion runs inside `writeSettlement`
for Global, NORMAL-resolution, rake > 0 markets only: 1 gem per rake point, split
pro-rata across that market's winners by winning stake, floored
(`computeRakeGemSplit`, `src/lib/gems.ts`). The floor remainder ("gem dust") is dropped;
`gemsMinted + gemDust === rakeAmount` is checked before writing, and `gemsMinted` is
recorded on the `MarketResolution` row. Points-rake is still burned — conversion mints
gems, it does not refund points.

Re-entry protection for the conversion is the market status transition itself (only an
OPEN/CLOSED market can resolve); the partial unique on `(userId, marketId)` for
`RAKE_CONVERSION` rows is a backstop, not the primary guard.

**Every gem-tuning constant lives in `src/lib/achievements.ts`**: `GEM_STARTING_GRANT`
(1000), `SEASON_PLACEMENT_GEMS` ([100, 50, 25]), and each achievement's gem amount.
Retune the economy there. Store prices live on `Item.storeCost` (managed in the admin
item editor; `null` = not purchasable).

Gem balances, breakdowns, and admin adjustments go through
`src/lib/server/gem-service.ts`; store purchases through
`src/lib/server/store-service.ts` (see `docs/members.md`).

**Adding a gem source** touches more than the grant path: `src/lib/gems.ts` categorizes
every entry type for the user-facing breakdown (its switch is exhaustive, so a new enum
value is a compile error until handled), the account page renders that breakdown, and
`src/lib/server/backfill-gems.ts` is the retroactive-grant path for existing users.
Grant functions follow the catch-P2002 idempotency pattern in `gem-service.ts`.
