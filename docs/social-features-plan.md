# Social Features Plan

**Status: Phase 1 implemented on `social-update`** (2026-07-12; verified locally — unit,
integration, and e2e suites green. Prod rollout = merge + deploy; the migration backfills
usernames automatically). Phase 2 is next. This is a living document — update the
phase checklists and the decisions log as work lands. Decisions below were made with Jon on
2026-07-12; don't silently reverse them, add a dated amendment instead.

## Vision

Three features, built in this order:

1. **Public profiles** — every member gets a page visible to other members, with career stats,
   a bio, and a trophy case. The building block for everything else.
2. **Leagues** — the headline feature. A "Global League" everyone belongs to, with a monthly
   leaderboard reset, plus user-created leagues (a friend group's monthly league, a weekend-trip
   league) with their own markets, members, leaderboards, and point pools. League winners earn
   trophies that live on their profile.
3. **Cosmetics** — an avatar-decoration system (frames, titles, badges, backgrounds) fed by a
   persistent meta-currency ("gems") earned from market rake and achievements, spendable in a
   small store. Explicitly *not* a layered paper-doll avatar system in v1.

Why this order: profiles are cheap and everything else hangs off them; leagues are the retention
mechanic (the fantasy-football model) and they *generate* the trophies; cosmetics are only
desirable once there's status to signal, and their cost is mostly content/art, not code.

## Decisions log (2026-07-12)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Profile visibility | **Members-only.** Profiles live inside the authed `(app)` group; middleware keeps gating everything. Public/indexable profiles are a possible later opt-in, not now. Members bet on real-life friend events — public betting history is a privacy footgun. |
| 2 | Profile URLs | **Unique `username` slug** (`/u/[username]`), separate from the mutable display name. Backfilled from display names for existing members. |
| 3 | Global League resets | **Leaderboard wipes monthly; markets and currency persist.** A "Season" in the Global League is a leaderboard window, not an economy reset. No monthly grants, long-horizon markets just work, and new users still start each month at 0 profit like everyone else. |
| 4 | Custom leagues | **Fresh stack per season.** A custom league grants each member the same starting balance per season. The weekend-trip case is just a league with a single short season. Unified via a per-league balance policy: `PERSISTENT` (Global) vs `FRESH_PER_SEASON` (custom default). |
| 5 | Cosmetics currency | **Separate persistent meta-currency ("gems"), never resets, never buys bets.** Earned two ways: (a) market rake converts to gems distributed pro-rata to that market's winners at settlement (rake still exits the points economy — the sink is preserved); (b) achievement grants (season placements, first win, streaks, longshot wins). Trophies are never purchasable; keep some items achievement-only so the store doesn't just mirror the leaderboard. |
| 6 | Monthly leaderboard attribution | **Realized P&L attributed to the month the market resolves**: your July score = Σ(payout − your total stake on that market) across markets resolved in July. Naive ledger-window sums would distort both months when a bet and its payout straddle a boundary; open positions never hurt your rank. |

## Architecture direction

**Make League a first-class entity and migrate today's global app into being the Global League.**
Markets, leaderboards, allowances, and the propose/approve flow all become league-scoped; the
global experience is the default league every member auto-joins. Leagues are not a bolted-on
parallel system.

Key facts about the current codebase that shape this (as of `c5b1969`):

- Balance = `SUM(LedgerEntry.amount)` — append-only ledger, no denormalized balance
  (`src/lib/server/market-service.ts:getUserBalance`). Leaderboard is computed on the fly as
  net profit (`getLeaderboard`).
- Multi-outcome markets are fully merged into main (2–6 `Outcome` rows, parimutuel settlement in
  `src/lib/parimutuel.ts`, SERIALIZABLE tx w/ retry in `src/lib/server/tx.ts`). Legacy binary
  columns are dual-written and awaiting a contract release.
- Weekly allowance is granted lazily on nav render, idempotent via unique
  `[userId, allowanceWeek]` (`src/lib/server/allowance-service.ts`). No cron exists anywhere.
