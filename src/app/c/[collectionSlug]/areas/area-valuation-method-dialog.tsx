"use client";

import { useState, useTransition } from "react";
import {
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogShell,
  LabelWithError,
} from "@/app/dialog-shell";
import { setAreaValuationMethodAction } from "@/app/actions/valuation-methods";
import type { CollectionAreaData } from "@/lib/areas";
import {
  areaMethod,
  isValuationMethod,
  VALUATION_METHODS,
  VALUATION_METHOD_LABELS,
  type ValuationMethod,
} from "@/lib/piece-valuation";
import { formControl } from "@/app/control-style";

// An area's valuation method for pieces (#2359; ADR-0076), set from its ⋮ menu where its format
// multipliers are. *Same as parent* names what it inherits and from where, so the choice is never
// made blind.

export function AreaValuationMethodDialog({
  area,
  areas,
  collectionMethod,
  onClose,
  onSaved,
}: {
  area: CollectionAreaData;
  areas: CollectionAreaData[];
  collectionMethod: ValuationMethod;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string>(area.valuationMethod ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const byId = new Map(areas.map((a) => [a.id, a]));
  const inherited = areaMethod(byId, area.parentId);
  const inheritedLabel = inherited
    ? `${VALUATION_METHOD_LABELS[inherited.method]}, from ${byId.get(inherited.areaId)?.name ?? "a parent area"}`
    : `${VALUATION_METHOD_LABELS[collectionMethod]}, the collection's default`;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setAreaValuationMethodAction(area.id, isValuationMethod(value) ? value : "");
      if (res.status === "error") {
        setError(res.message);
        return;
      }
      onSaved();
    });
  }

  return (
    <DialogShell title={`Valuation method — ${area.name}`} onClose={onClose} maxWidth="32rem">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div style={{ padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <LabelWithError htmlFor="area-valuation-method">Method</LabelWithError>
          <select
            id="area-valuation-method"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={isPending}
            style={SELECT}
          >
            <option value="">Same as parent ({inheritedLabel})</option>
            {VALUATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {VALUATION_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          <div style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Values the pieces whose most expensive stamp is in this area or below it, unless an area
            below or the copy sets its own.
          </div>
        </div>
        <DialogFooter error={error}>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <DialogPrimaryButton disabled={isPending}>{isPending ? "Saving…" : "Save"}</DialogPrimaryButton>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

const SELECT: React.CSSProperties = {
  ...formControl,
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};
