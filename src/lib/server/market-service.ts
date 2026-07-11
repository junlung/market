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
import {
  getMarketOdds,
  validateMarketDraft,
  validateOutcomeDrafts,
  type OutcomeDraft,
} from "@/lib/markets";
import { isYesNoMarket, outcomeDisplayLabel } from "@/lib/outcome-colors";
import {
  assertSafeInt,
  checkConservation,
  computeCancelRefunds,
  computeSettlement,
  estimatePayout,
  type OutcomeStake,
  type SettlementResult,
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

type OutcomeRow = { id: string; label: string; color: string; sortOrder: number; pool: number };

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

function outcomeCreateInput(outcomes: OutcomeDraft[]) {
  return {
    create: outcomes.map((outcome, index) => ({
      label: outcome.label.trim(),
      color: outcome.color,
      emoji: outcome.emoji?.trim() || null,
      sortOrder: index,
    })),
  };
}

/** Legacy release-1 dual-write: the YES/NO enum value for a binary market's outcome. */
function legacyOutcomeEnum(outcomes: OutcomeRow[], winningOutcomeId: string | null) {
  if (winningOutcomeId === null) {
    return MarketOutcome.CANCELED;
  }
  if (outcomes.length !== 2) {
    return null;
  }
  const winner = outcomes.find((outcome) => outcome.id === winningOutcomeId);
  return winner?.sortOrder === 0 ? MarketOutcome.YES : MarketOutcome.NO;
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
  outcomes: OutcomeDraft[];
  maxStakePerUser?: number;
  rakeBps?: number;
  openNow?: boolean;
}) {
  validateMarketDraft(input.fields);
  validateOutcomeDrafts(input.outcomes);

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
      outcomes: outcomeCreateInput(input.outcomes),
      ...(input.openNow ? { openedById: input.actorId, openedAt: new Date() } : {}),
    },
    include: { outcomes: { orderBy: { sortOrder: "asc" } } },
  });

  await logAdminAction(
    `Created ${input.openNow ? "open" : "draft"} market: ${market.title}`,
    input.actorId,
    market.id,
  );

  return market;
}

