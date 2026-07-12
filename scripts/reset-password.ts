/**
 * Admin-assisted password reset — there's no email infrastructure, so a
 * forgotten password is fixed by whoever holds the database URL:
 *
 *   DATABASE_URL="<prod url>" npm run reset-password -- friend@example.com "new-password-here"
 *
 * The new password must be at least 8 characters (the sign-in minimum).
 * Tell the friend to sign in with it and change nothing else — their
 * account, balance, and bets are untouched.
 */
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.error('Usage: npm run reset-password -- friend@example.com "new-password"');
    process.exitCode = 1;
    return;
  }

  if (newPassword.length < 8) {
    console.error("Password must be at least 8 characters (the sign-in form's minimum).");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.error(`No account found for ${email}.`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  console.log(`Password reset for ${user.name} <${email}>. They can sign in with it now.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
