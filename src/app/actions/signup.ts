"use server";

import { UserStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";

const signUpSchema = z.object({
  name: z.string().min(2).max(80),
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
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Complete all fields with valid values." };
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

  const passwordHash = await hashPassword(parsed.data.password);

  if (existingUser) {
    // a rejected email may re-apply: reset the account to a fresh PENDING
    // application (the old review is preserved in the admin audit log)
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: parsed.data.name,
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
        passwordHash,
      },
    });
  }

  redirect("/sign-in?pending=1");
}
