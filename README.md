# ProllyMarket

ProllyMarket is an invite-only prediction league for a private friend group. It uses
in-app points only — no payments, no withdrawals, no transfers for value. Bragging
rights only.

## How it works

Markets are questions with 2–6 outcomes. Members stake points into parimutuel pools;
at resolution, winners split the losing pool pro-rata (minus a 5% rake that's burned —
the economy's sink). Everyone gets a starting balance and a weekly allowance (the
faucet). Members compete in a global monthly leaderboard season and in private leagues
with their own markets, seasons, and fresh point stacks. Season winners earn trophies;
Global League activity earns gems, spendable on profile cosmetics in the store.

Betting is strictly zero-sum: every point a winner receives came from a loser's stake.
Balances derive from an immutable ledger, settlements are conservation-checked at
runtime, and money-moving writes run in serializable transactions — the full guarantees
live in the docs below.

## Stack

Next.js App Router + TypeScript + Tailwind CSS v4 · Prisma + Postgres · NextAuth
credentials with admin-approved signup · Vitest + Playwright.

## Local setup

1. Create a local Postgres database named `prollymarket_v2`.
2. Copy `.env.example` to `.env`.
3. `npm install`
4. `npm run db:migrate`
5. `npm run db:seed`
6. `npm run dev`

Seeded accounts (password `password123` unless `SEED_DEFAULT_PASSWORD` is set):
`admin@prollymarket.local` plus members `alex@`, `blair@`, `casey@`,
`dana@prollymarket.local`, and a pending signup `dave@prollymarket.local` to demo the
approval queue. The seed refuses to run against production, and the demo-credentials
helper renders only under `next dev`.

## Tests

`npm test` (unit) · `npm run test:integration` (real Postgres; set
`TEST_DATABASE_URL`) · `npm run test:e2e` (Playwright) · `npm run lint` /
`npm run build`. Details: [docs/testing.md](docs/testing.md).

## Docs

| Doc | Covers |
|---|---|
| [docs/economy.md](docs/economy.md) | Ledgers, balances, parimutuel math, rake, gems |
| [docs/markets.md](docs/markets.md) | Market lifecycle, outcomes, proposals, bets, settlement |
| [docs/leagues.md](docs/leagues.md) | Global vs custom leagues, seasons, standings, trophies |
| [docs/members.md](docs/members.md) | Auth, approval, profiles, cosmetics, store, achievements |
| [docs/ops.md](docs/ops.md) | Local dev, prod access, deploys, cron, admin scripts |
| [docs/testing.md](docs/testing.md) | Unit / integration / e2e suites and their rules |
