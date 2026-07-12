import { describe, expect, it } from "vitest";
import { suggestUsername } from "@/lib/username";
import { usernameValueSchema } from "@/lib/validation";

describe("usernameValueSchema", () => {
  it("accepts simple handles", () => {
    expect(usernameValueSchema.parse("alex")).toBe("alex");
    expect(usernameValueSchema.parse("dana-99")).toBe("dana-99");
    expect(usernameValueSchema.parse("a1c")).toBe("a1c");
  });

  it("normalizes case and whitespace", () => {
    expect(usernameValueSchema.parse("  Alex ")).toBe("alex");
  });

  it("rejects handles outside the length bounds", () => {
    expect(usernameValueSchema.safeParse("ab").success).toBe(false);
    expect(usernameValueSchema.safeParse("a".repeat(21)).success).toBe(false);
    expect(usernameValueSchema.safeParse("a".repeat(20)).success).toBe(true);
  });

  it("rejects invalid characters and hyphen placement", () => {
    for (const bad of ["-alex", "alex-", "al ex", "al_ex", "al.ex", "aléx", "@alex"]) {
      expect(usernameValueSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects reserved handles", () => {
    for (const reserved of ["admin", "markets", "account", "me"]) {
      expect(usernameValueSchema.safeParse(reserved).success).toBe(false);
    }
  });
});

describe("suggestUsername", () => {
  it("slugifies display names", () => {
    expect(suggestUsername("League Admin")).toBe("league-admin");
    expect(suggestUsername("Alex")).toBe("alex");
  });

  it("collapses non-alphanumeric runs and trims hyphens", () => {
    expect(suggestUsername("  Dr. J.  ")).toBe("dr-j");
    expect(suggestUsername("émil // the great")).toBe("mil-the-great");
  });

  it("falls back to 'player' when nothing usable survives", () => {
    expect(suggestUsername("🔥🔥")).toBe("player");
    expect(suggestUsername("J")).toBe("player");
  });

  it("clamps to the max length without a trailing hyphen", () => {
    const suggestion = suggestUsername("a very long display name indeed");
    expect(suggestion.length).toBeLessThanOrEqual(20);
    expect(suggestion.endsWith("-")).toBe(false);
  });
});
