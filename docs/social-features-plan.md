# Social Features Plan

**Status: Phases 1–2b merged to main; Phases 3a and 3b (gems, cosmetics, store, admin item
authoring) implemented on `gems-cosmetics`** (2026-07-12; unit, integration, and e2e suites
green; build green. Prod rollout = merge + deploy + run `npm run backfill-gems` against prod
once). Remaining roadmap items live under "Later" (avatar upload phase, the 3D trophy
prototype — see the Phase 3 plan appendix). This is a living document — update the phase
checklists and the decisions log as work lands. Decisions below were made with Jon on
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
  A: Route-scoped for custom leagues; Global keeps its routes (see 2b kickoff decisions).

### Phase 2a — shipped (2026-07-12, branch `leagues`)

Scope: the season/reset/trophy loop on the Global League, zero new permission surface.

- [x] Schema + migration (`prisma/migrations/20260712120000_leagues_seasons`): `League`
      (partial unique index enforces exactly one `isGlobal`), `LeagueMembership`, `Season`;
      `Market.leagueId` and `LedgerEntry.leagueId` added NOT NULL and backfilled to the Global
      League; every existing user enrolled. `seasonId` columns deferred to 2b (only
      fresh-stack leagues need them).
- [x] `src/lib/leagues.ts`: UTC month window/name helpers + shared competition ranking
- [x] `src/lib/server/league-service.ts`: `ensureGlobalLeague` (self-healing bootstrap for
      fresh DBs — tests/`db push` never see the migration's insert), `ensureLeagueMembership`
      (granted at account approval, like the starting balance)
- [x] `src/lib/server/season-service.ts`: `ensureCurrentSeason` (lazy-on-read like the weekly
      allowance — opening a season has no side effects, so it needn't wait for the cron;
      race-safe via unique `[leagueId, startsAt]`), `getSeasonStandings` (decision #6 query),
      `finalizeDueSeasons` (trophies before the status flip so a mid-run crash re-runs
      idempotently; the flip is a guarded `updateMany` so concurrent runs can't double-claim)
- [x] Every ledger/market write path stamps `leagueId` (bets, settlement, allowance, initial
      grants, seed, create-admin script)
- [x] First Vercel cron: `vercel.ts` (`@vercel/config`) schedules
      `/api/cron/finalize-seasons` daily 00:05 UTC; route rejects anything without
      `Authorization: Bearer CRON_SECRET`. Daily because the handler is idempotent — 364 runs
      no-op, the month-boundary one finalizes + rolls.
- [x] Leaderboard page: tabbed — current season (default; podium, W/settled record, past-season
      champions strip from frozen standings) and the original all-time board
- [x] Trophy case renders season provenance ("July 2026 · Global League")
- [x] Tests: unit (month windows, ranking), integration (bootstrap + season-open races,
      decision #6 attribution incl. cross-month bets, open/canceled/out-of-window exclusion,
      finalization freezes standings + grants exactly once + rolls), e2e suite still green

Amendments / small decisions made while building (2026-07-12):

- **Season window = UTC calendar month**, same determinism rationale as the allowance week key.
- **Standings rank participants only** (≥1 market *settled* in the window). Ranking every
  ACTIVE user would let zero-activity members outrank a net-negative participant, which reads
  wrong next to trophies. The page still lists non-participants, unranked, so the full roster
  stays visible (and new members see themselves at 0 — decision #3's spirit).
- **Trophies**: three reusable `Item` defs (`season-champion/-runner-up/-third`), granted to
  competition ranks 1–3 among participants, `grantKey = season:{seasonId}:user:{userId}`,
  provenance carries league/season/placement/score. Ties grant duplicates at the tied rank and
  skip the next (1,1,3). A season with zero participants finalizes with no trophies.
- **Frozen standings** live as Json on `Season` (display/audit only — live standings are always
  recomputed from the ledger).
- **Balance reads stay league-unscoped in 2a** — all data belongs to the one league, so
  scoping reads is observable-noop plumbing; it lands with 2b when a second economy exists.

### Phase 2b — kickoff decisions (2026-07-12, with Jon)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Navigation | **Custom leagues at `/l/[slug]/...`** (markets, leaderboard, members, settings); the Global League keeps `/dashboard`, `/markets`, `/leaderboard` etc. unchanged — zero URL churn, no redirects. A "My leagues" nav menu lists your custom leagues. |
| 2 | League settings | **Four typed columns**, set at creation, editable until the first season starts: `startingStack`, `weeklyAllowance` (0 = off), `defaultRakeBps`, `defaultMaxStakePerUser`. Markets inherit them (no per-market overrides in custom leagues, per the earlier answer). |
| 3 | Invites | **One rotating join code per league.** Owner/mods regenerate to revoke; no expiry, no per-invite tracking. "Join a league" page takes the code. |
| 4 | Resolutions | **Instant payout in custom leagues too** — commissioners are trusted, fantasy-style. *Dated amendment to the 2026-07-12 "short dispute window" guardrail: deferred, not built in v1.* Resolutions still land in the league feed with actor + source; the window ships later only if it's actually needed. |
| 5 | Seasons | **Owner-set start/end dates, manual roll.** The cron finalizes ended custom seasons (freeze standings, grant trophies) but never auto-opens the next; the owner starts the next season explicitly, which grants the fresh stacks (`FRESH_PER_SEASON`). One-shot leagues simply never start another. |

### Phase 2b — work items (shipped 2026-07-12, branch `leagues`)

- [x] Schema (`20260712130000_season_stack_enum` + `20260712130100_league_settings_seasons`):
      League settings columns + `inviteCode` (unique, rotatable); `Market.seasonId` +
      `LedgerEntry.seasonId`; `SEASON_STACK` ledger type with a partial unique
      [userId, seasonId] (enum add and its first index use must be separate migrations —
      Postgres won't reference a same-transaction enum value)
- [x] League-scoped balances: `getLeagueBalance(userId, {leagueId, balancePolicy, seasonId})` —
      PERSISTENT sums the league, FRESH_PER_SEASON sums only the season (no active season reads
      as 0, never a stale stack). Every unqualified read (dashboard, account, portfolio,
      history, leaderboard, profiles, admin) now explicitly scopes to the Global League;
      `placeBet` checks the market's league scope and requires league membership — Global
      points can't buy custom-league bets or vice versa
- [x] League CRUD: create (slug from name, OWNER membership, generated code), join-by-code
      (mid-season joiners get their stack immediately, once), rotate code (owner/mod; old code
      dies), settings (owner; economy locks once the first season starts), MOD/MEMBER role
      toggle (owner). Leave-league deferred — nobody's asked to leave a friend league yet
- [x] Season lifecycle: owner/mod creates one season at a time (week/month/weekend presets,
      future start = UPCOMING, activated by the cron with stacks); fresh stacks idempotent per
      [userId, seasonId]; the cron finalizes ended custom seasons but never auto-opens the next
- [x] Market lifecycle: members propose, owner/mods approve/open/close/resolve/cancel via
      `requireMarketOperator` (app admins pass everywhere — the deployment safety valve;
      in the Global League the rule reduces to exactly the old admin-only gate). Custom markets
      require an active season, must close inside it, inherit league rake/cap verbatim
- [x] League allowance: [userId, leagueId, allowanceWeek] key, honors the league's
      weeklyAllowance (0 = off), fresh-stack allowances follow the ACTIVE season
- [x] Routes: `/leagues` (mine/create/join) + `/l/[slug]` overview/markets/markets/new/
      leaderboard/settings; market detail is one shared view with a canonical URL per market
      (global markets redirect off league routes and vice versa) and an inline manage panel
      for operators; "Leagues" in top nav + user menu; middleware matcher extended
- [x] Trophies: same season-trophy items; custom finalization grants them with league
      provenance ("Season 1 · Tahoe Trip")
- [x] Tests: 9 new integration tests (stack isolation both directions, members-only betting,
      code rotation, one-stack-per-joiner, operator gating, league-week allowance, settings
      lock, wait-for-unsettled finalization with by-season attribution, market/season guards);
      e2e create → season → invite-code join; all suites + build green

Amendments while building (2026-07-12):

- **Custom standings attribute by `market.seasonId`, not the resolution window** — a
  commissioner resolving the weekend's last market on Monday would otherwise drop it from the
  standings. Global keeps decision #6's resolution-month attribution (its markets aren't
  season-pinned by design — decision #3).
- **Custom seasons don't finalize while OPEN/CLOSED markets remain** — standings would be
  incomplete. The cron just retries daily; the owner sees the unsettled markets in a
  "needs your action" list.
- **Profile career stats stay Global-League-scoped.** Mixing fresh-stack P&L into career
  numbers would distort them; league performance lives on league pages and in trophy
  provenance.
- **Betting is members-only everywhere** (including Global — memberships are backfilled and
  granted at approval), otherwise a non-member could stake into a stack they were never dealt.
- `prisma/partial-indexes.sql` holds the SQL-only partial uniques for `db push` environments
  (integration tests apply it after the push; real deploys get them from migrations).
- **League markets surface on the main views** (follow-up, same day): the dashboard shows a
  section per joined league (same search/category filters, cards link into the league);
  portfolio and bet history include league positions with a league chip and canonical
  `/l/[slug]` links. Safe because those are the viewer's own stakes/bets — market *discovery*
  for non-members still doesn't exist anywhere. The activity feed stays Global-only; league
  feeds live on the league overview.

---

## Phase 3 — Cosmetics v1, gems, store

### Phase 3 kickoff decisions (2026-07-12, with Jon)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Gem sources | **Global League only** mints gems (rake conversion, placement gems, achievements). Custom leagues grant trophies but never gems — owner-set stacks make them a farming vector. |
| 2 | Conversion | **1 gem per 1 rake point**, pro-rata to winners by winning stake, floored; remainder ("gem dust") dropped. Points-rake still burns — the sink is untouched. |
| 3 | Backfill | **Full backfill** at launch: historical rake (replayed from persisted `PoolStake`s), past placements (frozen standings), achievement history. Idempotent, same keys as live paths. |
| 4 | Achievements v1 | First win; streaks 3/5/10 (consecutive Global wins by resolution order); longshot win (<10% pre-bet implied); volume 10/50/100 settled Global markets. |
| 5 | BACKGROUND slot | **Profile header banner** (not avatar fill) — future backdrop for the avatar-character / 3D scene. *Dated amendment to the original "decorate the avatar" framing.* |
| 6 | Render scope | **Everywhere**: frames + badges at every avatar/name surface; titles on profile header + podium only; banner on profile only. |
| 7 | Avatar upload | **Architect only** — `MemberAvatar` wraps a swappable avatar node; upload ships as its own later phase (amends the original "no uploads ever" stance: uploads are wanted, just not in v1). |
| 8 | 3D | **Schema-ready only**: `renderer` discriminant in `Item.style` (`css`/`emoji`/`model3d`), reserved mounts in the trophy case + profile banner. Prototype plan lives in the Phase 3 plan appendix. |
| 9 | Admin UI (3b) | Structured per-kind style editor with live preview + raw-Json escape hatch (server-revalidated) + admin grant tool + price/active management. |
| 10 | Gem display | Row in the nav balance dropdown (violet `--gem` token, distinct from amber points), store page, account page. |
| 11 | Tuning | Constants in `src/lib/achievements.ts`: placements 100/50/25; achievements 10–150; store prices 75–300. Retune there. |
| 12 | Store | One-per-user purchases (partial unique); some items achievement-only so the store doesn't just mirror the leaderboard. |

### Phase 3a — shipped (2026-07-12, branch `gems-cosmetics`)

- [x] Schema (`20260712150000_gems_cosmetics`): `GemLedgerEntry` (typed, signed, append-only;
      balance = SUM; provenance anchors marketId/seasonId/achievementKey/itemId),
      `MarketResolution.gemsMinted`, four partial uniques (rake per [user, market], placement
      per [user, season], purchase per [user, item], one equipped item per [user, slot]) —
      mirrored in `prisma/partial-indexes.sql`
- [x] `src/lib/gems.ts`: `computeRakeGemSplit` (floor pro-rata + conservation check, parimutuel
      style) + breakdown helpers; `PayoutRow.winningStake` added to `parimutuel.ts`
- [x] Rake→gems inside the `writeSettlement` tx (Global + NORMAL + rake > 0 only; cancel/refund
      no-op; status guard prevents re-entry, the partial unique is a backstop)
- [x] Achievements: `src/lib/achievements.ts` (pure evaluator + the tuning constants) +
      `achievement-service` (one-query history incl. pre-bet implied odds from bet snapshots;
      idempotent grants; badge items for streak-5/10, longshot, volume-100 — never purchasable).
      Trigger = post-commit in `resolveMarket` (in-tx would balloon the SERIALIZABLE read set),
      logged WARN on failure; daily cron re-sweeps the last 48h of resolutions as the safety net
- [x] Placement gems (100/50/25) granted beside trophies in `finalizeDueSeasons`, Global only,
      idempotent per [user, season]; ties share the tied rank's amount
- [x] `gem-service` (balance/breakdown/ledger/adjust) + `store-service.purchaseItem`
      (SERIALIZABLE: ownership check → SUM balance check → grant + debit atomically)
- [x] Cosmetics: `src/lib/cosmetics.ts` (zod schemas per kind, `renderer` discriminant,
      hex-locked colors, `parseItemStyle` never throws — junk renders as nothing; legacy trophy
      `{emoji}` upgraded in place); `item-service` equip tx + `getEquippedCosmetics(userIds[])`
      batch (one call per page, parsed server-side) + locker/catalog reads +
      `ensureStarterCatalog` (10 items, upsert-by-slug, also seeded)
- [x] Renderers (`cosmetic-renderers.tsx`: AvatarFrame with absolute-positioned ring = zero
      layout shift in xs rows, BadgeGlyph, TitleLine, ProfileBanner with `data-scene-mount`) +
      `MemberAvatar` (the swappable avatar-node seam) + `MemberName`; rolled out to profile,
      leaderboard (podium titles), market detail (positions/comments/activity), activity feed,
      league overview/leaderboard/settings/layout, admin members, user menu. Trophy case
      rewritten on `parseItemStyle`; `model3d` items render a placeholder tile with a
      `data-model-mount` div. Invite page + pending/rejected admin rows stay plain (pending
      users can't own cosmetics)
- [x] UI: account Locker (`equip-panel.tsx`, live self-preview) + gems card with breakdown;
      `/store` (grouped catalog, previews on the viewer's own identity, Buy/Owned/insufficient
      states; middleware matcher + `PROTECTED_PREFIXES` extended); nav balance dropdown gems row
      (`--gem` violet token; chip face stays points-only; the chip is now always a dropdown);
      user-menu Store link + framed avatar; `actions/items.ts` (equip/unequip/purchase)
- [x] Backfill: `src/lib/server/backfill-gems.ts` + `npm run backfill-gems` — replays
      settlements from persisted stakes with a rake/winningPool cross-check (mismatch = skip +
      log, never guess), grants past placements from frozen standings, evaluates achievement
      history; wholly re-runnable (verified: re-run = 0 new grants)
- [x] Tests: unit (gem split fuzz vs settlements, achievement evaluator boundaries, style
      parsing + CSS-injection rejection), 10 new integration tests (mint/no-mint paths,
      achievement hooks + idempotency, placement gems incl. custom-league-none, store
      concurrency, equip slot exclusivity, backfill), e2e (nav gems row, buy → equip → badge
      visible on leaderboard); all suites + build green

Amendments while building (2026-07-12):

- **Achievement badge grants ride the resolve hook**, so integration assertions about "gems from
  this market" scope by `type` — rake and achievement entries can share a marketId.
- **`getEquippedCosmetics` filters `item.active`** — retiring an item un-renders it everywhere
  without touching equip state.
- **Balance chip is always a dropdown now** (gems make the menu non-degenerate even with zero
  custom leagues).
- **Demo gems** (500, `ADMIN_ADJUST`) seeded for the demo members so the store works out of the
  box and in e2e.
- **Achievement discovery** (follow-up, same day — Jon: achievements need a browsable surface):
  profile gets an Achievements section showing up to `SHOWCASE_LIMIT` (3) highlights the member
  picks (star toggles on their own `/u/[username]/achievements` page; falls back to most
  recently earned; `User.showcasedAchievements`, migration
  `20260712160000_achievement_showcase`, earned-only + cap validated in
  `setShowcasedAchievements`). The full-list page shows all defs — earned lit with date + gem
  reward, unearned dimmed with a lock. Each def gained a display `emoji`.

### Phase 3b — shipped (2026-07-12, branch `gems-cosmetics`)

- [x] `/admin/items` list (all items incl. inactive, owner counts, kind/price/status columns)
- [x] `/admin/items/new` + `/admin/items/[itemId]`: structured per-kind style editor compiling
      to the `src/lib/cosmetics.ts` schemas, live preview via the shared renderers (sample
      identity at lg and xs, plus a trophy-case tile for trophies), raw-Json escape hatch with
      inline validation that round-trips back into the structured fields; server actions
      re-validate with `parseItemStyle` so unrenderable style can never persist. Slug and kind
      are immutable after creation (kind changes would orphan equipped slots)
- [x] Grant tool on the item detail page (ACTIVE member select, `ADMIN_GRANT`, no grantKey)
- [x] Validation schemas (`itemSlugSchema`, `itemFormSchema`, `grantItemAdminSchema`), admin
      hub link, e2e (admin creates frame → grants to Alex → Alex equips it from the locker)

- **Watch**: pro-rata rake means big bettors accumulate gems fastest — keep desirable items
  achievement-only so the store doesn't just mirror the leaderboard (starter catalog keeps
  `title-oracle` unpurchasable as the precedent).

---

## Later / explicitly out of scope for now

- **Avatar image upload** (its own small phase — wanted, amended 2026-07-12): Vercel Blob,
  square crop, size cap. The renderers already wrap a swappable avatar node (`MemberAvatar`'s
  `avatarNode` prop), so uploads slot in without touching frames/banners.
- **Low-poly 3D trophies** (PS1-style, WebGL): schema is ready (`renderer: "model3d"` +
  reserved mounts in the trophy case and profile banner). The actionable prototype plan —
  Blockbench asset, react-three-fiber viewer, dynamic import with the placeholder tile as
  fallback — lives in the Phase 3 implementation plan appendix.
- Eventually: the customizable avatar CHARACTER (the banner becomes its scene backdrop).
- Truly public (unauthenticated) profiles as an opt-in
- Email notifications (nothing in the stack sends email today)
- Long-horizon "all-time" vs seasonal market scopes for custom leagues (Global handles this via
  decision #3 already)
