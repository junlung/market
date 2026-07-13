import { EquipSlot, ItemKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { KIND_TO_SLOT, parseItemStyle } from "@/lib/cosmetics";

describe("parseItemStyle", () => {
  it("parses every kind's happy path", () => {
    expect(
      parseItemStyle(ItemKind.FRAME, { renderer: "css", ring: "#ffaa00", glow: "#ff0000", animate: "pulse" }),
    ).toMatchObject({ kind: "FRAME", style: { ring: "#ffaa00" } });
    expect(parseItemStyle(ItemKind.BADGE, { renderer: "emoji", glyph: "🔥" })).toMatchObject({
      kind: "BADGE",
      style: { glyph: "🔥" },
    });
    expect(
      parseItemStyle(ItemKind.TITLE, { renderer: "css", text: "The Oracle", gradient: ["#ff00aa", "#00aaff"] }),
    ).toMatchObject({ kind: "TITLE" });
    expect(
      parseItemStyle(ItemKind.BACKGROUND, { renderer: "css", from: "#112233", to: "#445566", direction: "to-br" }),
    ).toMatchObject({ kind: "BACKGROUND" });
    expect(parseItemStyle(ItemKind.TROPHY, { renderer: "emoji", emoji: "🏆" })).toMatchObject({
      kind: "TROPHY",
    });
  });

  it("upgrades legacy trophy styles that predate the renderer discriminant", () => {
    expect(parseItemStyle(ItemKind.TROPHY, { emoji: "🥈" })).toMatchObject({
      kind: "TROPHY",
      style: { renderer: "emoji", emoji: "🥈" },
    });
  });

  it("accepts model3d trophies (rendered as placeholders until the viewer ships)", () => {
    expect(
      parseItemStyle(ItemKind.TROPHY, {
        renderer: "model3d",
        src: "/models/trophy-gold.glb",
        fallbackEmoji: "🏆",
      }),
    ).toMatchObject({ kind: "TROPHY", style: { renderer: "model3d" } });
  });

  it("returns null for junk without throwing", () => {
    for (const junk of [null, undefined, 42, "frame", [], {}, { renderer: "css" }, { renderer: "nope" }]) {
      expect(parseItemStyle(ItemKind.FRAME, junk)).toBeNull();
    }
    // wrong kind's shape
    expect(parseItemStyle(ItemKind.BADGE, { renderer: "css", ring: "#ffaa00" })).toBeNull();
  });

  it("hex-locks colors — CSS injection can't reach inline styles", () => {
    for (const attack of [
      "url(javascript:alert(1))",
      "red; background: url(//evil)",
      "#ffaa00; content: ''",
      "var(--anything)",
      "#ffaa0", // short
    ]) {
      expect(parseItemStyle(ItemKind.FRAME, { renderer: "css", ring: attack })).toBeNull();
      expect(parseItemStyle(ItemKind.BACKGROUND, { renderer: "css", from: attack, to: "#112233" })).toBeNull();
    }
  });

  it("bounds badge glyphs to one grapheme and titles to 24 chars", () => {
    expect(parseItemStyle(ItemKind.BADGE, { renderer: "emoji", glyph: "🔥🔥" })).toBeNull();
    expect(parseItemStyle(ItemKind.BADGE, { renderer: "emoji", glyph: "ab" })).toBeNull();
    expect(
      parseItemStyle(ItemKind.TITLE, { renderer: "css", text: "x".repeat(25) }),
    ).toBeNull();
  });
});

describe("KIND_TO_SLOT", () => {
  it("maps every cosmetic kind and excludes TROPHY", () => {
    expect(KIND_TO_SLOT[ItemKind.FRAME]).toBe(EquipSlot.FRAME);
    expect(KIND_TO_SLOT[ItemKind.BADGE]).toBe(EquipSlot.BADGE);
    expect(KIND_TO_SLOT[ItemKind.TITLE]).toBe(EquipSlot.TITLE);
    expect(KIND_TO_SLOT[ItemKind.BACKGROUND]).toBe(EquipSlot.BACKGROUND);
    expect(KIND_TO_SLOT[ItemKind.TROPHY]).toBeUndefined();
  });
});
