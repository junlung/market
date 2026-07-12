/**
 * One-time bootstrap for a fresh deployment: promotes an existing account to
 * an active admin and grants the starting balance if it never received one.
 *
 * A fresh production DB has no admins, so nobody could approve the first
 * signup — this breaks that deadlock. Run it against the production database:
 *
 *   DATABASE_URL="<prod url>" npm run create-admin -- you@example.com
 *
 * (Sign up in the app first so the account exists.)
 */
import { LedgerEntryType, UserRole, UserStatus } from "@prisma/client";
import { appConfig } from "../src/lib/config";
import { prisma } from "../src/lib/prisma";
import { ensureGlobalLeague, ensureLeagueMembership } from "../src/lib/server/league-service";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error("Usage: npm run create-admin -- you@example.com");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.error(`No account found for ${email} — sign up in the app first, then re-run this.`);
    process.exitCode = 1;
    return;
  }

  const globalLeague = await ensureGlobalLeague();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        reviewedAt: user.reviewedAt ?? new Date(),
        reviewNote: user.reviewNote ?? "Bootstrapped via create-admin script",
      },
    });

    const existingGrant = await tx.ledgerEntry.findFirst({
      where: { userId: user.id, type: LedgerEntryType.INITIAL_GRANT },
    });

    if (!existingGrant) {
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          leagueId: globalLeague.id,
          type: LedgerEntryType.INITIAL_GRANT,
          amount: appConfig.startingBalance,
          description: "Starting balance",
        },
      });
    }
  });

  await ensureLeagueMembership(globalLeague.id, user.id);

  console.log(`${user.name} <${email}> is now an active admin.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
