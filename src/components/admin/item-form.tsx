"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ItemKind } from "@prisma/client";
import { createItemAction, updateItemAction } from "@/app/actions/items";
import { EmojiPicker } from "@/components/admin/emoji-picker";
import { BadgeGlyph, ProfileBanner, TitleLine } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { parseItemStyle } from "@/lib/cosmetics";

const PREVIEW_NAME = "Alex Johnson";

const KIND_OPTIONS: Array<{ value: ItemKind; label: string }> = [
  { value: "FRAME", label: "Frame — ring/glow around the avatar" },
  { value: "BADGE", label: "Badge — glyph next to the name" },
  { value: "TITLE", label: "Title — line under the name" },
  { value: "BACKGROUND", label: "Banner — profile header backdrop" },
  { value: "TROPHY", label: "Trophy — display-only, trophy case" },
];

/** Structured style state — a superset of every kind's fields. */
type StyleState = {
  // FRAME
  ring: string;
  ring2: string;
  useRing2: boolean;
  glow: string;
  useGlow: boolean;
  animate: "none" | "pulse";
  // BADGE / TROPHY emoji
  glyph: string;
  // TITLE
  text: string;
  titleMode: "plain" | "solid" | "gradient";
  color: string;
  gradientFrom: string;
  gradientTo: string;
  // BACKGROUND
  from: string;
  to: string;
  direction: "to-r" | "to-br" | "to-b";
  // TROPHY
  trophyMode: "emoji" | "model3d";
  modelSrc: string;
  fallbackEmoji: string;
};

const DEFAULT_STYLE: StyleState = {
  ring: "#eab308",
  ring2: "#06b6d4",
  useRing2: false,
  glow: "#facc15",
  useGlow: false,
  animate: "none",
  glyph: "🔥",
  text: "High Roller",
  titleMode: "solid",
  color: "#eab308",
  gradientFrom: "#8b5cf6",
  gradientTo: "#06b6d4",
  from: "#4c1d95",
  to: "#be185d",
  direction: "to-r",
  trophyMode: "emoji",
  modelSrc: "/models/trophy.glb",
  fallbackEmoji: "🏆",
};

/** Compile the structured state into the kind's style Json. */
function compileStyle(kind: ItemKind, s: StyleState): Record<string, unknown> {
  switch (kind) {
    case "FRAME":
      return {
        renderer: "css",
        ring: s.ring,
        ...(s.useRing2 ? { ring2: s.ring2 } : {}),
        ...(s.useGlow ? { glow: s.glow } : {}),
        ...(s.animate !== "none" ? { animate: s.animate } : {}),
      };
    case "BADGE":
      return { renderer: "emoji", glyph: s.glyph };
    case "TITLE":
      return {
        renderer: "css",
        text: s.text,
        ...(s.titleMode === "solid" ? { color: s.color } : {}),
        ...(s.titleMode === "gradient" ? { gradient: [s.gradientFrom, s.gradientTo] } : {}),
      };
    case "BACKGROUND":
      return { renderer: "css", from: s.from, to: s.to, direction: s.direction };
    case "TROPHY":
      return s.trophyMode === "model3d"
        ? { renderer: "model3d", src: s.modelSrc, fallbackEmoji: s.fallbackEmoji }
        : { renderer: "emoji", emoji: s.glyph };
  }
}

/** Rehydrate structured state from a valid style Json (raw-editor round trip). */
function hydrateStyle(kind: ItemKind, style: unknown, current: StyleState): StyleState {
  const parsed = parseItemStyle(kind, style);
  if (!parsed) {
    return current;
  }
  const next = { ...current };
  switch (parsed.kind) {
    case "FRAME":
      next.ring = parsed.style.ring;
      next.useRing2 = Boolean(parsed.style.ring2);
      if (parsed.style.ring2) next.ring2 = parsed.style.ring2;
      next.useGlow = Boolean(parsed.style.glow);
      if (parsed.style.glow) next.glow = parsed.style.glow;
      next.animate = parsed.style.animate ?? "none";
      break;
    case "BADGE":
      next.glyph = parsed.style.glyph;
      break;
    case "TITLE":
      next.text = parsed.style.text;
      next.titleMode = parsed.style.gradient ? "gradient" : parsed.style.color ? "solid" : "plain";
      if (parsed.style.color) next.color = parsed.style.color;
      if (parsed.style.gradient) {
        next.gradientFrom = parsed.style.gradient[0];
        next.gradientTo = parsed.style.gradient[1];
      }
      break;
    case "BACKGROUND":
      next.from = parsed.style.from;
      next.to = parsed.style.to;
      next.direction = parsed.style.direction ?? "to-r";
      break;
    case "TROPHY":
      next.trophyMode = parsed.style.renderer;
      if (parsed.style.renderer === "emoji") {
        next.glyph = parsed.style.emoji;
      } else {
        next.modelSrc = parsed.style.src;
        next.fallbackEmoji = parsed.style.fallbackEmoji ?? "🏆";
      }
      break;
  }
  return next;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888"}
        onChange={(event) => onChange(event.target.value)}
        className="size-7 cursor-pointer rounded border border-border bg-surface p-0.5"
      />
      <span className="w-16">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-24 font-mono text-xs"
        maxLength={7}
      />
    </label>
  );
}

