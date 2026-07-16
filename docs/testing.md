# Testing

Three suites, three configs. All must be green (plus `npm run build`) before a change
ships.

## Unit — `npm test`

Vitest over `src/**/*.test.ts` (they live in `src/lib/__tests__/`), node environment,
no database (`vitest.config.ts`). The pure domain logic lives here: parimutuel
settlement (including property-based conservation fuzzing across randomized markets),
ledger breakdown math, allowance week keys, username rules, gem splits, achievement
evaluation, cosmetic style parsing (including CSS-injection rejection).

`npm run test:watch` for the watch loop.

## Integration — `npm run test:integration`

Real-Postgres tests for everything the unit suite can't prove: transaction isolation,
race behavior, and DB-enforced idempotency. Driven by `scripts/integration-tests.sh`:

- **Refuses to run without `TEST_DATABASE_URL`** — it can never touch the dev database.
  Point it at a throwaway local database.
- Sets both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to the test URL, sets
  `INTEGRATION_TESTS=1`, runs `prisma db push --skip-generate`, then **applies
  `prisma/partial-indexes.sql`** — `db push` does not create the SQL-only partial
  uniques, and the idempotency tests depend on them.
- `vitest.integration.config.ts` picks up `src/**/*.int-test.ts`
  (in `src/lib/server/__tests__/`): economy (bets/settlement/allowance races), gems
  (mint paths, store concurrency, backfill), leagues (stack isolation, operator
  gating, finalization), profile (career stats).
- `fileParallelism: false` and 30s timeouts: suites share one database and truncate
  tables themselves.

## E2E — `npm run test:e2e`

Playwright (`tests/e2e/`, `playwright.config.ts`), baseURL `127.0.0.1:3000`. Starts
`npm run dev` itself unless `PLAYWRIGHT_SKIP_WEBSERVER` is set, and expects a seeded
database (`npm run db:seed`) for the demo accounts it signs in with.

## Conventions

- Integration tests own their data: truncate at test start, no `--force-reset`.
- The bet rate limiter honors a `skipRateLimit` option (`src/lib/rate-limit.ts`) so
  seeds and tests can place rapid bets; production code paths never set it.
- Anything inside `withSerializableRetry` may re-run — tests that assert on side
  effects count rows rather than spying on call counts.