- Auth is NextAuth v4 credentials + JWT (no DB session). `middleware.ts` gates every app route.
  Roles are a global `ADMIN|MEMBER` enum — per-league roles are new ground.
- No file/image storage anywhere; avatars are generated from a name hash
  (`src/components/ui/avatar.tsx`). Cosmetics v1 deliberately keeps it that way (CSS/SVG/emoji
  decoration around the generated avatar — no upload pipeline).

---

## Phase 1 — Profiles, usernames, inventory scaffolding

Goal: `/u/[username]` member-visible profile + the `Item`/`UserItem` tables that Phases 2–3
write into. Nothing here gets thrown away later.

### Schema (one migration)

- `User.username` — `String @unique`, lowercase slug, 3–20 chars `[a-z0-9-]`, no leading/trailing
  hyphen. Migration backfills from `name` (slugify + numeric suffix on collision) then sets
  NOT NULL + unique.
- `User.bio` — `String?`, capped at 280 chars in validation.
- `Item` — `slug` (unique), `name`, `description`, `kind` (`TROPHY | BADGE | TITLE | FRAME |
  BACKGROUND`), `style Json` (kind-specific rendering params — no image storage), `storeCost Int?`
  (null = not purchasable), `active Boolean`.
- `UserItem` — `userId`, `itemId`, `source` (`SEASON_TROPHY | ACHIEVEMENT | PURCHASE |
  ADMIN_GRANT`), `provenance Json?` (e.g. `{ league, season, placement }`), `equippedSlot`
  (nullable enum, one per slot enforced in the service tx — Prisma can't express partial
  uniques), `grantedAt`.

### Work items

- [x] Schema + migration + username backfill
      (`prisma/migrations/20260712000000_social_profiles_items`)
- [x] Validation: `usernameValueSchema` (slug rules + reserved words in `src/lib/username.ts`),
      `bioSchema`
- [x] `member-service`: `updateUsername` / `updateBio` / `getSelfProfile`; signup collects
      username; JWT carries username with a lazy DB backfill for pre-existing tokens
      (`src/lib/auth.ts`)
- [x] `src/lib/server/profile-service.ts`: profile lookup by username + career stats from the
      ledger (net profit, markets won/played, win rate, biggest payout) + recent resolved
      positions. Computed on request; no denormalized stats table until it's actually slow.
