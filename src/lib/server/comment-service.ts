import { MarketStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function createComment(input: {
  userId: string;
  marketId: string;
  body: string;
  skipRateLimit?: boolean;
}) {
  enforceRateLimit(`comment:${input.userId}`, { skip: input.skipRateLimit });

  const body = input.body.trim();
  if (!body) {
    throw new Error("Comment cannot be empty.");
  }

  const market = await prisma.market.findUnique({
    where: { id: input.marketId },
    select: { status: true },
  });

  if (!market || market.status === MarketStatus.REJECTED) {
    throw new Error("Market not found.");
  }

  return prisma.comment.create({
    data: {
      userId: input.userId,
      marketId: input.marketId,
      body,
    },
    include: {
      user: { select: { name: true } },
    },
  });
}

export async function deleteComment(commentId: string, actor: { id: string; role: UserRole }) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { userId: true },
  });

  if (!comment) {
    throw new Error("Comment not found.");
  }

  if (comment.userId !== actor.id && actor.role !== UserRole.ADMIN) {
    throw new Error("You can only delete your own comments.");
  }

  await prisma.comment.delete({ where: { id: commentId } });
}

export async function listComments(marketId: string) {
  return prisma.comment.findMany({
    where: { marketId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
    },
  });
}
