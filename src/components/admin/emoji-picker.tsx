"use client";

import { useState } from "react";
import clsx from "clsx";

/**
 * Curated, dependency-free emoji picker for outcome decoration. A friends
 * league bets on sports, food, and each other — the grid leans that way; the
 * footer input covers anything the grid misses.
 */
const EMOJI_GROUPS: Array<{ name: string; emojis: string[] }> = [
  {
    name: "Sports & games",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🎱", "🏓", "🏸", "🥊", "🥋",
      "⛳", "🏒", "🏏", "🎿", "🏂", "🛹", "🚴", "🏃", "🏊", "🧗", "🏋️", "🤸",
      "🏆", "🥇", "🥈", "🥉", "🎖️", "🎯", "🎳", "🎮", "🕹️", "🎲", "♟️", "🃏",
      "🎰", "🧩", "🪀", "🪁",
    ],
  },
  {
    name: "Animals",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
      "🐷", "🐸", "🐵", "🐔", "🐓", "🐣", "🐧", "🦅", "🦆", "🦉", "🦄", "🐴",
      "🐺", "🐗", "🐝", "🦋", "🐌", "🐢", "🐍", "🦎", "🐙", "🦈", "🐬", "🐳",
      "🐟", "🦀", "🦞", "🐘", "🦒", "🐐", "🐑", "🐎", "🦔", "🦇",
    ],
  },
  {
    name: "Food & drink",
    emojis: [
      "🍕", "🍔", "🍟", "🌭", "🍿", "🥓", "🍳", "🥞", "🧇", "🥐", "🥨", "🧀",
      "🥗", "🌮", "🌯", "🍜", "🍣", "🍤", "🍚", "🍝", "🍩", "🍪", "🎂", "🧁",
      "🍫", "🍭", "🍎", "🍌", "🍉", "🍇", "🍓", "🍒", "🥑", "🌶️", "🍺", "🍻",
      "🥂", "🍷", "🥃", "🍸", "🍹", "☕", "🍵", "🥤",
    ],
  },
  {
    name: "Faces & people",
    emojis: [
      "😀", "😂", "🤣", "😅", "😊", "😍", "🤩", "😎", "🤔", "🤨", "😐", "🙄",
      "😴", "🤯", "😱", "😭", "🥶", "🥵", "🤢", "🤡", "💀", "👻", "🤖", "💩",
      "😈", "🥳", "🤑", "🫡", "👍", "👎", "👏", "🙌", "🤝", "💪", "✌️", "🤞",
      "🙏", "👀", "🧠", "👑", "🎩", "🕶️",
    ],
  },
  {
    name: "Flags",
    emojis: [
      "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "🇬🇧", "🇮🇪", "🇺🇸", "🇨🇦", "🇲🇽", "🇧🇷", "🇦🇷", "🇫🇷", "🇩🇪",
      "🇪🇸", "🇮🇹", "🇵🇹", "🇳🇱", "🇧🇪", "🇩🇰", "🇸🇪", "🇳🇴", "🇵🇱", "🇬🇷", "🇹🇷", "🇯🇵",
      "🇰🇷", "🇨🇳", "🇮🇳", "🇦🇺", "🇳🇿", "🇿🇦", "🇳🇬", "🇪🇬", "🇸🇦", "🇺🇦", "🏁", "🏳️",
      "🏴‍☠️", "🏳️‍🌈", "🚩", "🎌",
    ],
  },
  {
    name: "Things & symbols",
    emojis: [
      "💰", "💵", "💎", "🔥", "⚡", "💥", "❄️", "🌧️", "☀️", "🌈", "⭐", "✨",
      "🎉", "🎊", "🎈", "🎁", "🔔", "📈", "📉", "🚀", "✈️", "🚗", "🏎️", "🚲",
      "⛵", "🏠", "🏰", "⛺", "🗿", "🔑", "🔒", "🔨", "🧨", "💣", "🔮", "🎥",
      "🎤", "🎸", "🥁", "📚", "❤️", "💔", "✅", "❌", "❓", "❗", "💯", "⚠️",
    ],
  },
];

export function EmojiPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (emoji: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  function pick(emoji: string) {
    onChange(emoji);
    setOpen(false);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
        aria-expanded={open}
        title="Pick an emoji"
        className={clsx(
          "h-10 w-12 rounded-lg border text-lg transition-colors",
          value
            ? "border-border bg-surface-2 hover:border-border-strong"
            : "border-dashed border-border text-faint hover:border-border-strong hover:text-muted",
        )}
      >
        {value || "😀"}
      </button>

      {open ? (
        <>
          {/* click-away backdrop */}
          <button
            type="button"
            aria-label="Close emoji picker"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute left-0 top-11 z-50 w-80 rounded-xl border border-border bg-surface p-3 shadow-lg">
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {EMOJI_GROUPS.map((group) => (
                <div key={group.name}>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                    {group.name}
                  </p>
                  <div className="flex flex-wrap">
                    {group.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => pick(emoji)}
                        className={clsx(
                          "flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-surface-2",
                          value === emoji && "bg-primary/10 ring-1 ring-primary",
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
              <input
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="…or type one"
                maxLength={64}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-sm focus:border-primary focus:bg-surface focus:outline-none"
              />
              <button
                type="button"
                onClick={() => pick("")}
                className="h-8 shrink-0 rounded-md px-2 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                None
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
