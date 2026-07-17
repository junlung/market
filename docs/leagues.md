# Leagues and seasons

Everything competitive is league-scoped: markets, balances, allowances, leaderboards,
and the propose/approve flow. There are two kinds of league, unified by one data model
(`League`, `LeagueMembership`, `Season` in `prisma/schema.prisma`).

## The Global League

Exactly one league has `isGlobal = true`, enforced by a partial unique index. It is the
default competitive surface: every member auto-joins at account approval, its markets
live at the app's root routes (`/markets`, `/leaderboard`, `/dashboard`), and its
economy follows the app-level config (`appConfig`), not the league settings columns.

`ensureGlobalLeague` (`src/lib/server/league-service.ts`) creates the row on first
touch — fresh databases and test environments bootstrap themselves; the lookup is
race-safe via the unique slug and is never cached at module level.

- **Balance policy `PERSISTENT`:** balances accumulate forever; seasons are leaderboard
  windows, not economy resets.
- **Seasons are UTC calendar months** (`getMonthWindow`, `src/lib/leagues.ts` —
  `endsAt` exclusive; named like "July 2026"). The current season opens lazily on
  first read (`ensureCurrentSeason`, race-safe via unique `[leagueId, startsAt]`), and
  the cron finalizes an ended month and rolls the next one automatically.

## Custom leagues

Any member can create one. Custom leagues are invite-only and route-scoped under
`/l/[slug]/…` (overview, markets, leaderboard, settings).

- **Balance policy `FRESH_PER_SEASON`:** every member gets the same starting stack per
  season (`SEASON_STACK` ledger entry, idempotent per `[userId, seasonId]` partial
  unique). Mid-season joiners get the current season's stack immediately, once.
- **Economy settings** (`startingStack`, `weeklyAllowance`, `defaultRakeBps`,
  `defaultMaxStakePerUser`) are set at creation, editable until the first season
  starts, then locked for the league's lifetime.
- **Market categories** (`League.categories`): an owner-curated label list (1–12
  entries, seeded as `["General"]` at creation) that the league's market form offers
  and `market-service` enforces. Unlike the economy settings it stays editable —
  markets keep the string they were created with, so removing a label never touches
  existing markets. The Global League ignores this column; its categories are the
  canonical code list (`docs/markets.md`).
- **Joining — three paths, all the joiner's choice** (there is no direct-add and no
  league browser):
  1. **Code form:** type the league's rotating 8-character code on `/leagues`
     (ambiguity-free alphabet; helpers in `src/lib/leagues.ts`).
  2. **Share link:** `/join/[code]` renders a signed-in confirmation page for the same
     code (never auto-joins). Signed-out visitors round-trip through sign-in and land
     back on the confirmation (`callbackUrl`, sanitized same-origin-only in
     `safeCallbackUrl`, `src/lib/routes.ts`). Rotating the code kills the old code and
     every link carrying it; dead links get a friendly notice, not a 404.
  3. **In-app invite:** owners/mods invite an approved member from league settings
     (`LeagueInvite` row, `createLeagueInvite` — the single write point in-app
     notifications will hook). The invitee accepts or declines from `/leagues`.
     Accepting runs the same membership + stack path as a code join. Declining is
     silent — the invite just leaves the league's pending list, and a fresh invite can
     be sent later (at most one PENDING per invitee per league via the
     `LeagueInvite_pending_key` partial unique; declined rows are kept). Revoking a
     pending invite deletes it outright; the role check runs at revoke time.
- All three paths converge on `ensureLeagueMembership` + `grantSeasonStack`, so
  double-clicks, races between paths, and re-joins can't duplicate memberships or
  stacks.
- **Roles:** `OWNER` / `MOD` / `MEMBER` per league. Owners promote/demote mods; owners
  and mods operate markets and seasons. App admins pass every league-role check
  (`requireLeagueRole`) — the operational safety valve.
