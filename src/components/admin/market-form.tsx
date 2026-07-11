"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { appConfig } from "@/lib/config";
import {
  BINARY_PRESET,
  MULTI_OUTCOME_DEAL_ORDER,
  PICKER_COLORS,
  hexContrast,
  isHexColor,
  outcomeColorVar,
  type OutcomeColor,
} from "@/lib/outcome-colors";
import { EmojiPicker } from "@/components/admin/emoji-picker";
import type { MarketFormState } from "@/app/actions/markets";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";

type OutcomeRow = { label: string; color: string; emoji: string };

type Props = {
  action: (_: MarketFormState, formData: FormData) => Promise<MarketFormState>;
  market?: {
    id: string;
    title: string;
    description: string;
    category: string;
    closeTime: Date;
    resolveTime: Date;
    resolutionSource: string;
    outcomes: Array<{ label: string; color: string; emoji?: string | null }>;
    maxStakePerUser?: number;
    rakeBps?: number;
  };
  /** Member proposals hide the economy fields — admins set those on review. */
  mode?: "admin" | "propose";
  submitLabel?: string;
};

const initialState: MarketFormState = {};

const MAX_OUTCOMES = 6;

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

// custom hex colors render as-given in both themes; warn instead of forbid
// when one is likely unreadable (app surfaces: #ffffff light, #161b24 dark)
function customColorWarning(hex: string) {
  if (!isHexColor(hex)) {
    return null;
  }
  const badLight = hexContrast(hex, "#ffffff") < 2.5;
  const badDark = hexContrast(hex, "#161b24") < 2.5;
  if (badLight && badDark) return "hard to read in both themes";
  if (badLight) return "hard to read in light mode";
  if (badDark) return "hard to read in dark mode";
  return null;
}

function nextUnusedColor(rows: OutcomeRow[]): OutcomeColor {
  const used = new Set(rows.map((row) => row.color));
  return (
    MULTI_OUTCOME_DEAL_ORDER.find((color) => !used.has(color)) ??
    PICKER_COLORS.find((color) => !used.has(color)) ??
    MULTI_OUTCOME_DEAL_ORDER[rows.length % MULTI_OUTCOME_DEAL_ORDER.length]
  );
}