export type ItemFormItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: ItemKind;
  storeCost: number | null;
  active: boolean;
  style: unknown;
};

export function ItemForm({ item }: { item?: ItemFormItem }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState(item?.slug ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "FRAME");
  const [storeCost, setStoreCost] = useState(item?.storeCost?.toString() ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [style, setStyle] = useState<StyleState>(() =>
    item ? hydrateStyle(item.kind, item.style, DEFAULT_STYLE) : DEFAULT_STYLE,
  );

  // raw-Json escape hatch: the textarea owns the string while open; a valid
  // parse rehydrates the structured fields, an invalid one shows the error
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);

  const compiled = useMemo(() => compileStyle(kind, style), [kind, style]);
  const parsed = useMemo(() => parseItemStyle(kind, compiled), [kind, compiled]);

  function openRaw() {
    setRawText(JSON.stringify(compiled, null, 2));
    setRawError(null);
    setRawOpen(true);
  }

  function onRawChange(value: string) {
    setRawText(value);
    try {
      const json = JSON.parse(value);
      if (!parseItemStyle(kind, json)) {
        setRawError("Valid JSON, but it doesn't render for this kind.");
        return;
      }
      setRawError(null);
      setStyle((current) => hydrateStyle(kind, json, current));
    } catch {
      setRawError("Not valid JSON yet.");
    }
  }

  function submit() {
    startTransition(async () => {
      setError(null);
      const formData = new FormData();
      if (item) formData.set("itemId", item.id);
      formData.set("slug", slug);
      formData.set("name", name);
      formData.set("description", description);
      formData.set("kind", kind);
      formData.set("storeCost", storeCost);
      formData.set("active", active ? "on" : "");
      formData.set("style", JSON.stringify(compiled));

      const action = item ? updateItemAction : createItemAction;
      const result = await action({}, formData);
      if (result?.error) {
        setError(result.error);
        toast.error(result.error);
      } else if (result?.success) {
        toast.success(result.success);
        router.refresh();
      }
      // createItemAction redirects on success — no result to handle
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form action={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="item-slug">Slug</Label>
            <Input
              id="item-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={Boolean(item)}
              placeholder="frame-gold"
              required
            />
            {item ? <p className="text-[11px] text-faint">Slugs are permanent.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Gold Ring"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="item-description">Description</Label>
          <Textarea
            id="item-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={200}
            required
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="item-kind">Kind</Label>
            <Select
              id="item-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as ItemKind)}
              disabled={Boolean(item)}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {item ? <p className="text-[11px] text-faint">Kind is fixed after creation.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-cost">Store price (gems)</Label>
            <Input
              id="item-cost"
              type="number"
              min={1}
              value={storeCost}
              onChange={(event) => setStoreCost(event.target.value)}
              placeholder="blank = earned only"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-active">Status</Label>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                id="item-active"
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Active (renders + purchasable)
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-2/50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">Style</p>
            <button
              type="button"
              onClick={() => (rawOpen ? setRawOpen(false) : openRaw())}
              className="text-xs font-medium text-primary hover:text-primary-hover"
            >
              {rawOpen ? "Back to fields" : "Edit raw JSON"}
            </button>
          </div>

          {rawOpen ? (
            <div className="mt-3 space-y-1.5">
              <Textarea
                value={rawText}
                onChange={(event) => onRawChange(event.target.value)}
                rows={8}
                className="font-mono text-xs"
                aria-label="Raw style JSON"
              />
              <FieldError message={rawError ?? undefined} />
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {kind === "FRAME" ? (
                <>
                  <ColorField label="Ring" value={style.ring} onChange={(ring) => setStyle({ ...style, ring })} />
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={style.useRing2}
                      onChange={(event) => setStyle({ ...style, useRing2: event.target.checked })}
                      className="size-4"
                    />
                    Two-tone gradient ring
                  </label>
                  {style.useRing2 ? (
                    <ColorField label="Ring 2" value={style.ring2} onChange={(ring2) => setStyle({ ...style, ring2 })} />
                  ) : null}
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={style.useGlow}
                      onChange={(event) => setStyle({ ...style, useGlow: event.target.checked })}
                      className="size-4"
                    />
                    Outer glow
                  </label>
                  {style.useGlow ? (
                    <ColorField label="Glow" value={style.glow} onChange={(glow) => setStyle({ ...style, glow })} />
                  ) : null}
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={style.animate === "pulse"}
                      onChange={(event) =>
                        setStyle({ ...style, animate: event.target.checked ? "pulse" : "none" })
                      }
                      className="size-4"
                    />
                    Pulse animation
                  </label>
                </>
              ) : null}

              {kind === "BADGE" || (kind === "TROPHY" && style.trophyMode === "emoji") ? (
                <div className="flex items-center gap-3">
                  <EmojiPicker
                    value={style.glyph}
                    onChange={(glyph) => setStyle({ ...style, glyph })}
                    label="Pick the glyph"
                  />
                  <span className="text-xs text-muted">
                    {kind === "BADGE" ? "One emoji, shown inline next to names." : "The trophy-case emoji."}
                  </span>
                </div>
              ) : null}

              {kind === "TITLE" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="title-text">Title text</Label>
                    <Input
                      id="title-text"
                      value={style.text}
                      onChange={(event) => setStyle({ ...style, text: event.target.value })}
                      maxLength={24}
                    />
                  </div>
                  <Select
                    value={style.titleMode}
                    onChange={(event) =>
                      setStyle({ ...style, titleMode: event.target.value as StyleState["titleMode"] })
                    }
                    aria-label="Title color mode"
                  >
                    <option value="plain">Muted (default)</option>
                    <option value="solid">Solid color</option>
                    <option value="gradient">Gradient</option>
                  </Select>
                  {style.titleMode === "solid" ? (
                    <ColorField label="Color" value={style.color} onChange={(color) => setStyle({ ...style, color })} />
                  ) : null}
                  {style.titleMode === "gradient" ? (
                    <>
                      <ColorField
                        label="From"
                        value={style.gradientFrom}
                        onChange={(gradientFrom) => setStyle({ ...style, gradientFrom })}
                      />
                      <ColorField
                        label="To"
                        value={style.gradientTo}
                        onChange={(gradientTo) => setStyle({ ...style, gradientTo })}
                      />
                    </>
                  ) : null}
                </>
              ) : null}

              {kind === "BACKGROUND" ? (
                <>
                  <ColorField label="From" value={style.from} onChange={(from) => setStyle({ ...style, from })} />
                  <ColorField label="To" value={style.to} onChange={(to) => setStyle({ ...style, to })} />
                  <Select
                    value={style.direction}
                    onChange={(event) =>
                      setStyle({ ...style, direction: event.target.value as StyleState["direction"] })
                    }
                    aria-label="Gradient direction"
                  >
                    <option value="to-r">Left → right</option>
                    <option value="to-br">Diagonal</option>
                    <option value="to-b">Top → bottom</option>
                  </Select>
                </>
              ) : null}

              {kind === "TROPHY" ? (
                <>
                  <Select
                    value={style.trophyMode}
                    onChange={(event) =>
                      setStyle({ ...style, trophyMode: event.target.value as StyleState["trophyMode"] })
                    }
                    aria-label="Trophy renderer"
                  >
                    <option value="emoji">Emoji</option>
                    <option value="model3d">3D model (renders a placeholder until the viewer ships)</option>
                  </Select>
                  {style.trophyMode === "model3d" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="model-src">Model path (.glb)</Label>
                        <Input
                          id="model-src"
                          value={style.modelSrc}
                          onChange={(event) => setStyle({ ...style, modelSrc: event.target.value })}
                          placeholder="/models/trophy-gold.glb"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <EmojiPicker
                          value={style.fallbackEmoji}
                          onChange={(fallbackEmoji) => setStyle({ ...style, fallbackEmoji })}
                          label="Fallback emoji"
                        />
                        <span className="text-xs text-muted">Fallback while there&apos;s no 3D viewer.</span>
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !parsed}>
            {pending ? "Saving…" : item ? "Save changes" : "Create item"}
          </Button>
          {!parsed ? <p className="text-xs text-no">Style doesn&apos;t render — fix the fields.</p> : null}
          <FieldError message={error ?? undefined} />
        </div>
      </form>

      {/* live preview on a sample identity, at showcase and table-row scale */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Live preview</p>
        <ProfileBanner
          banner={parsed?.kind === "BACKGROUND" ? parsed.style : null}
          className="rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-center gap-3">
            <MemberAvatar
              name={PREVIEW_NAME}
              size="lg"
              frame={parsed?.kind === "FRAME" ? parsed.style : null}
            />
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {PREVIEW_NAME}
                <BadgeGlyph
                  badge={parsed?.kind === "BADGE" ? parsed.style : null}
                  label="Preview badge"
                />
              </p>
              <TitleLine title={parsed?.kind === "TITLE" ? parsed.style : null} />
              <p className="text-xs text-faint">@alex-johnson</p>
            </div>
          </div>
        </ProfileBanner>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="mb-2 text-[11px] text-faint">In a table row:</p>
          <span className="flex items-center gap-2 text-sm font-medium">
            <MemberAvatar
              name={PREVIEW_NAME}
              size="xs"
              frame={parsed?.kind === "FRAME" ? parsed.style : null}
            />
            {PREVIEW_NAME}
            <BadgeGlyph badge={parsed?.kind === "BADGE" ? parsed.style : null} label="Preview badge" />
          </span>
        </div>

        {parsed?.kind === "TROPHY" ? (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl">
              {parsed.style.renderer === "emoji" ? parsed.style.emoji : (parsed.style.fallbackEmoji ?? "🏆")}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {name || "Trophy name"}
                {parsed.style.renderer === "model3d" ? (
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-medium text-faint">3D</span>
                ) : null}
              </p>
              <p className="text-xs text-muted">{description || "Trophy description"}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
