"use server";

import { NotificationType, UserStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { emitToAdmins } from "@/lib/server/notification-service";
import { usernameValueSchema } from "@/lib/validation";

const signUpSchema = z.object({
  name: z.string().min(2).max(80),
  username: usernameValueSchema,
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

export type SignUpFormState = {
  error?: string;
};

/**
 * Open signup: the account is created as PENDING and cannot log in until an
 * admin approves it. The starting balance is granted at approval, not here —
 * junk signups never hold points.
 */
export async function registerWithInvite(_: SignUpFormState, formData: FormData): Promise<SignUpFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    // username has real rules worth surfacing; everything else is generic
    const usernameIssue = parsed.error.issues.find((issue) => issue.path[0] === "username");
    return { error: usernameIssue?.message ?? "Complete all fields with valid values." };
  }

  const email = parsed.data.email.toLowerCase();

  try {
    // open endpoint — keep bots from flooding the approval queue
    enforceRateLimit("signup:global");
  } catch {
    return { error: "Too many signups right now. Try again in a moment." };
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser && existingUser.status !== UserStatus.REJECTED) {
    return { error: "An account with that email already exists." };
  }

  const usernameTaken = await prisma.user.findFirst({
    where: { username: parsed.data.username, id: { not: existingUser?.id } },
    select: { id: true },
  });

  if (usernameTaken) {
    return { error: "That username is already taken." };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  try {
    if (existingUser) {
      // a rejected email may re-apply: reset the account to a fresh PENDING
      // application (the old review is preserved in the admin audit log)
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: parsed.data.name,
          username: parsed.data.username,
          passwordHash,
          status: UserStatus.PENDING,
          reviewedById: null,
          reviewedAt: null,
          reviewNote: null,
          vouchedById: null,
          vouchNote: null,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          email,
          name: parsed.data.name,
          username: parsed.data.username,
          passwordHash,
        },
      });
    }
  } catch (error) {
    // unique-violation race between the pre-check and the write
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return { error: "That username is already taken." };
    }
    throw error;
  }

  // outside the try/catch above (emitToAdmins never throws, and redirect()
  // throws NEXT_REDIRECT, which must not be swallowed). No dedupeKey: a
  // rejected email re-applying SHOULD re-notify the queue.
  await emitToAdmins({
    type: NotificationType.MEMBER_PENDING,
    title: "New member awaiting approval",
    body: `${parsed.data.name} (${email})`,
    href: "/admin/members",
  });

  redirect("/sign-in?pending=1");
}
