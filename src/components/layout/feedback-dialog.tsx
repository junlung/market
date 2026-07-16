"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { submitFeedbackAction } from "@/app/actions/feedback";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  // imperative action call, not useActionState — the dialog needs a success
  // callback to reset and close itself (see bio-form.tsx)
  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await submitFeedbackAction({}, formData);
      if (result.success) {
        toast.success(result.success);
        setMessage("");
        onClose();
      } else if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  // portal to <body>: the dialog is mounted inside the top nav, whose
  // backdrop-blur makes the header the containing block for fixed
  // descendants — without the portal the dialog pins to the nav and clips
  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close feedback dialog"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Send feedback</h2>
            <p className="text-xs text-muted">Bug, gripe, or bright idea — it lands with the admins.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-muted transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <form action={submit} className="space-y-2">
          <input type="hidden" name="path" value={pathname} />
          <Label htmlFor="feedback-message" className="sr-only">
            Feedback
          </Label>
          <Textarea
            id="feedback-message"
            name="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={1000}
            rows={4}
            autoFocus
            placeholder="What's broken, confusing, or missing?"
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-faint tabular-nums">{message.trim().length}/1000</p>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
          <FieldError message={error ?? undefined} />
        </form>
      </div>
    </>,
    document.body,
  );
}
