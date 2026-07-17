# Ops runbook

## Local development

1. Create a local Postgres database `prollymarket_v2` and copy `.env.example` → `.env`.
2. `npm install` (postinstall runs `prisma generate`), `npm run db:migrate`,
   `npm run db:seed`, `npm run dev`.

Seeded accounts (password `password123` unless `SEED_DEFAULT_PASSWORD` is set):
`admin@prollymarket.local`, members `alex@` / `blair@` / `casey@` / `dana@`, and a
pending `dave@prollymarket.local` for the approval queue. The seed refuses to run
against anything that looks like production (`NODE_ENV`/`VERCEL_ENV` production, or a
hosted `DATABASE_URL`) unless `FORCE_SEED_DEMO_ACCOUNTS=1`; the sign-in page's
demo-credentials helper renders only under `next dev`.

## Environment contract

`src/env.ts` validates env at boot. Required: `DATABASE_URL`, `NEXTAUTH_SECRET`.
Optional: `NEXTAUTH_URL`, `CRON_SECRET` (min 16 chars), and the economy knobs with code
defaults (`STARTING_BALANCE`, `WEEKLY_ALLOWANCE`, `RAKE_BPS`,
`DEFAULT_MAX_STAKE_PER_USER`, `MAX_BET_AMOUNT`, bet rate-limit settings).
`DATABASE_URL_UNPOOLED` is the migration path (`directUrl` in
`prisma/schema.prisma`) — the Neon integration provides it in prod; locally it equals
`DATABASE_URL`. `.env.example` documents everything, including `TEST_DATABASE_URL`
(integration tests only).

## Production topology

*The facts in this section describe live infrastructure and are not discoverable from
the repo — verify against the Vercel/Neon dashboards before assuming they've changed,
and keep this section current when they do.*

- **Vercel project `prollymarket`** under the **junlung** account (GitHub repo
  `junlung/market`). Production aliases: `prollymarket.faith`, `www.prollymarket.faith`,
  `prollymarket.vercel.app`.
- **Database: Neon Postgres**, connected through the Vercel Neon integration (pooled
  `DATABASE_URL`, unpooled variant for migrations). Real member data lives here.
- **The old Neon project's `neondb` database is the v1 archive. Never connect to it,
  migrate it, or seed it** — v1's schema is incompatible and the archive is
  reference-only.
- GitHub work tracking: issues on `junlung/market`, board at
  `github.com/users/junlung/projects/1` (columns Now / Next / Later / Ideas; labels
  `bug` / `feature` / `infra`).

## Prod access

Pull prod env into a scratch file (never commit it):

```sh
npx vercel env pull /tmp/prod.env --environment=production
```

Read-only inspection via psql (strip quotes from the pulled value):

```sh
DBURL=$(grep '^DATABASE_URL=' /tmp/prod.env | cut -d= -f2- | tr -d '"')
psql "$DBURL" -c "<read-only SQL>"
```

**Prod queries are read-only unless a change is deliberately being shipped.** Never run
`db:seed`, `prisma db push`, or ad-hoc UPDATE/DELETE against prod. Canned audit queries,
each grounded in an invariant from `docs/economy.md`:

```sql
-- Balances (Global League): one row per user. The isGlobal filter matters —
-- an unfiltered SUM mixes Global points with custom-league season stacks and
-- matches no real balance. Add "AND u.username = '...'" for a single user.
-- (Custom-league balances additionally scope to the active season; see
-- docs/economy.md before querying those.)
SELECT u.username, SUM(l.amount) AS balance
FROM "LedgerEntry" l
JOIN "User" u ON u.id = l."userId"
JOIN "League" lg ON lg.id = l."leagueId"
WHERE lg."isGlobal" = true
GROUP BY u.username ORDER BY balance DESC;

-- Settlement conservation: every row must show in = out + rake + dust
SELECT "marketId", "winningPool" + "losingPool" AS total_in,
       "totalPaidOut" + "rakeAmount" + "dustAmount" AS accounted
FROM "MarketResolution"
WHERE "winningPool" + "losingPool" <> "totalPaidOut" + "rakeAmount" + "dustAmount";

-- Gem wallets and mint/burn breakdown
SELECT type, COUNT(*), SUM(amount) FROM "GemLedgerEntry" GROUP BY type;

-- Applied migrations
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;
```

## Deploys and migrations

- A push to `main` deploys production. The build runs `vercel-build` =
  `prisma migrate deploy && next build` — **every deploy applies pending migrations to
  the prod database** (over the unpooled URL). There is no separate migration step, and
  no un-deployed way to hold a migration back.
- **Enum rule:** a migration that adds a Postgres enum value and a migration that first
  uses it must be **separate files** — Postgres cannot reference an enum value added in
  the same transaction. Precedents:
  `prisma/migrations/20260712130000_season_stack_enum` → `…130100_league_settings_seasons`
  and `20260712170000_gem_starting_grant_enum` → `…170100_gem_starting_grant_index`.
- **Partial uniques live in two places:** real deploys get them from migrations, but
  `prisma db push` environments (integration tests) apply `prisma/partial-indexes.sql`
  separately. Any new partial unique must land in **both**, or idempotency guarantees
  silently vanish in tests.

## Cron

`vercel.ts` (typed config via `@vercel/config`) schedules the single cron:
`GET /api/cron/finalize-seasons`, daily at 00:05 UTC. It requires
`Authorization: Bearer ${CRON_SECRET}` (Vercel sends this automatically when
`CRON_SECRET` is set in the project env). The handler is idempotent — season
finalization, custom-season activation, and the achievement sweep all no-op when
there's nothing due (`docs/leagues.md`).

## Admin scripts

Run against prod by prefixing the pulled URL:
`DATABASE_URL="<prod url>" npm run <script> -- <args>`

- `create-admin -- email@example.com` — promotes an existing account to ADMIN and
  repairs missing grants (INITIAL_GRANT, Global League membership). This is the
  bootstrap path for a fresh database, since approvals need an admin to exist.
- `reset-password -- email@example.com <new-password>` — direct password reset
  (≥ 8 chars). There is no email infrastructure, so this is the only recovery path.
- `backfill-gems` — replays every historical settlement, season placement, starting
  grant, and achievement into the gem ledger. Wholly re-runnable: each grant is
  idempotent, and each settlement is replay-verified against its persisted stakes
  before converting (mismatches are skipped and logged, never guessed).
- `remap-categories` — one-time Global League remap of free-text categories to
  canonical slugs, followed by a full achievement re-evaluation (the 48h cron sweep
  never reaches old markets). Dry-run by default and prints the exact grants and gem
  totals — **this mints gems retroactively; sanity-check the totals** — then re-run
  with `-- --execute`. Author the old→canonical `MAPPING` in
  `src/lib/server/remap-categories.ts` against prod's actual values first; unmapped
  values fall to Wildcard. Re-runnable: canonical values are left alone and grants are
  idempotent.
