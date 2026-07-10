import {
  AppLogEventType,
  AppLogLevel,
  LedgerEntryType,
  MarketOutcome,
  MarketStatus,
  UserStatus,
} from "@prisma/client";
import { appConfig } from "@/lib/config";
import { buildBalanceBreakdown, reconcileBalanceFromBreakdown, sumLedgerAmounts } from "@/lib/ledger";
import { getMarketOdds, validateMarketDraft } from "@/lib/markets";
import {
  assertSafeInt,
  checkConservation,
  computeCancelRefunds,
  computeSettlement,
  estimatePayout,
  type SettlementResult,
  type StakeRow,
} from "@/lib/parimutuel";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/server/tx";

export type ActionResult = {
  error?: string;
  success?: string;
};

type MarketFields = {
  title: string;
  description: string;
  category: string;
  closeTime: Date;
  resolveTime: Date;
  resolutionSource: string;
};

function logAdminAction(message: string, userId: string, marketId: string, metadata?: object) {
  return prisma.appLog.create({
    data: {
      level: AppLogLevel.INFO,
      eventType: AppLogEventType.ADMIN_ACTION,
      message,
      userId,
      marketId,
      ...(metadata ? { metadata } : {}),
    },
  });
}

function logProposalAction(message: string, userId: string, marketId: string) {
  return prisma.appLog.create({
    data: {
      level: AppLogLevel.INFO,
      eventType: AppLogEventType.PROPOSAL_ACTION,
      message,
      userId,
      marketId,
    },
  });
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export async function getUserBalance(userId: string) {
  const result = await prisma.ledgerEntry.aggregate({
    where: { userId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

export async function getBalanceBreakdown(userId: string) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { userId },
    select: { amount: true, type: true },
  });

  const breakdown = buildBalanceBreakdown(entries);

  return {
    ...breakdown,
    currentBalance: reconcileBalanceFromBreakdown(breakdown),
  };
}

export async function getLedgerEntries(userId: string) {
  return prisma.ledgerEntry.findMany({
    where: { userId },
    include: {
      market: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Market lifecycle
// ---------------------------------------------------------------------------

export async function createMarket(input: {
  actorId: string;
  fields: MarketFields;
  maxStakePerUser?: number;
  rakeBps?: number;
  openNow?: boolean;
}) {
  validateMarketDraft(input.fields);

  const maxStakePerUser = input.maxStakePerUser ?? appConfig.defaultMaxStakePerUser;
  const rakeBps = input.rakeBps ?? appConfig.rakeBps;
  assertSafeInt(maxStakePerUser, "Stake cap");
  assertSafeInt(rakeBps, "Rake");

  const market = await prisma.market.create({
    data: {
      ...input.fields,
      status: input.openNow ? MarketStatus.OPEN : MarketStatus.DRAFT,
      maxStakePerUser,
      rakeBps,
      createdById: input.actorId,
      ...(input.openNow ? { openedById: input.actorId, openedAt: new Date() } : {}),
    },
  });

  await logAdminAction(
    `Created ${input.openNow ? "open" : "draft"} market: ${market.title}`,
    input.actorId,
    market.id,
  );

  return market;
}

export async function proposeMarket(input: { proposerId: string; fields: MarketFields }) {
  validateMarketDraft(input.fields);

  const market = await prisma.market.create({
    data: {
      ...input.fields,
      status: MarketStatus.PROPOSED,
      maxStakePerUser: appConfig.defaultMaxStakePerUser,
      rakeBps: appConfig.rakeBps,
      createdById: input.proposerId,
    },
  });

  await logProposalAction(`Proposed market: ${market.title}`, input.proposerId, market.id);

  return market;
}

export async function approveProposal(
  marketId: string,
  adminId: string,
  options: { note?: string; openNow?: boolean } = {},
) {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

  if (market.status !== MarketStatus.PROPOSED) {
    throw new Error("Only proposed markets can be approved.");
  }

  await prisma.market.update({
    where: { id: marketId },
    data: {
      status: options.openNow ? MarketStatus.OPEN : MarketStatus.DRAFT,
      reviewedById: adminId,
      reviewedAt: new Date(),
      reviewNote: options.note,
      ...(options.openNow ? { openedById: adminId, openedAt: new Date() } : {}),
    },
  });

  await logProposalAction(
    `Approved proposal${options.openNow ? " and opened" : ""}: ${market.title}`,
    adminId,
    marketId,
  );
}

export async function rejectProposal(marketId: string, adminId: string, reason: string) {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

  if (market.status !== MarketStatus.PROPOSED) {
    throw new Error("Only proposed markets can be rejected.");
  }

  await prisma.market.update({
    where: { id: marketId },
    data: {
      status: MarketStatus.REJECTED,
      reviewedById: adminId,
      reviewedAt: new Date(),
      reviewNote: reason,
    },
  });

  await logProposalAction(`Rejected proposal: ${market.title} (${reason})`, adminId, marketId);
}

export async function updateMarket(
  marketId: string,
  adminId: string,
  input: MarketFields & { maxStakePerUser?: number; rakeBps?: number },
) {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

  const editable =
    market.status === MarketStatus.PROPOSED ||
    market.status === MarketStatus.DRAFT ||
    (market.status === MarketStatus.OPEN && market.firstBetAt === null);

  if (!editable) {
    throw new Error("Markets cannot be edited after the first bet.");
  }

  validateMarketDraft(input);

  await prisma.market.update({
    where: { id: marketId },
    data: {
      title: input.title,
      description: input.description,
      category: input.category,
      closeTime: input.closeTime,
      resolveTime: input.resolveTime,
      resolutionSource: input.resolutionSource,
      ...(input.maxStakePerUser !== undefined ? { maxStakePerUser: input.maxStakePerUser } : {}),
      ...(input.rakeBps !== undefined ? { rakeBps: input.rakeBps } : {}),
    },
  });

  await logAdminAction(`Updated market: ${market.title}`, adminId, marketId);
}

export async function openMarket(marketId: string, adminId: string) {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

  if (market.status !== MarketStatus.DRAFT) {
    throw new Error("Only draft markets can be opened.");
  }

  await prisma.market.update({
    where: { id: marketId },
    data: {
      status: MarketStatus.OPEN,
      openedById: adminId,
      openedAt: new Date(),
    },
  });

  await logAdminAction(`Opened market: ${market.title}`, adminId, marketId);
}

export async function closeMarket(marketId: string, adminId: string) {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

  if (market.status !== MarketStatus.OPEN) {
    throw new Error("Only open markets can be closed.");
  }

  await prisma.market.update({
    where: { id: marketId },
    data: {
      status: MarketStatus.CLOSED,
      closedById: adminId,
      closedAt: new Date(),
    },
  });

  await logAdminAction(`Closed market: ${market.title}`, adminId, marketId);
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

function toStakeRows(stakes: Array<{ userId: string; yesStake: number; noStake: number }>): StakeRow[] {
  return stakes.map((stake) => ({
    userId: stake.userId,
    yesStake: stake.yesStake,
    noStake: stake.noStake,
  }));
}

async function writeSettlement(input: {
  marketId: string;
  adminId: string;
  outcome: MarketOutcome;
  resolutionSource: string;
  notes?: string;
  toStatus: MarketStatus;
}) {
  return withSerializableRetry(async (tx) => {
    const market = await tx.market.findUnique({ where: { id: input.marketId } });

    if (!market) {
      throw new Error("Market not found.");
    }

    if (input.outcome === MarketOutcome.CANCELED) {
      if (market.status === MarketStatus.RESOLVED || market.status === MarketStatus.CANCELED) {
        throw new Error("This market cannot be canceled.");
      }
    } else if (market.status !== MarketStatus.OPEN && market.status !== MarketStatus.CLOSED) {
      throw new Error("Only open or closed markets can be resolved.");
    }

    const stakes = toStakeRows(await tx.poolStake.findMany({ where: { marketId: input.marketId } }));

    const result: SettlementResult =
      input.outcome === MarketOutcome.CANCELED
        ? computeCancelRefunds(stakes)
        : computeSettlement(stakes, input.outcome, market.rakeBps);

    // conservation is re-checked at runtime before anything is written —
    // a math regression aborts the transaction instead of corrupting the ledger
    if (!checkConservation(result)) {
      throw new Error("Settlement failed conservation check.");
    }

    if (input.outcome !== MarketOutcome.CANCELED && result.totalIn !== market.yesPool + market.noPool) {
      throw new Error("Settlement does not match market pools.");
    }

    if (result.payouts.length > 0) {
      await tx.ledgerEntry.createMany({
        data: result.payouts.map((payout) => ({
          userId: payout.userId,
          marketId: input.marketId,
          type: payout.kind === "REFUND" ? LedgerEntryType.MARKET_REFUND : LedgerEntryType.MARKET_PAYOUT,
          amount: payout.amount,
          description:
            payout.kind === "REFUND"
              ? `Refund: ${market.title}`
              : `Payout for ${input.outcome} — ${market.title}`,
        })),
      });
    }

    await tx.market.update({
      where: { id: input.marketId },
      data: {
        status: input.toStatus,
        finalOutcome: input.outcome,
        ...(input.toStatus === MarketStatus.RESOLVED
          ? {
              closedAt: market.closedAt ?? new Date(),
              closedById: market.closedById ?? input.adminId,
              resolvedAt: new Date(),
              resolvedById: input.adminId,
            }
          : {
              canceledAt: new Date(),
              canceledById: input.adminId,
            }),
      },
    });

    await tx.marketResolution.upsert({
      where: { marketId: input.marketId },
      update: {},
      create: {
        marketId: input.marketId,
        outcome: input.outcome,
        resolutionSource: input.resolutionSource,
        notes: input.notes,
        yesPoolFinal: market.yesPool,
        noPoolFinal: market.noPool,
        winningPool: result.winningPool,
        losingPool: result.losingPool,
        rakeAmount: result.rake,
        dustAmount: result.dust,
        totalPaidOut: result.totalOut,
        createdById: input.adminId,
      },
    });

    return result;
  });
}

export async function resolveMarket(
  marketId: string,
  adminId: string,
  outcome: "YES" | "NO",
  resolutionSource: string,
  notes?: string,
) {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

  const result = await writeSettlement({
    marketId,
    adminId,
    outcome: outcome === "YES" ? MarketOutcome.YES : MarketOutcome.NO,
    resolutionSource,
    notes,
    toStatus: MarketStatus.RESOLVED,
  });

  await logAdminAction(`Resolved market ${market.title} to ${outcome}`, adminId, marketId, {
    rake: result.rake,
    dust: result.dust,
    paidOut: result.totalOut,
  });

  return result;
}

export async function cancelMarket(marketId: string, adminId: string, reason: string) {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

  if (market.status === MarketStatus.PROPOSED || market.status === MarketStatus.DRAFT) {
    // nothing staked yet — no settlement needed, just mark it canceled
    await prisma.market.update({
      where: { id: marketId },
      data: {
        status: MarketStatus.CANCELED,
        finalOutcome: MarketOutcome.CANCELED,
        canceledById: adminId,
        canceledAt: new Date(),
      },
    });
  } else {
    await writeSettlement({
      marketId,
      adminId,
      outcome: MarketOutcome.CANCELED,
      resolutionSource: market.resolutionSource,
      notes: reason,
      toStatus: MarketStatus.CANCELED,
    });
  }

  await logAdminAction(`Canceled market: ${market.title}`, adminId, marketId, { reason });
}

/** Dry-run settlement for the admin resolve form — computes payouts without writing. */
export async function previewSettlement(marketId: string, outcome: "YES" | "NO") {
  const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
  const stakes = await prisma.poolStake.findMany({
    where: { marketId },
    include: { user: { select: { name: true } } },
  });

  const result = computeSettlement(toStakeRows(stakes), outcome, market.rakeBps);
  const payoutByUser = new Map(result.payouts.map((payout) => [payout.userId, payout]));

  const rows = stakes
    .filter((stake) => stake.yesStake > 0 || stake.noStake > 0)
    .map((stake) => {
      const payout = payoutByUser.get(stake.userId);
      const staked = stake.yesStake + stake.noStake;
      return {
        userId: stake.userId,
        name: stake.user.name,
        yesStake: stake.yesStake,
        noStake: stake.noStake,
        payout: payout?.amount ?? 0,
        profit: (payout?.amount ?? 0) - staked,
      };
    })
    .sort((a, b) => b.payout - a.payout || a.name.localeCompare(b.name));

  return { rows, rake: result.rake, dust: result.dust, mode: result.mode };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDashboardMarkets(
  userId: string,
  filters: { category?: string; query?: string } = {},
) {
  const markets = await prisma.market.findMany({
    where: {
      status: MarketStatus.OPEN,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.query
        ? {
            OR: [
              { title: { contains: filters.query, mode: "insensitive" } },
              { description: { contains: filters.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      poolStakes: { where: { userId } },
      bets: {
        orderBy: { createdAt: "asc" },
        select: { yesPoolAfter: true, noPoolAfter: true },
      },
      _count: { select: { poolStakes: true } },
    },
    orderBy: { closeTime: "asc" },
  });

  return markets.map((market) => {
    const odds = getMarketOdds(market);
    const stake = market.poolStakes[0] ?? null;
    const sparkPoints = [
      0.5,
      ...market.bets.map((bet) => {
        const total = bet.yesPoolAfter + bet.noPoolAfter;
        return total > 0 ? bet.yesPoolAfter / total : 0.5;
      }),
    ];

    return {
      id: market.id,
      title: market.title,
      category: market.category,
      closeTime: market.closeTime,
      status: market.status,
      yesPool: market.yesPool,
      noPool: market.noPool,
      ...odds,
      participants: market._count.poolStakes,
      sparkPoints,
      viewerStake: stake ? { yesStake: stake.yesStake, noStake: stake.noStake } : null,
    };
  });
}

export async function getOpenCategories() {
  const rows = await prisma.market.groupBy({
    by: ["category"],
    where: { status: MarketStatus.OPEN },
    orderBy: { category: "asc" },
  });

  return rows.map((row) => row.category);
}

export async function getMarketDetail(marketId: string, userId: string) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      poolStakes: {
        include: { user: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
      },
      bets: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true } } },
      },
      ledgerEntries: {
        where: {
          type: { in: [LedgerEntryType.MARKET_PAYOUT, LedgerEntryType.MARKET_REFUND] },
        },
        select: { userId: true, type: true, amount: true },
      },
      resolution: true,
      _count: { select: { poolStakes: true, bets: true } },
    },
  });

  if (!market) {
    return null;
  }

  const odds = getMarketOdds(market);
  const openedAt = market.openedAt ?? market.createdAt;

  const oddsHistory = [
    { t: openedAt.getTime(), p: 0.5 },
    ...market.bets.map((bet) => {
      const total = bet.yesPoolAfter + bet.noPoolAfter;
      return { t: bet.createdAt.getTime(), p: total > 0 ? bet.yesPoolAfter / total : 0.5 };
    }),
  ];

  const activity = [...market.bets]
    .reverse()
    .slice(0, 30)
    .map((bet) => {
      const total = bet.yesPoolAfter + bet.noPoolAfter;
      return {
        id: bet.id,
        userName: bet.user.name,
        side: bet.side,
        amount: bet.amount,
        probabilityAfter: total > 0 ? bet.yesPoolAfter / total : 0.5,
        createdAt: bet.createdAt,
      };
    });

  const settlementByUser = new Map<string, number>();
  for (const entry of market.ledgerEntries) {
    settlementByUser.set(entry.userId, (settlementByUser.get(entry.userId) ?? 0) + entry.amount);
  }

  const positions = market.poolStakes
    .filter((stake) => stake.yesStake > 0 || stake.noStake > 0)
    .map((stake) => {
      const staked = stake.yesStake + stake.noStake;
      const settled = settlementByUser.get(stake.userId) ?? 0;
      let resultLabel: string | null = null;

      if (market.finalOutcome === MarketOutcome.CANCELED) {
        resultLabel = "Refunded";
      } else if (market.finalOutcome === MarketOutcome.YES) {
        resultLabel = stake.yesStake > 0 ? "Won" : "Lost";
      } else if (market.finalOutcome === MarketOutcome.NO) {
        resultLabel = stake.noStake > 0 ? "Won" : "Lost";
      }

      return {
        userId: stake.userId,
        name: stake.user.name,
        yesStake: stake.yesStake,
        noStake: stake.noStake,
        staked,
        potShare: odds.pot > 0 ? staked / odds.pot : 0,
        settlementAmount: settled,
        profit: settled - staked,
        resultLabel,
      };
    })
    .sort((a, b) => b.staked - a.staked || a.name.localeCompare(b.name));

  const viewerStake = market.poolStakes.find((stake) => stake.userId === userId) ?? null;

  return {
    id: market.id,
    title: market.title,
    description: market.description,
    category: market.category,
    closeTime: market.closeTime,
    resolveTime: market.resolveTime,
    resolutionSource: market.resolutionSource,
    status: market.status,
    finalOutcome: market.finalOutcome,
    yesPool: market.yesPool,
    noPool: market.noPool,
    rakeBps: market.rakeBps,
    maxStakePerUser: market.maxStakePerUser,
    openedAt: market.openedAt,
    createdAt: market.createdAt,
    ...odds,
    participantCount: market._count.poolStakes,
    betCount: market._count.bets,
    oddsHistory,
    activity,
    positions,
    comments: market.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      userName: comment.user.name,
      userId: comment.userId,
      createdAt: comment.createdAt,
    })),
    resolution: market.resolution,
    viewerStake: viewerStake
      ? { yesStake: viewerStake.yesStake, noStake: viewerStake.noStake }
      : null,
  };
}

export async function getActiveStakes(userId: string) {
  const stakes = await prisma.poolStake.findMany({
    where: {
      userId,
      OR: [{ yesStake: { gt: 0 } }, { noStake: { gt: 0 } }],
      market: { status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] } },
    },
    include: { market: true },
    orderBy: { updatedAt: "desc" },
  });

  return stakes.map((stake) => {
    const odds = getMarketOdds(stake.market);

    const yesIfWon =
      stake.yesStake > 0
        ? estimatePayout({
            stake: stake.yesStake,
            winningPool: stake.market.yesPool,
            losingPool: stake.market.noPool,
            rakeBps: stake.market.rakeBps,
          })
        : 0;
    const noIfWon =
      stake.noStake > 0
        ? estimatePayout({
            stake: stake.noStake,
            winningPool: stake.market.noPool,
            losingPool: stake.market.yesPool,
            rakeBps: stake.market.rakeBps,
          })
        : 0;

    return {
      marketId: stake.marketId,
      title: stake.market.title,
      category: stake.market.category,
      status: stake.market.status,
      closeTime: stake.market.closeTime,
      yesStake: stake.yesStake,
      noStake: stake.noStake,
      staked: stake.yesStake + stake.noStake,
      yesProbability: odds.yesProbability,
      noProbability: odds.noProbability,
      yesIfWon,
      noIfWon,
    };
  });
}

