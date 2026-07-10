import { AppLogEventType, AppLogLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type LogInput = {
  level: AppLogLevel;
  eventType: AppLogEventType;
  message: string;
  userId?: string;
  marketId?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAppLog(input: LogInput) {
  await prisma.appLog.create({
    data: {
      level: input.level,
      eventType: input.eventType,
      message: input.message,
      userId: input.userId,
      marketId: input.marketId,
      metadata: input.metadata,
    },
  });
}
