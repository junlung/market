# ProllyMarket (repo: gamba)

Members-only parimutuel prediction league for a private friend group. In-app points
only — no payments, no transfers, bragging rights only. ~15 real users in production.
This file is the map; each area's full truth lives in docs/ (table below).

## Stack and topology

- Next.js App Router + TypeScript + Tailwind v4; Prisma on Neon Postgres; NextAuth v4
  credentials (JWT sessions); deployed on Vercel (project `prollymarket`).
- A push to `main` deploys prod, and the build runs `prisma migrate deploy` — **every
  push migrates the production database.**
- One cron: `/api/cron/finalize-seasons`, daily 00:05 UTC, gated by a `CRON_SECRET`
  bearer token (`vercel.ts`).
- Structure: `src/lib/` pure domain logic → `src/lib/server/` DB-touching services →
  `src/app/actions/` server actions → `src/app/(app)/` authed routes. `src/middleware.ts`
  gates every app route (it must live in `src/` — a root-level middleware.ts is
  silently ignored when the app directory is under `src/`).

## Load-bearing invariants

1. **No balance columns.** Points = `SUM(LedgerEntry.amount)`, gems =
   `SUM(GemLedgerEntry.amount)`; both ledgers are append-only. Balances are
   league-scoped (`getLeagueBalance`); fresh-stack leagues scope by season, and a
   league with no active season reads 0.
2. **Four write paths run in `withSerializableRetry`** (`src/lib/server/tx.ts`): bet,
   settlement/cancel, store purchase, cosmetic equip. The wrapper also retries unique
   violations (P2002), so wrapped code must tolerate full re-runs.
3. **Conservation is re-checked at runtime** inside the settlement transaction
   (`totalIn = totalOut + rake + dust`, and `gemsMinted + gemDust = rake`) before
   anything is written. Never bypass these checks.
4. **Idempotency is DB-enforced, never app-checked:** allowance
   `[userId, leagueId, allowanceWeek]`; season stacks `[userId, seasonId]`; item
   grants via `grantKey`; gem grants via partial uniques; league invites
   `[leagueId, userId] WHERE status = 'PENDING'`. Partial uniques live in
   migrations AND `prisma/partial-indexes.sql` — new ones must land in both.
5. **Enum rule:** adding a Postgres enum value and first using it must be separate
   migrations (Postgres can't reference a same-transaction enum value).
6. **Legacy dual-writes:** binary markets dual-write legacy columns
   (`yesPool`/`noPool`/`side`/…) on every write path. Nothing reads them. Keep the
   writes intact and build nothing on them — removal is GitHub issue
   junlung/market#1.
7. **Gems mint from Global League activity only** (rake conversion 1:1 floored
   pro-rata, achievements, placements). Custom leagues never mint gems. All gem
   tuning constants live in `src/lib/achievements.ts`.
8. **Seasons:** Global = UTC calendar months, opened lazily, rolled by the cron;
   custom = owner-set windows, one at a time, finalized by the cron but never
   auto-reopened.
9. **Standings rank participants only** (ACTIVE users with ≥1 settled market).
   Global attributes P&L by resolution month; custom leagues by the market's pinned
   season.
10. **Value is granted at account approval, not signup** — starting balance, Global
    League membership, starting gems. Pending/rejected accounts hold nothing.

## Danger zone

- The prod database holds real member data. Read-only queries only; never `db:seed`
  or `db push` against prod. The old Neon project's `neondb` database is the v1
  archive — never touch it. Prod access recipe: `docs/ops.md`.

## Docs map

| Doc | Covers |
|---|---|
| `docs/economy.md` | Ledgers, balances, parimutuel math, rake, faucet/sink, gems |
| `docs/markets.md` | Market lifecycle, outcomes, proposals, bets, settlement |
| `docs/leagues.md` | Global vs custom leagues, seasons, standings, trophies, cron |
| `docs/members.md` | Auth, approval, profiles, cosmetics, store, achievements |
| `docs/ops.md` | Local dev, prod access, deploys, cron, admin scripts |
| `docs/testing.md` | Unit / integration / e2e suites and their rules |

Work tracking: GitHub issues on `junlung/market` + the board at
`github.com/users/junlung/projects/1`. Plans and TODOs belong there, not in docs/.

## Standing rule for docs and comments

When a change alters behavior, an invariant, the schema, or an ops procedure, update
the affected `docs/*.md` (and this file, if an invariant moved) **in the same commit**.
Keep everything in the docs register: self-contained (no references to plans,
conversations, or external context — a reader with only this repo must be able to
follow) and present-tense (describe what the system does and why the constraint
exists, never the history of how it changed).