export function MarketForm({ action, market, mode = "admin", submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [closeTime, setCloseTime] = useState(
    market ? toInputDateTime(market.closeTime) : toInputDateTime(addHours(new Date(), 24)),
  );
  const [resolveTime, setResolveTime] = useState(
    market ? toInputDateTime(market.resolveTime) : toInputDateTime(addHours(new Date(), 72)),
  );
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>(
    market
      ? market.outcomes.map((o) => ({ label: o.label, color: o.color, emoji: o.emoji ?? "" }))
      : BINARY_PRESET.map((o) => ({ ...o })),
  );
  // the outcome count is fixed once the market exists
  const countLocked = Boolean(market);

  function applyPreset(closeHoursFromNow: number, resolveHoursAfterClose: number) {
    const close = addHours(new Date(), closeHoursFromNow);
    const resolve = addHours(close, resolveHoursAfterClose);
    setCloseTime(toInputDateTime(close));
    setResolveTime(toInputDateTime(resolve));
  }

  function updateOutcome(index: number, patch: Partial<OutcomeRow>) {
    setOutcomes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addOutcome() {
    setOutcomes((rows) => {
      if (rows.length >= MAX_OUTCOMES) {
        return rows;
      }
      // leaving the binary preset: green/red read as win/lose, so re-deal
      // untouched Yes/No rows to the non-semantic hues
      const isUntouchedPreset =
        rows.length === 2 &&
        rows[0].label === BINARY_PRESET[0].label &&
        rows[0].color === BINARY_PRESET[0].color &&
        rows[1].label === BINARY_PRESET[1].label &&
        rows[1].color === BINARY_PRESET[1].color;

      const base = isUntouchedPreset
        ? [
            { label: "", color: MULTI_OUTCOME_DEAL_ORDER[0], emoji: "" },
            { label: "", color: MULTI_OUTCOME_DEAL_ORDER[1], emoji: "" },
          ]
        : rows;

      return [...base, { label: "", color: nextUnusedColor(base), emoji: "" }];
    });
  }

  function removeOutcome(index: number) {
    setOutcomes((rows) => (rows.length > 2 ? rows.filter((_, i) => i !== index) : rows));
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
            placeholder="Who wins the five-a-side tournament?"
            minLength={5}
            required
          />
          <FieldError message={state.fieldErrors?.title} />
        </div>
        <div>
          <Label htmlFor="mf-category">Category</Label>
          <Input
            id="mf-category"
            name="category"
            defaultValue={market?.category}
            placeholder="Sports"
            minLength={2}
            required
          />
          <FieldError message={state.fieldErrors?.category} />
        </div>
      </div>

      <div>
        <Label htmlFor="mf-description">Description &amp; resolution criteria</Label>
        <Textarea
          id="mf-description"
          name="description"
          defaultValue={market?.description}
          placeholder="Be precise about what counts for each outcome — future you will thank you."
          className="min-h-28"
          minLength={10}
          required
        />
        <p className="mt-1 text-xs text-faint">At least 10 characters.</p>
        <FieldError message={state.fieldErrors?.description} />
      </div>

      <div>
        <Label>Outcomes</Label>
        <p className="mb-2 text-xs text-faint">
          2–6 options; exactly one wins. Labels and colors lock in once the first bet lands.
        </p>
        <div className="space-y-3">
          {outcomes.map((outcome, index) => {
            const customActive = isHexColor(outcome.color);
            const warning = customColorWarning(outcome.color);
            return (
              <div key={index} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <input type="hidden" name="outcomeEmoji" value={outcome.emoji} />
                  <EmojiPicker
                    value={outcome.emoji}
                    onChange={(emoji) => updateOutcome(index, { emoji })}
                    label={`Outcome ${index + 1} emoji (optional)`}
                  />
                  <Input
                    name="outcomeLabel"
                    value={outcome.label}
                    onChange={(event) => updateOutcome(index, { label: event.target.value })}
                    placeholder={`Outcome ${index + 1}`}
                    aria-label={`Outcome ${index + 1} label`}
                    maxLength={40}
                    required
                    className="flex-1"
                  />
                  {!countLocked ? (
                    <button
                      type="button"
                      onClick={() => removeOutcome(index)}
                      disabled={outcomes.length <= 2}
                      aria-label={`Remove outcome ${index + 1}`}
                      className="rounded-md p-1 text-faint transition-colors hover:text-no disabled:invisible"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <input type="hidden" name="outcomeColor" value={outcome.color} />
                <div
                  className="mt-2 flex flex-wrap items-center gap-2"
                  role="radiogroup"
                  aria-label={`Outcome ${index + 1} color`}
                >
                  {PICKER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={outcome.color === color}
                      aria-label={color}
                      title={color}
                      onClick={() => updateOutcome(index, { color })}
                      className={clsx(
                        "size-7 rounded-full transition-transform",
                        outcome.color === color
                          ? "scale-110 ring-2 ring-foreground ring-offset-1 ring-offset-surface"
                          : "hover:scale-110",
                      )}
                      style={{ background: outcomeColorVar(color) }}
                    />
                  ))}
                  {/* the escape hatch: any hex via the native color picker */}
                  <label
                    title="Custom color"
                    className={clsx(
                      "relative size-7 cursor-pointer overflow-hidden rounded-full transition-transform",
                      customActive
                        ? "scale-110 ring-2 ring-foreground ring-offset-1 ring-offset-surface"
                        : "hover:scale-110",
                    )}
                    style={{
                      background: customActive
                        ? outcome.color
                        : "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                    }}
                  >
                    <input
                      type="color"
                      value={customActive ? outcome.color : "#4b7db8"}
                      onChange={(event) => updateOutcome(index, { color: event.target.value })}
                      aria-label={`Outcome ${index + 1} custom color`}
                      className="absolute inset-0 size-full cursor-pointer opacity-0"
                    />
                  </label>
                  {warning ? (
                    <span className="ml-1 text-[11px] font-medium text-warn">⚠ {warning}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {!countLocked && outcomes.length < MAX_OUTCOMES ? (
          <Button type="button" variant="secondary" size="sm" onClick={addOutcome} className="mt-2">
            <Plus className="size-3.5" aria-hidden /> Add outcome
          </Button>
        ) : null}
        <FieldError message={state.fieldErrors?.outcomes} />
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
          <FieldError message={state.fieldErrors?.closeTime} />
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
          <FieldError message={state.fieldErrors?.resolveTime} />
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
          <FieldError message={state.fieldErrors?.resolutionSource} />
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
              <FieldError message={state.fieldErrors?.maxStakePerUser} />
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
              <FieldError message={state.fieldErrors?.rakeBps} />
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