export async function proposeMarket(input: {
  proposerId: string;
  fields: MarketFields;
  outcomes: OutcomeDraft[];
}) {
  validateMarketDraft(input.fields);
  validateOutcomeDrafts(input.outcomes);

  const market = await prisma.market.create({
    data: {
      ...input.fields,
      status: MarketStatus.PROPOSED,
      maxStakePerUser: appConfig.defaultMaxStakePerUser,
      rakeBps: appConfig.rakeBps,
      createdById: input.proposerId,
      outcomes: outcomeCreateInput(input.outcomes),
    },
    include: { outcomes: { orderBy: { sortOrder: "asc" } } },
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
  input: MarketFields & {
    maxStakePerUser?: number;
    rakeBps?: number;
    outcomes?: OutcomeDraft[];
  },
) {
  const market = await prisma.market.findUniqueOrThrow({
    where: { id: marketId },
    include: { outcomes: { orderBy: { sortOrder: "asc" } } },
  });

  const editable =
    market.status === MarketStatus.PROPOSED ||
    market.status === MarketStatus.DRAFT ||
    (market.status === MarketStatus.OPEN && market.firstBetAt === null);

  if (!editable) {
    throw new Error("Markets cannot be edited after the first bet.");
  }

  validateMarketDraft(input);

  if (input.outcomes) {
    validateOutcomeDrafts(input.outcomes);
    // the outcome count is fixed at creation; labels/colors stay editable
    // until the first bet, and rows keep their sortOrder (no reordering)
    if (input.outcomes.length !== market.outcomes.length) {
      throw new Error("The number of outcomes is fixed once a market is created.");
    }
  }

  await prisma.$transaction([
    prisma.market.update({
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
    }),
    ...(input.outcomes ?? []).map((outcome, index) =>
      prisma.outcome.update({
        where: { id: market.outcomes[index].id },
        data: {
          label: outcome.label.trim(),
          color: outcome.color,
          emoji: outcome.emoji?.trim() || null,
        },
      }),
    ),
  ]);

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

function toOutcomeStakes(stakes: Array<{ userId: string; outcomeId: string; amount: number }>): OutcomeStake[] {
  return stakes.map((stake) => ({
    userId: stake.userId,
    outcomeId: stake.outcomeId,
    amount: stake.amount,
  }));
}

async function writeSettlement(input: {
  marketId: string;
  adminId: string;
  /** null = cancel: refund everyone */
  winningOutcomeId: string | null;
  resolutionSource: string;
  notes?: string;
  toStatus: MarketStatus;
}) {
  return withSerializableRetry(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: input.marketId },
      include: { outcomes: { orderBy: { sortOrder: "asc" } } },
    });

    if (!market) {
      throw new Error("Market not found.");
    }

    const canceling = input.winningOutcomeId === null;

    if (canceling) {
      if (market.status === MarketStatus.RESOLVED || market.status === MarketStatus.CANCELED) {
        throw new Error("This market cannot be canceled.");
      }
    } else if (market.status !== MarketStatus.OPEN && market.status !== MarketStatus.CLOSED) {
      throw new Error("Only open or closed markets can be resolved.");
    }

    // trust boundary: the winning outcome must belong to this market. A
    // foreign outcome id would make W = 0 and silently refund the market.
    const winningOutcome = canceling
      ? null
      : (market.outcomes.find((outcome) => outcome.id === input.winningOutcomeId) ?? null);
    if (!canceling && !winningOutcome) {
      throw new Error("That outcome doesn't belong to this market.");
    }

    const stakes = toOutcomeStakes(
      await tx.poolStake.findMany({ where: { marketId: input.marketId } }),
    );

    // per-outcome pool cross-check — a total-only comparison cannot catch a
    // stake row pointing at another market's outcome
    for (const outcome of market.outcomes) {
      const stakeSum = stakes
        .filter((stake) => stake.outcomeId === outcome.id)
        .reduce((sum, stake) => sum + stake.amount, 0);
      if (stakeSum !== outcome.pool) {
        throw new Error(`Stake sum for "${outcome.label}" does not match its pool.`);
      }
    }

    const knownOutcomeIds = new Set(market.outcomes.map((outcome) => outcome.id));
    if (stakes.some((stake) => !knownOutcomeIds.has(stake.outcomeId))) {
      throw new Error("A stake row points at an outcome outside this market.");
    }

    const result: SettlementResult = canceling
      ? computeCancelRefunds(stakes)
      : computeSettlement(stakes, input.winningOutcomeId!, market.rakeBps);

    // conservation is re-checked at runtime before anything is written —
    // a math regression aborts the transaction instead of corrupting the ledger
    if (!checkConservation(result)) {
      throw new Error("Settlement failed conservation check.");
    }

    const poolTotal = market.outcomes.reduce((sum, outcome) => sum + outcome.pool, 0);
    if (result.totalIn !== poolTotal) {
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
              : `Payout for ${winningOutcome!.label} — ${market.title}`,
        })),
      });
    }

    // freeze the pools so the settlement audit stays in typed ints
    for (const outcome of market.outcomes) {
      await tx.outcome.update({
        where: { id: outcome.id },
        data: { poolFinal: outcome.pool },
      });
    }

    const legacyEnum = legacyOutcomeEnum(market.outcomes, input.winningOutcomeId);
    const isBinary = market.outcomes.length === 2;

    await tx.market.update({
      where: { id: input.marketId },
      data: {
        status: input.toStatus,
        winningOutcomeId: input.winningOutcomeId,
        finalOutcome: legacyEnum,
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
        winningOutcomeId: input.winningOutcomeId,
        outcome: legacyEnum,
        resolutionSource: input.resolutionSource,
        notes: input.notes,
        yesPoolFinal: isBinary ? market.outcomes[0].pool : null,
        noPoolFinal: isBinary ? market.outcomes[1].pool : null,
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
  winningOutcomeId: string,
  resolutionSource: string,
  notes?: string,
) {
  const market = await prisma.market.findUniqueOrThrow({
    where: { id: marketId },
    include: { outcomes: true },
  });

  const result = await writeSettlement({
    marketId,
    adminId,
    winningOutcomeId,
    resolutionSource,
    notes,
    toStatus: MarketStatus.RESOLVED,
  });

  const winnerLabel =
    market.outcomes.find((outcome) => outcome.id === winningOutcomeId)?.label ?? winningOutcomeId;

  await logAdminAction(`Resolved market ${market.title} to ${winnerLabel}`, adminId, marketId, {
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
      winningOutcomeId: null,
      resolutionSource: market.resolutionSource,
      notes: reason,
      toStatus: MarketStatus.CANCELED,
    });
  }

  await logAdminAction(`Canceled market: ${market.title}`, adminId, marketId, { reason });
}

export type SettlementPreviewRow = {
  userId: string;
  name: string;
  staked: number;
  winningStake: number;
  payout: number;
  profit: number;
};

/** Dry-run settlement for the admin resolve form — computes payouts without writing. */
export async function previewSettlement(marketId: string, winningOutcomeId: string) {
  const market = await prisma.market.findUniqueOrThrow({
    where: { id: marketId },
    include: { outcomes: true },
  });

  if (!market.outcomes.some((outcome) => outcome.id === winningOutcomeId)) {
    throw new Error("That outcome doesn't belong to this market.");
  }

  const stakes = await prisma.poolStake.findMany({
    where: { marketId },
    include: { user: { select: { name: true } } },
  });

  const result = computeSettlement(toOutcomeStakes(stakes), winningOutcomeId, market.rakeBps);
  const payoutByUser = new Map(result.payouts.map((payout) => [payout.userId, payout]));

  const byUser = new Map<string, SettlementPreviewRow>();
  for (const stake of stakes) {
    if (stake.amount === 0) {
      continue;
    }
    const row = byUser.get(stake.userId) ?? {
      userId: stake.userId,
      name: stake.user.name,
      staked: 0,
      winningStake: 0,
      payout: 0,
      profit: 0,
    };
    row.staked += stake.amount;
    if (stake.outcomeId === winningOutcomeId) {
      row.winningStake += stake.amount;
    }
    byUser.set(stake.userId, row);
  }

  const rows = [...byUser.values()]
    .map((row) => {
      const payout = payoutByUser.get(row.userId)?.amount ?? 0;
      return { ...row, payout, profit: payout - row.staked };
    })
    .sort((a, b) => b.payout - a.payout || a.name.localeCompare(b.name));

  return { rows, rake: result.rake, dust: result.dust, mode: result.mode };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type ReplayBet = { outcomeId: string; amount: number };

/**
 * Replay bets (already ordered by [createdAt, id]) over zeroed pools and
 * report each outcome's probability after every bet. Row 0 is the 1/N prior.
 */
function replayProbabilities(outcomes: OutcomeRow[], bets: ReplayBet[]) {
  const pools = new Map(outcomes.map((outcome) => [outcome.id, 0]));
  let total = 0;
  const prior = outcomes.map(() => 1 / outcomes.length);

  const frames: number[][] = [prior];
  for (const bet of bets) {
    if (!pools.has(bet.outcomeId)) {
      continue;
    }
    pools.set(bet.outcomeId, (pools.get(bet.outcomeId) ?? 0) + bet.amount);
    total += bet.amount;
    frames.push(
      outcomes.map((outcome) =>
        total > 0 ? (pools.get(outcome.id) ?? 0) / total : 1 / outcomes.length,
      ),
    );
  }

  return frames;
}

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
      outcomes: { orderBy: { sortOrder: "asc" } },
      poolStakes: {
        where: { amount: { gt: 0 } },
        select: { userId: true, outcomeId: true, amount: true },
      },
      bets: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { outcomeId: true, amount: true },
      },
    },
    orderBy: { closeTime: "asc" },
  });

  return markets.map((market) => {
    const odds = getMarketOdds(market.outcomes);
    const labelById = new Map(
      market.outcomes.map((outcome) => [outcome.id, outcomeDisplayLabel(outcome)]),
    );

    // sparkline: the current leader's probability over time — except the
    // classic Yes/No preset, which always charts the Yes side like the old app
    const leaderIndex = isYesNoMarket(odds.outcomes)
      ? 0
      : odds.outcomes.findIndex((outcome) => outcome.id === odds.leader.id);
    const frames = replayProbabilities(market.outcomes, market.bets);
    const sparkPoints = frames.map((frame) => frame[leaderIndex]);

    const viewerStakes = market.poolStakes
      .filter((stake) => stake.userId === userId)
      .map((stake) => ({
        outcomeId: stake.outcomeId,
        label: labelById.get(stake.outcomeId) ?? "?",
        amount: stake.amount,
      }));

    return {
      id: market.id,
      title: market.title,
      category: market.category,
      closeTime: market.closeTime,
      status: market.status,
      outcomes: odds.outcomes,
      leader: odds.leader,
      leaderTied: odds.leaderTied,
      pot: odds.pot,
      participants: new Set(market.poolStakes.map((stake) => stake.userId)).size,
      sparkPoints,
      viewerStakes,
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
      outcomes: { orderBy: { sortOrder: "asc" } },
      poolStakes: {
        include: { user: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
      },
      bets: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
      _count: { select: { bets: true } },
    },
  });

  if (!market) {
    return null;
  }

  const odds = getMarketOdds(market.outcomes);
  const outcomeById = new Map(odds.outcomes.map((outcome) => [outcome.id, outcome]));
  const openedAt = market.openedAt ?? market.createdAt;

  // full replay, ordered [createdAt, id] — bets are already loaded here
  const frames = replayProbabilities(market.outcomes, market.bets);
  const oddsHistory = [
    { t: openedAt.getTime(), probs: frames[0] },
    ...market.bets.map((bet, index) => ({ t: bet.createdAt.getTime(), probs: frames[index + 1] })),
  ];

  const activity = [...market.bets]
    .reverse()
    .slice(0, 30)
    .map((bet) => ({
      id: bet.id,
      userName: bet.user.name,
      outcomeLabel: outcomeDisplayLabel(outcomeById.get(bet.outcomeId) ?? { label: "?" }),
      outcomeColor: outcomeById.get(bet.outcomeId)?.color ?? "blue",
      amount: bet.amount,
      probabilityAfter: bet.totalPoolAfter > 0 ? bet.outcomePoolAfter / bet.totalPoolAfter : 0,
      createdAt: bet.createdAt,
    }));

  const settlementByUser = new Map<string, number>();
  for (const entry of market.ledgerEntries) {
    settlementByUser.set(entry.userId, (settlementByUser.get(entry.userId) ?? 0) + entry.amount);
  }

  const isCanceled = market.status === MarketStatus.CANCELED;
  const isResolved = market.status === MarketStatus.RESOLVED;

  const byUser = new Map<
    string,
    { userId: string; name: string; stakes: Map<string, number>; staked: number }
  >();
  for (const stake of market.poolStakes) {
    if (stake.amount === 0) {
      continue;
    }
    const row = byUser.get(stake.userId) ?? {
      userId: stake.userId,
      name: stake.user.name,
      stakes: new Map<string, number>(),
      staked: 0,
    };
    row.stakes.set(stake.outcomeId, (row.stakes.get(stake.outcomeId) ?? 0) + stake.amount);
    row.staked += stake.amount;
    byUser.set(stake.userId, row);
  }

  const positions = [...byUser.values()]
    .map((row) => {
      const settled = settlementByUser.get(row.userId) ?? 0;
      let resultLabel: string | null = null;

      if (isCanceled) {
        resultLabel = "Refunded";
      } else if (isResolved && market.winningOutcomeId) {
        resultLabel = (row.stakes.get(market.winningOutcomeId) ?? 0) > 0 ? "Won" : "Lost";
      }

      return {
        userId: row.userId,
        name: row.name,
        stakes: odds.outcomes.map((outcome) => ({
          outcomeId: outcome.id,
          amount: row.stakes.get(outcome.id) ?? 0,
        })),
        staked: row.staked,
        potShare: odds.pot > 0 ? row.staked / odds.pot : 0,
        settlementAmount: settled,
        profit: settled - row.staked,
        resultLabel,
      };
    })
    .sort((a, b) => b.staked - a.staked || a.name.localeCompare(b.name));

  const viewerStakes = odds.outcomes
    .map((outcome) => ({
      outcomeId: outcome.id,
      amount:
        market.poolStakes.find(
          (stake) => stake.userId === userId && stake.outcomeId === outcome.id,
        )?.amount ?? 0,
    }))
    .filter((stake) => stake.amount > 0);

  return {
    id: market.id,
    title: market.title,
    description: market.description,
    category: market.category,
    closeTime: market.closeTime,
    resolveTime: market.resolveTime,
    resolutionSource: market.resolutionSource,
    status: market.status,
    winningOutcomeId: market.winningOutcomeId,
    winningOutcome: market.winningOutcomeId
      ? (outcomeById.get(market.winningOutcomeId) ?? null)
      : null,
    rakeBps: market.rakeBps,
    maxStakePerUser: market.maxStakePerUser,
    openedAt: market.openedAt,
    createdAt: market.createdAt,
    outcomes: odds.outcomes,
    leader: odds.leader,
    leaderTied: odds.leaderTied,
    pot: odds.pot,
    participantCount: byUser.size,
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
    viewerStakes,
  };
}

