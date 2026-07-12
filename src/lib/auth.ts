import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });

        if (!user) {
          return null;
        }

        const valid = await verifyPassword(parsed.data.password, user.passwordHash);

        if (!valid) {
          return null;
        }

        // status gate — checked only after the password so unauthenticated
        // probing can't distinguish pending accounts from wrong passwords
        if (user.status === "PENDING") {
          throw new Error("ACCOUNT_PENDING");
        }

        if (user.status !== "ACTIVE") {
          throw new Error("ACCOUNT_NOT_ACTIVE");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = user.role;
        token.username = user.username;
      }

      // client-side useSession().update({ name }) after a rename — the JWT
      // otherwise keeps the sign-in-time name until the next login
      if (trigger === "update" && typeof session?.name === "string") {
        token.name = session.name;
      }
      if (trigger === "update" && typeof session?.username === "string") {
        token.username = session.username;
      }

      // tokens issued before usernames existed — backfill once from the DB
      if (!token.username && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { username: true },
        });
        token.username = dbUser?.username;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as "ADMIN" | "MEMBER";
        session.user.username = token.username ?? "";
      }

      return session;
    },
  },
};