- **Seasons are owner-set windows**, one ACTIVE or UPCOMING at a time. Presets cover
  week/month/weekend shapes; a future start creates an UPCOMING season the cron
  activates (granting stacks). Ended seasons finalize automatically, but **the next
  season never auto-opens** — the owner starts it explicitly. A one-shot league (a
  weekend trip) is simply a league whose single season is never followed by another.

Points never cross leagues: bets require membership in the market's league, and every
balance check scopes to that league (and season where fresh stacks apply). A dormant
custom league — no ACTIVE season — reads a 0 balance for everyone.

- **Deletion** (`deleteLeague`, owner-only with the usual app-admin bypass): erases the
  league and everything scoped to it — ledger entries and markets are deleted
  explicitly inside one transaction (their league FKs are `Restrict`), then the league
  row cascades memberships, invites, and seasons. Refused for the Global League and
  while a season is ACTIVE ("finish it first" beats a rage-delete); the settings-page
  danger zone requires typing the exact league name, re-checked server-side. Season
  trophies survive deletion — they're `UserItem` rows carrying provenance strings, not
  league FKs. The deletion lands in the audit trail via `logLeagueAction` (the app log
  keeps the league's name and slug after the row is gone).

## Standings

`getSeasonStandings` (`src/lib/server/season-service.ts`) computes standings on the fly
from the ledger; nothing is denormalized while a season runs.

- **Score** = Σ(`BET_PLACED` + `MARKET_PAYOUT` + `MARKET_REFUND`) per user over RESOLVED
  markets — realized P&L. Open positions never move a rank; canceled markets net to 0.
- **Attribution differs by league kind.** Global seasons count markets **resolved
  within the month window** (`resolvedAt`) — Global markets aren't season-pinned, and
  a bet and its payout straddling a month boundary land in the resolution month.
  Custom seasons count markets **pinned to the season** (`market.seasonId`) — a
  commissioner settling the weekend's last market on Monday still counts it.
- **Ranked = participants only:** ACTIVE users with ≥ 1 settled market in the window.
  Non-participants still appear, unranked at score 0, so the full roster stays
  visible. Ranking uses competition style — ties share a rank and skip the next
  (1, 1, 3; `rankByScore`, `src/lib/leagues.ts`).

## Finalization

`finalizeDueSeasons` (`src/lib/server/season-service.ts`) runs from the daily cron and
is idempotent end to end:

1. **Custom seasons wait for their markets:** a season with OPEN/CLOSED season-pinned
   markets is skipped (standings would be incomplete) and retried the next day; the
   owner sees the unsettled markets in a needs-action list. Global seasons never wait —
   a late resolution simply counts toward the next month.
2. **Trophies before the status flip:** placement items are granted first, so a
   mid-run crash re-runs cleanly. Trophy grants are idempotent via
   `grantKey = season:{seasonId}:user:{userId}`.
3. Season top-3 receive the three reusable trophy items (`season-champion`,
   `season-runner-up`, `season-third`) with provenance (league, season, placement,
   score) rendered in the profile trophy case. Ties grant duplicate trophies at the
   tied rank. **Global seasons also grant placement gems** (100/50/25, idempotent per
   `[userId, seasonId]`); custom seasons grant trophies only — custom activity never
   mints gems (`docs/economy.md`).
4. **The flip is a guarded `updateMany`** (`WHERE status = ACTIVE`), so concurrent
   cron runs cannot double-finalize. Final standings freeze as JSON on the `Season`
   row for display and audit; live standings are always recomputed from the ledger.

## The cron

`vercel.ts` schedules `GET /api/cron/finalize-seasons` daily at 00:05 UTC. The route
rejects any request without `Authorization: Bearer ${CRON_SECRET}` (and every request
when the secret is unset). Daily scheduling works because the handler is idempotent:
on ~364 days it no-ops; at a month boundary it finalizes Global, activates due UPCOMING
custom seasons, finalizes ended custom seasons, and runs the 48-hour achievement
catch-up sweep (`docs/markets.md`).
