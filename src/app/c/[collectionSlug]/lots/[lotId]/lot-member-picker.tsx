"use client";

import { useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
} from "@/app/dialog-shell";
import { useEligibleSubLots } from "../use-lots-query";
import { StateChip } from "../lot-badges";

interface SubLotPickerProps {
  collectionId: string;
  lotId: string;
  baseCurrency: string;
  isPending: boolean;
  error?: string;
  /** Distinct certificate keys already in the lot ("" = none) — the picker warns when the
   * selection would mix certificates (a warning, not a block). */
  existingCertKeys?: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}

/** Multi-select picker for adding sub-lots to a quantity lot: the collection's non-dissolved
 * unit lots whose stamp × condition shape matches (ADR-0012 §2, #164). */
export function SubLotPicker({
  collectionId,
  lotId,
  baseCurrency,
  isPending,
  error,
  existingCertKeys,
  onClose,
  onConfirm,
}: SubLotPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: subLots = [], isLoading } = useEligibleSubLots(collectionId, lotId, true);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const count = selected.size;
  const certWarning = (() => {
    if (!existingCertKeys) return false;
    const certs = new Set<string>(existingCertKeys);
    for (const sl of subLots) {
      if (selected.has(sl.lotId)) {
        for (const it of sl.items) certs.add(it.certificateStatusId ?? "");
      }
    }
    return certs.size > 1;
  })();
  const actionLabel = isPending
    ? "Adding…"
    : count > 0
      ? `Add ${count} sub-lot${count === 1 ? "" : "s"}`
      : "Add";

  return (
    <DialogShell title="Add sub-lots" onClose={onClose} minHeight="24rem" maxWidth="34rem" height="34rem">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <DialogBody>
          {isLoading && <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>Loading…</p>}

          {!isLoading && subLots.length === 0 && (
            <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
              No eligible sub-lots. Create unit lots first, then group them here.
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {subLots.map((sl) => {
              const checked = selected.has(sl.lotId);
              return (
                <label
                  key={sl.lotId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    padding: "0.5rem 0.625rem",
                    borderRadius: "0.375rem",
                    border: `1px solid ${checked ? "var(--color-accent)" : "var(--color-border)"}`,
                    background: checked ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    cursor: "pointer",
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(sl.lotId)} disabled={isPending} />
                  <span
                    style={{
                      flex: 1,
                      fontSize: "0.875rem",
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sl.label}
                  </span>
                  <StateChip state={sl.state} />
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {sl.memberCount} {sl.memberCount === 1 ? "copy" : "copies"}
                  </span>
                  {sl.value != null && (
                    <span style={{ fontSize: "0.8125rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-muted)" }}>
                      {sl.value} {baseCurrency}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </DialogBody>
        {certWarning && (
          <div
            style={{
              padding: "0.5rem 1rem",
              borderTop: "1px solid var(--color-warning-border, var(--color-border))",
              background: "var(--color-warning-soft)",
              color: "var(--color-warning)",
              fontSize: "0.8125rem",
            }}
          >
            ⚠ These sub-lots have different certificate statuses. They can still be grouped, but
            the quantity lot won&apos;t be uniform on certificate.
          </div>
        )}
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          onAction={() => onConfirm([...selected])}
          disabled={isPending || count === 0}
          error={error}
        />
      </div>
    </DialogShell>
  );
}