export async function getResolvedStakes(userId: string) {
  const stakes = await prisma.poolStake.findMany({
    where: {
      userId,
      OR: [{ yesStake: { gt: 0 } }, { noStake: { gt: 0 } }],
      market: { status: { in: [MarketStatus.RESOLVED, MarketStatus.CANCELED] } },
    },
    include: {
      market: {
        include: {
          ledgerEntries: {
            where: {
              userId,
              type: { in: [LedgerEntryType.MARKET_PAYOUT, LedgerEntryType.MARKET_REFUND] },
            },
            select: { amount: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return stakes.map((stake) => {
    const staked = stake.yesStake + stake.noStake;
    const settled = sumLedgerAmounts(stake.market.ledgerEntries);
    const outcome = stake.market.finalOutcome;
    const won =
      outcome === MarketOutcome.YES
        ? stake.yesStake > 0
        : outcome === MarketOutcome.NO
          ? stake.noStake > 0
          : null;

    return {
      marketId: stake.marketId,
      title: stake.market.title,
      category: stake.market.category,
      status: stake.market.status,
      outcome,
      resolvedAt: stake.market.resolvedAt ?? stake.market.canceledAt,
      yesStake: stake.yesStake,
      noStake: stake.noStake,
      staked,
      settled,
      profit: settled - staked,
      won,
    };
  });
}

export async function getBetHistory(userId: string) {
  return prisma.bet.findMany({
    where: { userId },
    include: { market: { select: { id: true, title: true, status: true, finalOutcome: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getActivityFeed(limit = 30) {
  const bets = await prisma.bet.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
      market: { select: { id: true, title: true } },
    },
  });

  return bets.map((bet) => {
    const total = bet.yesPoolAfter + bet.noPoolAfter;
    return {
      id: bet.id,
      userName: bet.user.name,
      side: bet.side,
      amount: bet.amount,
      probabilityAfter: total > 0 ? bet.yesPoolAfter / total : 0.5,
      marketId: bet.market.id,
      marketTitle: bet.market.title,
      createdAt: bet.createdAt,
    };
  });
}

export async function getLeaderboard() {
  // every approved player belongs on the board, admins included — only
  // pending/rejected applicants (who can't hold points) are excluded
  const users = await prisma.user.findMany({
    where: { status: UserStatus.ACTIVE },
    select: { id: true, name: true },
  });

  const ledgerSums = await prisma.ledgerEntry.groupBy({
    by: ["userId", "type"],
    _sum: { amount: true },
  });

  const openStakes = await prisma.poolStake.findMany({
    where: { market: { status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] } } },
    select: { userId: true, yesStake: true, noStake: true },
  });

  const sumsByUser = new Map<string, Map<LedgerEntryType, number>>();
  for (const row of ledgerSums) {
    const perType = sumsByUser.get(row.userId) ?? new Map<LedgerEntryType, number>();
    perType.set(row.type, row._sum.amount ?? 0);
    sumsByUser.set(row.userId, perType);
  }

  const atRiskByUser = new Map<string, number>();
  for (const stake of openStakes) {
    atRiskByUser.set(
      stake.userId,
      (atRiskByUser.get(stake.userId) ?? 0) + stake.yesStake + stake.noStake,
    );
  }

  const rows = users.map((user) => {
    const perType = sumsByUser.get(user.id) ?? new Map<LedgerEntryType, number>();
    const sumOf = (type: LedgerEntryType) => perType.get(type) ?? 0;

    const balance =
      sumOf(LedgerEntryType.INITIAL_GRANT) +
      sumOf(LedgerEntryType.WEEKLY_ALLOWANCE) +
      sumOf(LedgerEntryType.BET_PLACED) +
      sumOf(LedgerEntryType.MARKET_PAYOUT) +
      sumOf(LedgerEntryType.MARKET_REFUND);
    const atRisk = atRiskByUser.get(user.id) ?? 0;
    const granted = sumOf(LedgerEntryType.INITIAL_GRANT) + sumOf(LedgerEntryType.WEEKLY_ALLOWANCE);

    return {
      userId: user.id,
      name: user.name,
      balance,
      atRisk,
      portfolioValue: balance + atRisk,
      netProfit: balance + atRisk - granted,
    };
  });

  return rows.sort((a, b) => b.netProfit - a.netProfit || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function getAdminMarkets() {
  const markets = await prisma.market.findMany({
    include: {
      _count: { select: { bets: true, poolStakes: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return markets.map((market) => ({
    ...market,
    ...getMarketOdds(market),
    betCount: market._count.bets,
    participantCount: market._count.poolStakes,
  }));
}

export async function listProposals() {
  return prisma.market.findMany({
    where: { status: MarketStatus.PROPOSED },
    orderBy: { createdAt: "asc" },
  });
}

export async function getAdminMarketDetail(marketId: string) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      resolution: true,
      bets: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, email: true } } },
      },
      poolStakes: {
        include: { user: { select: { name: true, email: true } } },
      },
      ledgerEntries: {
        where: {
          type: { in: [LedgerEntryType.MARKET_PAYOUT, LedgerEntryType.MARKET_REFUND] },
        },
        select: { userId: true, type: true, amount: true },
      },
      appLogs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!market) {
    return null;
  }

  const settlementByUser = new Map<string, number>();
  for (const entry of market.ledgerEntries) {
    settlementByUser.set(entry.userId, (settlementByUser.get(entry.userId) ?? 0) + entry.amount);
  }

  return {
    ...market,
    ...getMarketOdds(market),
    settlementRows:
      market.status === MarketStatus.RESOLVED || market.status === MarketStatus.CANCELED
        ? market.poolStakes
            .filter((stake) => stake.yesStake > 0 || stake.noStake > 0)
            .map((stake) => ({
              userId: stake.userId,
              name: stake.user.name,
              email: stake.user.email,
              yesStake: stake.yesStake,
              noStake: stake.noStake,
              settlementAmount: settlementByUser.get(stake.userId) ?? 0,
              profit: (settlementByUser.get(stake.userId) ?? 0) - stake.yesStake - stake.noStake,
            }))
            .sort((a, b) => b.settlementAmount - a.settlementAmount)
        : [],
  };
}