export async function getActiveStakes(userId: string) {
  const stakes = await prisma.poolStake.findMany({
    where: {
      userId,
      amount: { gt: 0 },
      market: { status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] } },
    },
    include: { market: { include: { outcomes: { orderBy: { sortOrder: "asc" } } } } },
    orderBy: { updatedAt: "desc" },
  });

  const byMarket = new Map<string, typeof stakes>();
  for (const stake of stakes) {
    const list = byMarket.get(stake.marketId) ?? [];
    list.push(stake);
    byMarket.set(stake.marketId, list);
  }

  return [...byMarket.values()].map((marketStakes) => {
    const market = marketStakes[0].market;
    const odds = getMarketOdds(market.outcomes);
    const outcomeById = new Map(odds.outcomes.map((outcome) => [outcome.id, outcome]));

    const positions = marketStakes
      .map((stake) => {
        const outcome = outcomeById.get(stake.outcomeId)!;
        return {
          outcomeId: stake.outcomeId,
          label: outcome.label,
          color: outcome.color,
          emoji: outcome.emoji,
          amount: stake.amount,
          probability: outcome.probability,
          ifWon: estimatePayout({
            stake: stake.amount,
            winningPool: outcome.pool,
            losingPool: odds.pot - outcome.pool,
            rakeBps: market.rakeBps,
          }),
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return {
      marketId: market.id,
      title: market.title,
      category: market.category,
      status: market.status,
      closeTime: market.closeTime,
      leader: odds.leader,
      leaderTied: odds.leaderTied,
      positions,
      staked: positions.reduce((sum, position) => sum + position.amount, 0),
      ifAllWon: positions.reduce((sum, position) => sum + position.ifWon, 0),
    };
  });
}

export async function getResolvedStakes(userId: string) {
  const stakes = await prisma.poolStake.findMany({
    where: {
      userId,
      amount: { gt: 0 },
      market: { status: { in: [MarketStatus.RESOLVED, MarketStatus.CANCELED] } },
    },
    include: {
      market: {
        include: {
          outcomes: { orderBy: { sortOrder: "asc" } },
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

  const byMarket = new Map<string, typeof stakes>();
  for (const stake of stakes) {
    const list = byMarket.get(stake.marketId) ?? [];
    list.push(stake);
    byMarket.set(stake.marketId, list);
  }

  return [...byMarket.values()].map((marketStakes) => {
    const market = marketStakes[0].market;
    const staked = marketStakes.reduce((sum, stake) => sum + stake.amount, 0);
    const settled = sumLedgerAmounts(market.ledgerEntries);
    const canceled = market.status === MarketStatus.CANCELED;
    const winningOutcome = market.outcomes.find((outcome) => outcome.id === market.winningOutcomeId);

    return {
      marketId: market.id,
      title: market.title,
      category: market.category,
      status: market.status,
      canceled,
      winningLabel: winningOutcome ? outcomeDisplayLabel(winningOutcome) : null,
      winningColor: winningOutcome?.color ?? null,
      resolvedAt: market.resolvedAt ?? market.canceledAt,
      staked,
      settled,
      profit: settled - staked,
      won: canceled
        ? null
        : marketStakes.some((stake) => stake.outcomeId === market.winningOutcomeId),
    };
  });
}

export async function getBetHistory(userId: string) {
  return prisma.bet.findMany({
    where: { userId },
    include: {
      market: { select: { id: true, title: true, status: true } },
      outcome: { select: { label: true, color: true, emoji: true } },
    },
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
      outcome: { select: { label: true, color: true, emoji: true } },
    },
  });

  return bets.map((bet) => ({
    id: bet.id,
    userName: bet.user.name,
    outcomeLabel: outcomeDisplayLabel(bet.outcome),
    outcomeColor: bet.outcome.color,
    amount: bet.amount,
    probabilityAfter: bet.totalPoolAfter > 0 ? bet.outcomePoolAfter / bet.totalPoolAfter : 0,
    marketId: bet.market.id,
    marketTitle: bet.market.title,
    createdAt: bet.createdAt,
  }));
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
    select: { userId: true, amount: true },
  });

  const sumsByUser = new Map<string, Map<LedgerEntryType, number>>();
  for (const row of ledgerSums) {
    const perType = sumsByUser.get(row.userId) ?? new Map<LedgerEntryType, number>();
    perType.set(row.type, row._sum.amount ?? 0);
    sumsByUser.set(row.userId, perType);
  }

  const atRiskByUser = new Map<string, number>();
  for (const stake of openStakes) {
    atRiskByUser.set(stake.userId, (atRiskByUser.get(stake.userId) ?? 0) + stake.amount);
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
      outcomes: { orderBy: { sortOrder: "asc" } },
      poolStakes: { where: { amount: { gt: 0 } }, select: { userId: true } },
      _count: { select: { bets: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return markets.map((market) => ({
    ...market,
    ...getMarketOdds(market.outcomes),
    betCount: market._count.bets,
    participantCount: new Set(market.poolStakes.map((stake) => stake.userId)).size,
  }));
}

export async function listProposals() {
  return prisma.market.findMany({
    where: { status: MarketStatus.PROPOSED },
    include: { outcomes: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getAdminMarketDetail(marketId: string) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      outcomes: { orderBy: { sortOrder: "asc" } },
      resolution: true,
      bets: {
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, email: true } },
          outcome: { select: { label: true, color: true, emoji: true } },
        },
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

  const odds = getMarketOdds(market.outcomes);

  const settlementByUser = new Map<string, number>();
  for (const entry of market.ledgerEntries) {
    settlementByUser.set(entry.userId, (settlementByUser.get(entry.userId) ?? 0) + entry.amount);
  }

  type StakeRow = {
    userId: string;
    name: string;
    email: string;
    stakes: Map<string, number>;
    staked: number;
  };
  const byUser = new Map<string, StakeRow>();
  for (const stake of market.poolStakes) {
    if (stake.amount === 0) {
      continue;
    }
    const row = byUser.get(stake.userId) ?? {
      userId: stake.userId,
      name: stake.user.name,
      email: stake.user.email,
      stakes: new Map<string, number>(),
      staked: 0,
    };
    row.stakes.set(stake.outcomeId, (row.stakes.get(stake.outcomeId) ?? 0) + stake.amount);
    row.staked += stake.amount;
    byUser.set(stake.userId, row);
  }

  const stakeRows = [...byUser.values()]
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      staked: row.staked,
      stakes: odds.outcomes.map((outcome) => ({
        outcomeId: outcome.id,
        label: outcome.label,
        color: outcome.color,
        emoji: outcome.emoji,
        amount: row.stakes.get(outcome.id) ?? 0,
      })),
      settlementAmount: settlementByUser.get(row.userId) ?? 0,
      profit: (settlementByUser.get(row.userId) ?? 0) - row.staked,
    }))
    .sort((a, b) => b.staked - a.staked);

  return {
    ...market,
    ...getMarketOdds(market.outcomes),
    winningOutcome: market.winningOutcomeId
      ? (market.outcomes.find((outcome) => outcome.id === market.winningOutcomeId) ?? null)
      : null,
    stakeRows,
    settlementRows:
      market.status === MarketStatus.RESOLVED || market.status === MarketStatus.CANCELED
        ? stakeRows.sort((a, b) => b.settlementAmount - a.settlementAmount)
        : [],
  };
}
