import Link from "next/link";
import { notFound } from "next/navigation";
import { UserStatus } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import { AchievementCard } from "@/components/members/achievement-card";
import { HighlightToggle } from "@/components/members/highlight-toggle";
import { SHOWCASE_LIMIT } from "@/lib/achievements";
import { prisma } from "@/lib/prisma";
import { getAchievementProgress } from "@/lib/server/achievement-service";
import { requireSession } from "@/lib/session";

type Props = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { username } = await params;
  return { title: `@${username.toLowerCase()} · Achievements · ProllyMarket` };
}

export default async function AchievementsPage({ params }: Props) {
  const session = await requireSession();
  const { username } = await params;

  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { id: true, name: true, username: true, status: true },
  });
  if (!user || user.status !== UserStatus.ACTIVE) {
    notFound();
  }

  const own = user.id === session.user.id;
  const progress = await getAchievementProgress(user.id);
  const earnedCount = progress.filter((row) => row.earned).length;

  return (
    <section className="space-y-5">
      <div>
        <Link
          href={`/u/${user.username}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> {user.name}&apos;s profile
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Achievements</h1>
        <p className="text-sm text-muted">
          {earnedCount} of {progress.length} earned
          {own
            ? ` — star up to ${SHOWCASE_LIMIT} to highlight them on your profile.`
            : "."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {progress.map((row) => (
          <AchievementCard
            key={row.def.key}
            progress={row}
            action={
              own && row.earned ? (
                <HighlightToggle achievementKey={row.def.key} showcased={row.showcased} />
              ) : undefined
            }
          />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-faint">
        Achievements are earned in the Global League and pay out gems once each. Some also come
        with a badge for your locker — those can&apos;t be bought at any price.
      </p>
    </section>
  );
}
