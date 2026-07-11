#!/bin/sh
# Runs the integration suite against a dedicated throwaway Postgres database.
# Refuses to run without TEST_DATABASE_URL so it can never touch the dev DB.
set -e

if [ -z "$TEST_DATABASE_URL" ]; then
  echo "Set TEST_DATABASE_URL to a throwaway database (see .env.example)." >&2
  exit 1
fi

# both URLs: the app connects via DATABASE_URL, the CLI (db push) via directUrl
export DATABASE_URL="$TEST_DATABASE_URL"
export DATABASE_URL_UNPOOLED="$TEST_DATABASE_URL"
export INTEGRATION_TESTS=1

# plain push (no --force-reset): the DB is a dedicated throwaway and the
# test suite truncates all tables itself before each test
npx prisma db push --skip-generate >/dev/null
npx vitest run --config vitest.integration.config.ts
