"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import type { LeagueFormState } from "@/app/actions/leagues";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";

const initialState: LeagueFormState = {};

type LeagueValues = {
  id: string;
  name: string;
  description: string | null;
  startingStack: number;
  weeklyAllowance: number;
  defaultRakeBps: number;
  defaultMaxStakePerUser: number;
};

/**
 * Create + settings form for custom leagues. Once the first season starts the
 * economy fields render disabled — the server enforces the same lock.
 */
export function LeagueForm({
  action,
  league,
  settingsLocked = false,
  submitLabel,
}: {
  action: (_: LeagueFormState, formData: FormData) => Promise<LeagueFormState>;
  league?: LeagueValues;
  settingsLocked?: boolean;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-border bg-surface p-5">
      {league ? <input type="hidden" name="leagueId" value={league.id} /> : null}

      <div>
        <Label htmlFor="lf-name">League name</Label>
        <Input
          id="lf-name"
          name="name"
          placeholder="Tahoe Trip 2026"
          defaultValue={league?.name}
          required
          minLength={3}
          maxLength={60}
        />
        <FieldError message={state.fieldErrors?.name} />
      </div>

      <div>
        <Label htmlFor="lf-description">Description (optional)</Label>
        <Textarea
          id="lf-description"
          name="description"
          rows={2}
          maxLength={280}
          placeholder="What's this league about?"
          defaultValue={league?.description ?? ""}
        />
        <FieldError message={state.fieldErrors?.description} />
      </div>

      <fieldset disabled={settingsLocked} className="space-y-4">
        <legend className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
          Economy
          {settingsLocked ? (
            <span className="inline-flex items-center gap-1 normal-case text-warn">
              <Lock className="size-3" aria-hidden /> locked — the first season has started
            </span>
          ) : null}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="lf-stack">Starting stack per season</Label>
            <Input
              id="lf-stack"
              name="startingStack"
              type="number"
              min={1}
              max={1_000_000}
              step={1}
              defaultValue={league?.startingStack ?? 500}
            />
            <FieldError message={state.fieldErrors?.startingStack} />
          </div>
          <div>
            <Label htmlFor="lf-allowance">Weekly allowance (0 = off)</Label>
            <Input
              id="lf-allowance"
              name="weeklyAllowance"
              type="number"
              min={0}
              max={100_000}
              step={1}
              defaultValue={league?.weeklyAllowance ?? 0}
            />
            <FieldError message={state.fieldErrors?.weeklyAllowance} />
          </div>
          <div>
            <Label htmlFor="lf-rake">Rake (basis points)</Label>
            <Input
              id="lf-rake"
              name="defaultRakeBps"
              type="number"
              min={0}
              max={2000}
              step={1}
              defaultValue={league?.defaultRakeBps ?? 500}
            />
            <FieldError message={state.fieldErrors?.defaultRakeBps} />
          </div>
          <div>
            <Label htmlFor="lf-cap">Stake cap per market</Label>
            <Input
              id="lf-cap"
              name="defaultMaxStakePerUser"
              type="number"
              min={1}
              max={100_000}
              step={1}
              defaultValue={league?.defaultMaxStakePerUser ?? 250}
            />
            <FieldError message={state.fieldErrors?.defaultMaxStakePerUser} />
          </div>
        </div>
        {settingsLocked ? (
          // disabled inputs don't submit — resend the locked values so the
          // schema still parses (the server ignores them anyway)
          <>
            <input type="hidden" name="startingStack" value={league?.startingStack} />
            <input type="hidden" name="weeklyAllowance" value={league?.weeklyAllowance} />
            <input type="hidden" name="defaultRakeBps" value={league?.defaultRakeBps} />
            <input type="hidden" name="defaultMaxStakePerUser" value={league?.defaultMaxStakePerUser} />
          </>
        ) : null}
      </fieldset>

      <p className="text-xs leading-relaxed text-faint">
        Every season deals each member the starting stack; markets inherit the rake and stake cap.
        Economy settings lock once the first season starts.
      </p>

      <FieldError message={state.error} />
      {state.success ? <p className="text-sm text-yes">{state.success}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : (submitLabel ?? "Create league")}
      </Button>
    </form>
  );
}
