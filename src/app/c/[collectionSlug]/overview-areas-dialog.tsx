"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { DialogActions, DialogBody, DialogSecondaryButton, DialogShell } from "@/app/dialog-shell";
import { saveOverviewAreasAction } from "@/app/actions/overview";
import type { CollectionAreaData } from "@/lib/areas";
import { flattenAreaTree } from "./shared/area-helpers";

/**
 * Choosing the areas the Overview breaks down by (#1330), on the Overview itself where the result is
 * looked at. A tick list over the whole area tree: any area at any depth, a nested pair included,
 * each counting its whole subtree. Nothing ticked is the default — the top-level areas — so clearing
 * the ticks and *Use top-level areas* are one act.
 *
 * A picker dialog rather than an applies-as-you-tick filter popover: the choice is saved for the
 * collection, not a view of one screen, so it is made and then committed.
 */

const HINT_STYLE: CSSProperties = {
  margin: "0 0 1rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.25rem 0",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const EMPTY_STYLE: CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

export function OverviewAreasDialog({
  collectionId,
  areas,
  areaIds,
  onSaved,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  areaIds: string[];
  onSaved: (areaIds: string[]) => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => flattenAreaTree(areas), [areas]);
  const [ticked, setTicked] = useState(() => new Set(areaIds));
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setError(undefined);
    // Tree order, so the saved choice reads the way the list did.
    const chosen = rows.map((row) => row.area.id).filter((id) => ticked.has(id));
    startTransition(async () => {
      const result = await saveOverviewAreasAction(collectionId, chosen);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onSaved(result.areaIds);
    });
  }

  return (
    <DialogShell title="Break down by areas" onClose={onClose} maxWidth="28rem" height="36rem">
      <DialogBody>
        <p style={HINT_STYLE}>
          Value over time and Coverage by area show one line for each area you tick, covering the
          area and everything under it, and an <em>Other</em> line for the rest of the collection.
          With nothing ticked they show the top-level areas.
        </p>
        {rows.length === 0 ? (
          <p style={EMPTY_STYLE}>This collection has no areas yet.</p>
        ) : (
          <div role="group" aria-label="Areas">
            {rows.map(({ area, depth }) => (
              <label
                key={area.id}
                style={{ ...ROW_STYLE, paddingLeft: `${depth * 1.25}rem` }}
              >
                <input
                  type="checkbox"
                  checked={ticked.has(area.id)}
                  onChange={() => toggle(area.id)}
                  disabled={isPending}
                />
                {area.name}
              </label>
            ))}
          </div>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Saving…" : "Save"}
        disabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={save}
        leading={
          <DialogSecondaryButton
            onClick={() => setTicked(new Set())}
            disabled={isPending || ticked.size === 0}
          >
            Use top-level areas
          </DialogSecondaryButton>
        }
      />
    </DialogShell>
  );
}
