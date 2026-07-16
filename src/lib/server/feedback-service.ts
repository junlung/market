import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function submitFeedback(input: {
  userId: string;
  message: string;
  path?: string;
  skipRateLimit?: boolean;
}) {
  enforceRateLimit(`feedback:${input.userId}`, { skip: input.skipRateLimit });

  const message = input.message.trim();
  if (!message) {
    throw new Error("Feedback cannot be empty.");
  }

  // the path is user-supplied metadata; keep only plausible relative paths and
  // treat it as display-only text everywhere it renders
  const path = input.path?.startsWith("/") ? input.path : null;

  return prisma.feedback.create({
    data: {
      userId: input.userId,
      message,
      path,
    },
  });
}

export async function listFeedback() {
  return prisma.feedback.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, username: true } },
    },
  });
}

export async function setFeedbackResolved(feedbackId: string, resolved: boolean) {
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    select: { id: true },
  });

  if (!feedback) {
    throw new Error("Feedback not found.");
  }

  return prisma.feedback.update({
    where: { id: feedbackId },
    data: { resolvedAt: resolved ? new Date() : null },
  });
}

export async function getUnresolvedFeedbackCount() {
  return prisma.feedback.count({ where: { resolvedAt: null } });
}
