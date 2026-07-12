"use client";

import { useActionState, useState } from "react";
import { createSeasonAction, type SeasonFormState } from "@/app/actions/leagues";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initialState: SeasonFormState = {};

function toInputDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

/** Friday 17:00 → Sunday 21:00, local time — the weekend-trip preset. */
function nextWeekend(now: Date) {
  const start = new Date(now);
  const daysUntilFriday = (5 - start.getDay() + 7) % 7;
  start.setDate(start.getDate() + daysUntilFriday);
  start.setHours(17, 0, 0, 0);
  if (start <= now) {
    start.setTime(now.getTime());
  }
  const end = new Date(start);
  end.setDate(end.getDate() + (7 - end.getDay()) % 7 || 2);
  end.setHours(21, 0, 0, 0);
  return { start, end };
}

const PRESETS = [
  { id: "week", label: "One week" },
  { id: "month", label: "One month" },
  { id: "weekend", label: "This weekend" },
] as const;

export function SeasonForm({ leagueId, slug }: { leagueId: string; slug: string }) {
  const [state, formAction, pending] = useActionState(createSeasonAction, initialState);
  const now = new Date();
  const [startsAt, setStartsAt] = useState(toInputDateTime(now));
  const [endsAt, setEndsAt] = useState(toInputDateTime(addDays(now, 7)));

  function applyPreset(id: (typeof PRESETS)[number]["id"]) {
    const current = new Date();
    if (id === "weekend") {
      const { start, end } = nextWeekend(current);
      setStartsAt(toInputDateTime(start));
      setEndsAt(toInputDateTime(end));
      return;
    }
    setStartsAt(toInputDateTime(current));
    setEndsAt(toInputDateTime(addDays(current, id === "week" ? 7 : 30)));
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="slug" value={slug} />

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyPreset(preset.id)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="sf-name">Name (optional)</Label>
          <Input id="sf-name" name="name" placeholder="Season 1" maxLength={60} />
          <FieldError message={state.fieldErrors?.name} />
        </div>
        <div>
          <Label htmlFor="sf-starts">Starts</Label>
          <Input
            id="sf-starts"
            name="startsAt"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            required
          />
          <FieldError message={state.fieldErrors?.startsAt} />
        </div>
        <div>
          <Label htmlFor="sf-ends">Ends</Label>
          <Input
            id="sf-ends"
            name="endsAt"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            required
          />
          <FieldError message={state.fieldErrors?.endsAt} />
        </div>
      </div>

      <FieldError message={state.error} />
      {state.success ? <p className="text-sm text-yes">{state.success}</p> : null}

      <Button type="submit" variant="yes" disabled={pending}>
        {pending ? "Starting…" : "Start season"}
      </Button>
      <p className="text-xs text-faint">
        Starting a season deals every member the league&apos;s starting stack. A future start date
        opens automatically on the day.
      </p>
    </form>
  );
}
