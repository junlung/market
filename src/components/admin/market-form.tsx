"use client";

import { useActionState, useState } from "react";
import { appConfig } from "@/lib/config";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";

type Props = {
  action: (_: ActionResult, formData: FormData) => Promise<ActionResult>;
  market?: {
    id: string;
    title: string;
    description: string;
    category: string;
    closeTime: Date;
    resolveTime: Date;
    resolutionSource: string;
    maxStakePerUser?: number;
    rakeBps?: number;
  };
  /** Member proposals hide the economy fields — admins set those on review. */
  mode?: "admin" | "propose";
  submitLabel?: string;
};

const initialState: ActionResult = {};

function toInputDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function addHours(base: Date, hours: number) {
  const next = new Date(base);
  next.setHours(next.getHours() + hours);
  return next;
}

const PRESETS = [
  { label: "Close 1d, resolve +1d", close: 24, resolve: 24 },
  { label: "Close 3d, resolve +2d", close: 72, resolve: 48 },
  { label: "Close 1w, resolve +3d", close: 168, resolve: 72 },
  { label: "Close 2w, resolve +1w", close: 336, resolve: 168 },
];

export function MarketForm({ action, market, mode = "admin", submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [closeTime, setCloseTime] = useState(
    market ? toInputDateTime(market.closeTime) : toInputDateTime(addHours(new Date(), 24)),
  );
  const [resolveTime, setResolveTime] = useState(
    market ? toInputDateTime(market.resolveTime) : toInputDateTime(addHours(new Date(), 72)),
  );

  function applyPreset(closeHoursFromNow: number, resolveHoursAfterClose: number) {
    const close = addHours(new Date(), closeHoursFromNow);
    const resolve = addHours(close, resolveHoursAfterClose);
    setCloseTime(toInputDateTime(close));
    setResolveTime(toInputDateTime(resolve));
  }

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-border bg-surface p-5">
      {market ? <input type="hidden" name="marketId" value={market.id} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="mf-title">Question</Label>
          <Input
            id="mf-title"
            name="title"
            defaultValue={market?.title}
            placeholder="Will Dave finish the marathon?"
            required
          />
        </div>
        <div>
          <Label htmlFor="mf-category">Category</Label>
          <Input id="mf-category" name="category" defaultValue={market?.category} placeholder="Sports" required />
        </div>
      </div>

      <div>
        <Label htmlFor="mf-description">Description &amp; resolution criteria</Label>
        <Textarea
          id="mf-description"
          name="description"
          defaultValue={market?.description}
          placeholder="Be precise about what counts as YES — future you will thank you."
          className="min-h-28"
          required
        />
      </div>

      <div className="rounded-lg bg-surface-2 p-3">
        <p className="text-xs font-medium text-muted">Quick schedule</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset(preset.close, preset.resolve)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="mf-close">Betting closes</Label>
          <Input
            id="mf-close"
            type="datetime-local"
            name="closeTime"
            value={closeTime}
            onChange={(event) => setCloseTime(event.target.value)}
            required
          />
          <p className="mt-1 text-xs text-faint">Local timezone.</p>
        </div>
        <div>
          <Label htmlFor="mf-resolve">Resolves by</Label>
          <Input
            id="mf-resolve"
            type="datetime-local"
            name="resolveTime"
            value={resolveTime}
            onChange={(event) => setResolveTime(event.target.value)}
            required
          />
          <p className="mt-1 text-xs text-faint">Must be after close.</p>
        </div>
      </div>

      <div className={mode === "admin" ? "grid gap-4 md:grid-cols-3" : ""}>
        <div>
          <Label htmlFor="mf-source">Resolution source</Label>
          <Input
            id="mf-source"
            name="resolutionSource"
            defaultValue={market?.resolutionSource}
            placeholder="Strava, group vote, official site…"
            required
          />
        </div>
        {mode === "admin" ? (
          <>
            <div>
              <Label htmlFor="mf-cap">Max stake per player</Label>
              <Input
                id="mf-cap"
                type="number"
                min="1"
                step="1"
                name="maxStakePerUser"
                defaultValue={market?.maxStakePerUser ?? appConfig.defaultMaxStakePerUser}
              />
            </div>
            <div>
              <Label htmlFor="mf-rake">Rake (bps, 500 = 5%)</Label>
              <Input
                id="mf-rake"
                type="number"
                min="0"
                max="2000"
                step="1"
                name="rakeBps"
                defaultValue={market?.rakeBps ?? appConfig.rakeBps}
              />
            </div>
          </>
        ) : null}
      </div>

      <FieldError message={state.error} />
      {state.success ? <p className="text-sm text-yes">{state.success}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : (submitLabel ?? (market ? "Save market" : "Create market"))}
        </Button>
        {mode === "admin" && !market ? (
          <Button type="submit" name="openNow" value="true" variant="yes" disabled={pending}>
            {pending ? "Saving…" : "Create & open"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
