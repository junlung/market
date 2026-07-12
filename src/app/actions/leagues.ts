"use server";

import { LeagueRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createLeague,
  joinLeagueByCode,
  rotateInviteCode,
  setMemberRole,
  updateLeagueSettings,
} from "@/lib/server/league-service";
import type { ActionResult } from "@/lib/server/market-service";
import { createSeason } from "@/lib/server/season-service";
import {
  collectFieldErrors,
  createSeasonSchema,
  joinLeagueSchema,
  leagueFormSchema,
  setLeagueRoleSchema,
} from "@/lib/validation";
import { requireSession } from "@/lib/session";

export type LeagueFormState = ActionResult & {
  fieldErrors?: Record<string, string>;
};

function parseLeagueForm(formData: FormData) {
  return leagueFormSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    startingStack: formData.get("startingStack"),
    weeklyAllowance: formData.get("weeklyAllowance"),
    defaultRakeBps: formData.get("defaultRakeBps"),
    defaultMaxStakePerUser: formData.get("defaultMaxStakePerUser"),
  });
}

export async function createLeagueAction(
  _: LeagueFormState,
  formData: FormData,
): Promise<LeagueFormState> {
  const session = await requireSession();
  const parsed = parseLeagueForm(formData);

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  let slug: string;
  try {
    const league = await createLeague({
      ownerId: session.user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      settings: {
        startingStack: parsed.data.startingStack,
        weeklyAllowance: parsed.data.weeklyAllowance,
        defaultRakeBps: parsed.data.defaultRakeBps,
        defaultMaxStakePerUser: parsed.data.defaultMaxStakePerUser,
      },
    });
    slug = league.slug;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create the league." };
  }

  revalidatePath("/leagues");
  redirect(`/l/${slug}`);
}

export async function joinLeagueAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = joinLeagueSchema.safeParse({ code: formData.get("code") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter the invite code." };
  }

  let slug: string;
  try {
    const league = await joinLeagueByCode(session.user.id, parsed.data.code);
    slug = league.slug;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't join with that code." };
  }

  revalidatePath("/leagues");
  redirect(`/l/${slug}`);
}

export async function rotateInviteCodeAction(formData: FormData) {
  const session = await requireSession();
  const leagueId = String(formData.get("leagueId") ?? "");
  const slug = String(formData.get("slug") ?? "");

  if (!leagueId) {
    return;
  }

  await rotateInviteCode(leagueId, session.user.id);
  revalidatePath(`/l/${slug}/settings`);
}

export async function updateLeagueSettingsAction(
  _: LeagueFormState,
  formData: FormData,
): Promise<LeagueFormState> {
  const session = await requireSession();
  const leagueId = String(formData.get("leagueId") ?? "");
  const parsed = parseLeagueForm(formData);

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  try {
    const league = await updateLeagueSettings(leagueId, session.user.id, {
      name: parsed.data.name,
      description: parsed.data.description,
      settings: {
        startingStack: parsed.data.startingStack,
        weeklyAllowance: parsed.data.weeklyAllowance,
        defaultRakeBps: parsed.data.defaultRakeBps,
        defaultMaxStakePerUser: parsed.data.defaultMaxStakePerUser,
      },
    });
    revalidatePath(`/l/${league.slug}`, "layout");
    revalidatePath("/leagues");
    return { success: "League updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update the league." };
  }
}

export async function setLeagueRoleAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = setLeagueRoleSchema.safeParse({
    leagueId: formData.get("leagueId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: "Invalid role change." };
  }

  const slug = String(formData.get("slug") ?? "");

  try {
    await setMemberRole(
      parsed.data.leagueId,
      session.user.id,
      parsed.data.userId,
      parsed.data.role === "MOD" ? LeagueRole.MOD : LeagueRole.MEMBER,
    );
    revalidatePath(`/l/${slug}/settings`);
    return { success: "Role updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to change that role." };
  }
}

export type SeasonFormState = ActionResult & {
  fieldErrors?: Record<string, string>;
};

export async function createSeasonAction(
  _: SeasonFormState,
  formData: FormData,
): Promise<SeasonFormState> {
  const session = await requireSession();
  const leagueId = String(formData.get("leagueId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const parsed = createSeasonSchema.safeParse({
    name: formData.get("name") || undefined,
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  try {
    const season = await createSeason(leagueId, session.user.id, {
      name: parsed.data.name,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
    });
    revalidatePath(`/l/${slug}`, "layout");
    return {
      success:
        season.status === "ACTIVE"
          ? `${season.name} is live — stacks are dealt.`
          : `${season.name} starts ${season.startsAt.toLocaleDateString()}.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start the season." };
  }
}
