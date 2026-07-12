import { LedgerEntryType, UserRole, UserStatus } from "@prisma/client";
import { hash } from "bcryptjs";
import { getIsoWeekKey } from "../src/lib/allowance";
import { appConfig } from "../src/lib/config";
import { BINARY_PRESET } from "../src/lib/outcome-colors";
import { prisma } from "../src/lib/prisma";
import { placeBet } from "../src/lib/server/bet-service";
import { createComment } from "../src/lib/server/comment-service";
import {
  cancelMarket,
  closeMarket,
  createMarket,
  proposeMarket,
  resolveMarket,
} from "../src/lib/server/market-service";

const DAY = 24 * 60 * 60 * 1000;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * DAY);
}

async function seedUsers(defaultPassword: string) {
  const passwordHash = await hash(defaultPassword, 12);
  const users = [
    { email: "admin@prollymarket.local", name: "League Admin", username: "league-admin", role: UserRole.ADMIN },
    { email: "alex@prollymarket.local", name: "Alex", username: "alex", role: UserRole.MEMBER },
    { email: "blair@prollymarket.local", name: "Blair", username: "blair", role: UserRole.MEMBER },
    { email: "casey@prollymarket.local", name: "Casey", username: "casey", role: UserRole.MEMBER },
    { email: "dana@prollymarket.local", name: "Dana", username: "dana", role: UserRole.MEMBER },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, passwordHash, status: UserStatus.ACTIVE },
      create: {
        email: user.email,
        name: user.name,
        username: user.username,
        role: user.role,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });
  }

  const persisted = await prisma.user.findMany({
    where: { email: { in: users.map((user) => user.email) } },
  });

  const lastWeekKey = getIsoWeekKey(new Date(Date.now() - 7 * DAY));

  for (const user of persisted) {
    const existingGrant = await prisma.ledgerEntry.findFirst({
      where: { userId: user.id, type: LedgerEntryType.INITIAL_GRANT },
    });

    if (!existingGrant) {
      await prisma.ledgerEntry.create({
        data: {
          userId: user.id,
          type: LedgerEntryType.INITIAL_GRANT,
          amount: appConfig.startingBalance,
          description: "Starting balance",
        },
      });
    }

    // one backdated allowance per member so the ledger type shows up in demos
    if (user.role === UserRole.MEMBER) {
      await prisma.ledgerEntry.upsert({
        where: { userId_allowanceWeek: { userId: user.id, allowanceWeek: lastWeekKey } },
        update: {},
        create: {
          userId: user.id,
          type: LedgerEntryType.WEEKLY_ALLOWANCE,
          amount: appConfig.weeklyAllowance,
          allowanceWeek: lastWeekKey,
          description: `Weekly allowance ${lastWeekKey}`,
          createdAt: new Date(Date.now() - 7 * DAY),
        },
      });
    }
  }

  const byEmail = new Map(persisted.map((user) => [user.email, user]));

  // one pending signup with a vouch, so the approval queue has a demo entry
  const casey = byEmail.get("casey@prollymarket.local")!;
  await prisma.user.upsert({
    where: { email: "dave@prollymarket.local" },
    update: {},
    create: {
      email: "dave@prollymarket.local",
      name: "Dave",
      username: "dave",
      passwordHash,
      status: UserStatus.PENDING,
      vouchedById: casey.id,
      vouchNote: "Marathon Dave — he's good for it.",
    },
  });
  return {
    admin: byEmail.get("admin@prollymarket.local")!,
    alex: byEmail.get("alex@prollymarket.local")!,
    blair: byEmail.get("blair@prollymarket.local")!,
    casey: byEmail.get("casey@prollymarket.local")!,
    dana: byEmail.get("dana@prollymarket.local")!,
  };
}

/** outcome is the sortOrder index into the market's outcomes. */
type SeedBet = { userId: string; outcome: number; amount: number; daysAgo: number };

async function placeSeedBets(marketId: string, bets: SeedBet[]) {
  const outcomes = await prisma.outcome.findMany({
    where: { marketId },
    orderBy: { sortOrder: "asc" },
  });

  for (const bet of bets) {
    const result = await placeBet({
      userId: bet.userId,
      marketId,
      outcomeId: outcomes[bet.outcome].id,
      amount: bet.amount,
      skipRateLimit: true,
    });

    // backdate for a realistic odds-history chart
    const when = new Date(Date.now() - bet.daysAgo * DAY);
    await prisma.bet.update({ where: { id: result.betId }, data: { createdAt: when } });
    await prisma.ledgerEntry.updateMany({ where: { betId: result.betId }, data: { createdAt: when } });
  }
}

async function backdateMarket(marketId: string, daysAgo: number) {
  const when = new Date(Date.now() - daysAgo * DAY);
  await prisma.market.update({
    where: { id: marketId },
    data: { createdAt: when, openedAt: when, firstBetAt: when },
  });
}

