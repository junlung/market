"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

// Bump the version suffix to re-show a revised notice to everyone.
const STORAGE_KEY = "beta-notice-v1";

export function BetaNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === null) setVisible(true);
    } catch {
      // localStorage unavailable (e.g. private mode) — keep the notice hidden
      // rather than showing it on every load with no way to dismiss it.
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // best effort — dismissal still applies for this page view
    }
    setVisible(false);
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
      <p className="flex-1">
        <span className="font-semibold">ProllyMarket is in beta.</span> Everything is subject to
        change, expect the occasional bug or weird behavior, and the points/gems economy may get
        reset if needed. Thanks for being a guinea pig.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 transition-opacity hover:opacity-70"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