- [x] `src/lib/server/item-service.ts`: `grantItem` (idempotent via unique `grantKey` — season
      cron re-runs can't double-grant), `listUserItems` (equip comes in Phase 3)
- [x] `/u/[username]` page in `(app)`: identity header, stat cards, trophy case
      (`src/components/members/trophy-case.tsx`), recent results; `/u/:path*` added to the
      middleware matcher
- [x] Account page: username + bio forms next to the display-name form, "View your profile" link
- [x] Link-up pass via `src/components/members/profile-link.tsx`: leaderboard (podium + table),
      comments, activity feed, market positions, and a "Your profile" user-menu item
- [x] Tests: unit (username rules + slug suggestion), integration (career stats from a real
      settlement, at-risk handling, grantKey idempotency), e2e (leaderboard → profile,
      bio round-trip)

Deliberately deferred: equip UI, the store, image uploads, unauthenticated access.

---

## Phase 2 — Leagues and seasons

Split into two releases: **2a** proves the season/reset/trophy loop on the Global League with
zero new permission surface; **2b** adds user-created leagues.

### Data model sketch

- `League` — name, slug, description, `ownerId`, join policy (`INVITE_CODE | APPROVAL`),
  balance policy (`PERSISTENT | FRESH_PER_SEASON`), settings (starting stack, weekly allowance
  on/off, default rake, who may create markets), `isGlobal` flag (exactly one).
- `LeagueMembership` — leagueId, userId, role (`OWNER | MOD | MEMBER`), joinedAt. Unique
  `[leagueId, userId]`. League owners/mods open and resolve markets in their league; app admins
  keep the Global League. This replaces global-admin gating *for league operations only*.
- `Season` — leagueId, name/index, startsAt, endsAt, status (`UPCOMING | ACTIVE | FINALIZED`).
  Global League: monthly, auto-rolled. Custom: one-shot or recurring per league settings.
- `Market.leagueId` (+ `seasonId` for fresh-stack leagues), backfilled to the Global League.
- `LedgerEntry.leagueId` (+ `seasonId` where the balance policy needs it), backfilled likewise.
  Balance queries become league-scoped; Global League balances are unaffected by seasons.

### Mechanics

- **Global League monthly leaderboard** (decision #6): rank by Σ(payouts − stakes) over markets
  *resolved* within the season window. Computable from `LedgerEntry` + `MarketResolution`
  timestamps; no new bookkeeping.
- **Custom league leaderboard**: same query; with fresh stacks it equals portfolio − grants
  within the season, so one implementation serves both.
- **Season finalization** — the project's first Vercel cron (`vercel.ts` + a route handler):
  close the season, freeze standings, grant trophy `Item`s (writes `UserItem` rows with
  provenance, source `SEASON_TROPHY`), grant placement gems (Phase 3 hook), open the next
  season. Idempotent, like the allowance pattern. Lazy-on-render is not good enough here because
  finalization has side effects that shouldn't wait for a page load.
- **Market lifecycle in custom leagues**: reuse the propose/approve flow scoped to the league
  (members propose, owner/mods approve/resolve). Resolution guardrail: resolutions land in the
  league activity feed with actor + source, and a short dispute window before payout finalizes.
  No voting/oracle machinery in v1 — commissioners are trusted, like fantasy sports.
- **Allowances**: per-league setting; idempotency key becomes `[userId, leagueId, allowanceWeek]`.
- Weekend-trip case: a league with one short season, `FRESH_PER_SEASON`, done.

### Open questions (decide at Phase 2 kickoff)

- Do custom-league markets need a stake-cap/rake override range, or inherit league settings only? A: Inherit league settings
- Can a market move leagues before its first bet? (Probably no — create it in the right league.) A: No!
- League discovery: browse/join public leagues, or invite-only always? A: Always invite-only
- Navigation: league switcher in the top nav vs. league-scoped routes (`/l/[slug]/...`).
  Leaning route-scoped — it matches the app's server-component style and makes links shareable.

---

## Phase 3 — Cosmetics v1, gems, store

Prereq: at least one Global League season has finalized, so trophies exist in the wild.

- **Rendering**: decorate the existing generated avatar — frames (border/glow), backgrounds,
  titles (shown under the name), badges (inline flair next to names on leaderboards/comments).
  All CSS/SVG/emoji driven by `Item.style` Json. No uploads, no sprite sheets.
- **Gems ledger**: `GemLedgerEntry` mirroring the points ledger (append-only, typed:
  `RAKE_CONVERSION | ACHIEVEMENT | SEASON_PLACEMENT | STORE_PURCHASE`). Balance = SUM. Never
  interacts with the points economy.
- **Rake conversion** (decision #5): at settlement, `writeSettlement` distributes the market's
  rake as gems pro-rata to winners. Points-rake is still burned from the points economy — the
  inflation sink stays intact.
- **Achievements**: a small checker that runs post-settlement / post-season (first win, N-market
  streak, longshot win at <X% implied odds, season placements). Each grants gems and/or items,
  idempotent per (user, achievement).
- **Store**: list `active` items with `storeCost`, buy in a tx (gem balance check → ledger debit
  → `UserItem` grant, source `PURCHASE`). Equip UI on the account page; equipped state renders
  wherever the link-up pass from Phase 1 put profile links.
- **Watch**: pro-rata rake means big bettors accumulate gems fastest — keep desirable items
  achievement-only so the store doesn't just mirror the leaderboard.

---

## Later / explicitly out of scope for now

- Truly public (unauthenticated) profiles as an opt-in
- Layered paper-doll avatars (real art pipeline) — only if cosmetics v1 lands well
- Email notifications (nothing in the stack sends email today)
- Long-horizon "all-time" vs seasonal market scopes for custom leagues (Global handles this via
  decision #3 already)
