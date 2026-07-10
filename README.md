# ProllyMarket

ProllyMarket is an invite-only prediction league for a private friend group. It uses in-app points only. There are no payments, no withdrawals, no transfers for value — bragging rights only.

This is v2: the LMSR market maker from v1 is gone, replaced by a **parimutuel pool economy** designed for a small player pool, with a Polymarket-inspired interface.

## How the economy works

**Parimutuel pools.** Every market is a binary YES/NO question. You stake points on a side; all stakes go into the pools. At resolution, winners get their stake back plus a pro-rata share of the losing pool. The implied probability shown everywhere is simply `yesPool / (yesPool + noPool)`.

**Strictly zero-sum by construction.** Betting can never create points. Every point a winner receives came from a loser's stake. This is what makes the system abuse-proof at small scale — there is no market maker to farm, no subsidy to mint against.

**The faucet and the sink.**
- *Faucet:* everyone gets a starting grant (500) and a weekly allowance (100), auto-credited the first time you use the app each ISO week. Missed weeks are not back-paid.
- *Sink:* 5% of each losing pool is burned at resolution (plus integer-rounding dust). Winners never receive less than their stake back — the rake only comes out of losers' money.

The two roughly cancel for an active group, so the total points supply stays stable instead of inflating forever.

**Rules that keep it fair:**
- Stakes are add-only: you can top up either side while a market is open, but never withdraw.
- Per-user stake cap per market (default 500, admin-adjustable per market) — no whale owns every pot.
- Betting both sides is allowed but strictly unprofitable (the rake guarantees it).
- If nobody backed the winning side, everyone is refunded (no rake). Canceled markets refund all stakes.
- Final payout odds lock at close — displayed odds are live estimates.

**Engineering guarantees:**
- Conservation invariant per market: `stakes in = payouts out + rake + dust`, re-checked at runtime inside the settlement transaction before anything is written, and property-tested across thousands of randomized markets.
- Balances are derived solely from an immutable ledger (no balance column). Burned points are recorded on the resolution row, so the whole economy is auditable: `Σ balances + Σ live pools + Σ burned = Σ points ever issued`.
- Bets run in Serializable transactions with retry — concurrent double-spends are impossible, enforced by Postgres, not application luck.
- Weekly allowance idempotency is a database unique constraint (one grant per user per ISO week), race-safe by construction.

## Product scope

- Binary YES/NO markets; members propose, admins review/approve/open (admins can also create directly)
- Market lifecycle: proposed → draft → open → closed → resolved (or rejected/canceled)
- Odds-over-time chart on every market (from per-bet pool snapshots), activity feed, and comment threads
- Dashboard with category tabs and search, portfolio, bet history, leaderboard (net profit), balance breakdown
- **Approval-gated membership**: anyone can sign up, but accounts are pending until an admin approves them from `/admin/members` (approval grants the starting balance — junk signups never hold points). Members vouch for friends in the queue from `/invite`.
- Immutable ledger, full admin audit trail
- Light + dark theme (system-aware)

## Stack

- Next.js App Router + TypeScript + Tailwind CSS v4
- Prisma with Postgres
- NextAuth credentials auth with admin-approved signup
- Vitest (unit + integration), Playwright (smoke)

## Architecture

- [`src/lib/parimutuel.ts`](src/lib/parimutuel.ts): pure settlement math — odds, rake, payouts, conservation checks
- [`src/lib/allowance.ts`](src/lib/allowance.ts): ISO-week keys for allowance idempotency
- [`src/lib/server/bet-service.ts`](src/lib/server/bet-service.ts): bet placement (Serializable transaction, balance + cap rechecks)
- [`src/lib/server/market-service.ts`](src/lib/server/market-service.ts): lifecycle, settlement, proposals, reads
- [`src/lib/server/allowance-service.ts`](src/lib/server/allowance-service.ts): lazy weekly allowance accrual
- [`src/lib/server/tx.ts`](src/lib/server/tx.ts): Serializable-with-retry transaction wrapper
- [`prisma/schema.prisma`](prisma/schema.prisma): users, invites, markets, bets, pool stakes, ledger, resolutions, comments, logs
- [`src/app/actions/`](src/app/actions): server actions (markets, bets, proposals, comments, signup)

## Local setup

1. Create a local Postgres database named `prollymarket_v2`.
2. Copy `.env.example` to `.env`.
3. `npm install`
4. `npm run db:migrate`
5. `npm run db:seed`
6. `npm run dev`

Seeded accounts (password `password123` unless `SEED_DEFAULT_PASSWORD` is set): `admin@prollymarket.local` plus members `alex@`, `blair@`, `casey@`, `dana@prollymarket.local`, and a pending signup `dave@prollymarket.local` to demo the approval queue.

**Local-only:** the seed refuses to run in anything that looks like production (`NODE_ENV`/`VERCEL_ENV` production, or a hosted `DATABASE_URL`) unless `FORCE_SEED_DEMO_ACCOUNTS=1` is set, and the demo-credentials helper on the sign-in page renders only under `next dev`. Deployed instances get neither the accounts nor any mention of them.

## Deployment (Vercel + Neon)

1. Create a fresh Postgres database (e.g. a new Neon project or branch — don't reuse the v1 database; the schema is incompatible).
2. Push this repo to GitHub and connect it to the Vercel project (Settings → Git). Vercel picks up the `vercel-build` script, which runs `prisma migrate deploy` before `next build`, so schema migrations apply automatically on every deploy.
3. Set Vercel environment variables: `DATABASE_URL` (the new database), `NEXTAUTH_URL` (the production URL), and `NEXTAUTH_SECRET` (fresh random string, e.g. `openssl rand -base64 32`). The economy variables are optional — the defaults in code apply.
4. Bootstrap the first admin (fresh DBs have no admin to approve signups): sign up in the deployed app, then run locally
   `DATABASE_URL="<prod url>" npm run create-admin -- you@example.com`
   Everyone after that joins through the normal approval queue.

Do **not** run `npm run db:seed` against production — it refuses by design (demo accounts are local-only).

## Tests

- `npm test` — unit tests, including property-based conservation fuzzing of the settlement math
- `npm run test:integration` — race/concurrency tests against a real Postgres (set `TEST_DATABASE_URL` to a throwaway database; its schema is pushed automatically)
- `npm run test:e2e` — Playwright smoke tests (expects the dev server + seeded DB)
- `npm run lint` / `npm run build`
