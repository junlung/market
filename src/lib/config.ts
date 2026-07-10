function readIntEnv(key: string, fallback: number, options: { allowZero?: boolean } = {}) {
  const raw = process.env[key];

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  const min = options.allowZero ? 0 : 1;
  return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
}

export const appConfig = {
  startingBalance: readIntEnv("STARTING_BALANCE", 500),
  weeklyAllowance: readIntEnv("WEEKLY_ALLOWANCE", 100),
  rakeBps: readIntEnv("RAKE_BPS", 500, { allowZero: true }),
  defaultMaxStakePerUser: readIntEnv("DEFAULT_MAX_STAKE_PER_USER", 500),
  maxBetAmount: readIntEnv("MAX_BET_AMOUNT", 250),
  betRateLimitWindowMs: readIntEnv("BET_RATE_LIMIT_WINDOW_MS", 10_000),
  betRateLimitMaxRequests: readIntEnv("BET_RATE_LIMIT_MAX_REQUESTS", 5),
  closeWarningHours: 24,
};
