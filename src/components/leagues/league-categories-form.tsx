"use client";

import { useActionState, useState } from "react";
import { X } from "lucide-react";
import { updateLeagueCategoriesAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initialState: ActionResult = {};

/**
 * Owner-curated market categories for a custom league. Edits are staged
 * client-side and submitted as one list; removing a label never touches
 * markets already carrying it.
 */
export function LeagueCategoriesForm({
  leagueId,
  slug,
  categories,
}: {
  leagueId: string;
  slug: string;
  categories: string[];
}) {
  const [state, formAction, pending] = useActionState(updateLeagueCategoriesAction, initialState);
  const [list, setList] = useState(categories);
  const [draft, setDraft] = useState("");

  function addDraft() {
    const value = draft.trim();
    if (!value || list.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      return;
    }
    setList([...list, value]);
    setDraft("");
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="slug" value={slug} />
      {list.map((category) => (
        <input key={category} type="hidden" name="categories" value={category} />
      ))}

      <div className="flex flex-wrap gap-1.5">
        {list.map((category) => (
          <span
            key={category}
            className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium"
          >
            {category}
            <button
              type="button"
              aria-label={`Remove ${category}`}
              onClick={() => setList(list.filter((entry) => entry !== category))}
              className="text-muted hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="league-category-draft" className="sr-only">
          Add a category
        </Label>
        <Input
          id="league-category-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraft();
            }
          }}
          placeholder="Add a category…"
          maxLength={24}
          className="max-w-48"
        />
        <Button type="button" variant="secondary" size="sm" onClick={addDraft}>
          Add
        </Button>
        <Button type="submit" size="sm" disabled={pending || list.length === 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <FieldError message={state.error} />
      {state.success ? <p className="text-sm text-yes">{state.success}</p> : null}
    </form>
  );
}