async function winningOutcomeId(marketId: string, sortOrder: number) {
  const outcome = await prisma.outcome.findUniqueOrThrow({
    where: { marketId_sortOrder: { marketId, sortOrder } },
  });
  return outcome.id;
}

async function seedMarkets(users: Awaited<ReturnType<typeof seedUsers>>) {
  const existing = await prisma.market.count();
  if (existing > 0) {
    console.log("Markets already exist, skipping market seed. Run `prisma migrate reset` for a clean slate.");
    return;
  }

  const { admin, alex, blair, casey, dana } = users;

  // 1) OPEN binary market with an active betting history + comments
  const knicks = await createMarket({
    actorId: admin.id,
    fields: {
      title: "Will the Knicks win their next playoff series?",
      description:
        "Resolves YES if the Knicks win their next completed playoff series. Resolves NO if they lose it or miss the playoffs entirely.",
      category: "Sports",
      closeTime: daysFromNow(6),
      resolveTime: daysFromNow(9),
      resolutionSource: "nba.com official results",
    },
    outcomes: BINARY_PRESET,
    openNow: true,
  });
  await backdateMarket(knicks.id, 5);
  await placeSeedBets(knicks.id, [
    { userId: alex.id, outcome: 0, amount: 50, daysAgo: 4.8 },
    { userId: blair.id, outcome: 1, amount: 80, daysAgo: 4.5 },
    { userId: casey.id, outcome: 0, amount: 30, daysAgo: 4.1 },
    { userId: dana.id, outcome: 1, amount: 40, daysAgo: 3.6 },
    { userId: alex.id, outcome: 0, amount: 60, daysAgo: 2.9 },
    { userId: blair.id, outcome: 1, amount: 70, daysAgo: 2.2 },
    { userId: dana.id, outcome: 0, amount: 25, daysAgo: 1.4 },
    { userId: casey.id, outcome: 0, amount: 45, daysAgo: 0.8 },
    { userId: blair.id, outcome: 1, amount: 50, daysAgo: 0.3 },
  ]);
  await createComment({
    userId: blair.id,
    marketId: knicks.id,
    body: "Free points. The Knicks always break your heart.",
    skipRateLimit: true,
  });
  await createComment({
    userId: alex.id,
    marketId: knicks.id,
    body: "Bookmark this comment. YES to the moon 🏀",
    skipRateLimit: true,
  });
  await createComment({
    userId: dana.id,
    marketId: knicks.id,
    body: "Hedged and proud of it.",
    skipRateLimit: true,
  });

  // 2) OPEN 3-outcome market with betting history — the multi-outcome demo
  const derby = await createMarket({
    actorId: admin.id,
    fields: {
      title: "Who wins the North London derby?",
      description:
        "Resolves to the full-time result of the next Arsenal vs Spurs league match: Arsenal win, Draw, or Spurs win. Abandoned match cancels the market.",
      category: "Sports",
      closeTime: daysFromNow(4),
      resolveTime: daysFromNow(5),
      resolutionSource: "premierleague.com official result",
    },
    outcomes: [
      { label: "Arsenal", color: "red", emoji: "🔴" },
      { label: "Draw", color: "amber", emoji: "🤝" },
      { label: "Spurs", color: "blue", emoji: "🐓" },
    ],
    openNow: true,
  });
  await backdateMarket(derby.id, 3);
  await placeSeedBets(derby.id, [
    { userId: alex.id, outcome: 0, amount: 60, daysAgo: 2.7 },
    { userId: blair.id, outcome: 2, amount: 45, daysAgo: 2.3 },
    { userId: casey.id, outcome: 1, amount: 25, daysAgo: 1.9 },
    { userId: dana.id, outcome: 0, amount: 40, daysAgo: 1.4 },
    { userId: blair.id, outcome: 1, amount: 30, daysAgo: 0.9 },
    { userId: alex.id, outcome: 0, amount: 35, daysAgo: 0.4 },
  ]);
  await createComment({
    userId: casey.id,
    marketId: derby.id,
    body: "Derby games are always draws. Easy money.",
    skipRateLimit: true,
  });

  // 3) OPEN, fresh market (empty pools — 1/N display case)
  await createMarket({
    actorId: admin.id,
    fields: {
      title: "Will it snow in the city before December 1st?",
      description: "Resolves YES if measurable snowfall (>= 0.1 in) is recorded at the downtown station before Dec 1.",
      category: "Weather",
      closeTime: daysFromNow(14),
      resolveTime: daysFromNow(15),
      resolutionSource: "weather.gov station records",
    },
    outcomes: BINARY_PRESET,
    openNow: true,
  });

  // 4) PROPOSED by a member — admin review queue demo
  await proposeMarket({
    proposerId: casey.id,
    fields: {
      title: "Will Dave actually finish the marathon?",
      description: "Resolves YES if Dave crosses the finish line of the spring marathon, any time. DNF or no-show is NO.",
      category: "Friends",
      closeTime: daysFromNow(20),
      resolveTime: daysFromNow(21),
      resolutionSource: "Official race tracker + Strava",
    },
    outcomes: BINARY_PRESET,
  });

  // 5) DRAFT (admin-created, not yet open)
  await createMarket({
    actorId: admin.id,
    fields: {
      title: "Will the group chat hit 10,000 messages this month?",
      description: "Resolves YES if the group chat message counter shows >= 10,000 for the calendar month.",
      category: "Friends",
      closeTime: daysFromNow(10),
      resolveTime: daysFromNow(11),
      resolutionSource: "Chat export screenshot",
    },
    outcomes: BINARY_PRESET,
  });

  // 6) CLOSED, awaiting resolution
  const poker = await createMarket({
    actorId: admin.id,
    fields: {
      title: "Will Blair win poker night?",
      description: "Resolves YES if Blair takes the biggest pot of the night. House rules apply.",
      category: "Friends",
      closeTime: daysFromNow(2),
      resolveTime: daysFromNow(3),
      resolutionSource: "Group vote at the table",
    },
    outcomes: BINARY_PRESET,
    openNow: true,
  });
  await backdateMarket(poker.id, 3);
  await placeSeedBets(poker.id, [
    { userId: blair.id, outcome: 0, amount: 100, daysAgo: 2.5 },
    { userId: alex.id, outcome: 1, amount: 60, daysAgo: 2.0 },
    { userId: dana.id, outcome: 1, amount: 45, daysAgo: 1.2 },
  ]);
  await prisma.market.update({ where: { id: poker.id }, data: { closeTime: new Date(Date.now() - 60_000) } });
  await closeMarket(poker.id, admin.id);

  // 7) RESOLVED YES — real payouts with visible rake and dust
  const album = await createMarket({
    actorId: admin.id,
    fields: {
      title: "Will the album drop before the end of the month?",
      description: "Resolves YES if the full album is on streaming services before month end, any timezone.",
      category: "Music",
      closeTime: daysFromNow(1),
      resolveTime: daysFromNow(2),
      resolutionSource: "Spotify release page",
    },
    outcomes: BINARY_PRESET,
    openNow: true,
  });
  await backdateMarket(album.id, 8);
  await placeSeedBets(album.id, [
    { userId: alex.id, outcome: 0, amount: 121, daysAgo: 7.5 },
    { userId: blair.id, outcome: 1, amount: 200, daysAgo: 6.8 },
    { userId: casey.id, outcome: 0, amount: 32, daysAgo: 5.4 },
    { userId: dana.id, outcome: 1, amount: 47, daysAgo: 4.2 },
  ]);
  await resolveMarket(
    album.id,
    admin.id,
    await winningOutcomeId(album.id, 0),
    "Spotify release page",
    "Dropped at midnight. Alex called it.",
  );
  await createComment({
    userId: alex.id,
    marketId: album.id,
    body: "Never doubted it. Pay up 💿",
    skipRateLimit: true,
  });

  // 8) CANCELED — refund demo
  const roadTrip = await createMarket({
    actorId: admin.id,
    fields: {
      title: "Will the road trip happen before summer?",
      description: "Resolves YES if at least 4 of us are in the car when it leaves the driveway.",
      category: "Friends",
      closeTime: daysFromNow(5),
      resolveTime: daysFromNow(6),
      resolutionSource: "Group consensus",
    },
    outcomes: BINARY_PRESET,
    openNow: true,
  });
  await backdateMarket(roadTrip.id, 4);
  await placeSeedBets(roadTrip.id, [
    { userId: casey.id, outcome: 0, amount: 40, daysAgo: 3.2 },
    { userId: dana.id, outcome: 1, amount: 25, daysAgo: 2.1 },
  ]);
  await cancelMarket(roadTrip.id, admin.id, "Trip postponed indefinitely — no fair way to resolve.");
}

function assertNotProduction() {
  const looksLikeProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    /neon\.tech|supabase\.co|render\.com|amazonaws\.com/i.test(process.env.DATABASE_URL ?? "");

  if (looksLikeProduction && process.env.FORCE_SEED_DEMO_ACCOUNTS !== "1") {
    throw new Error(
      "Refusing to seed demo accounts: this looks like a production environment. " +
        "The seed creates well-known logins (admin@prollymarket.local / password123). " +
        "Set FORCE_SEED_DEMO_ACCOUNTS=1 only if you truly want them here.",
    );
  }
}

async function main() {
  assertNotProduction();
  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD ?? "password123";
  const users = await seedUsers(defaultPassword);
  await seedMarkets(users);
  console.log("Seed complete.");
  console.log("Sign in as admin@prollymarket.local / alex@ / blair@ / casey@ / dana@prollymarket.local");
  console.log(`Password: ${defaultPassword}`);
  console.log("Pending approval demo: dave@prollymarket.local (approve from /admin/members)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
