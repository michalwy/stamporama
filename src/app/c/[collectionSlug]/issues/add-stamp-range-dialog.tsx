"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
} from "@/app/dialog-shell";
import { resolveCatalogRange, generateCatalogNumbers } from "@/lib/catalog-number";
import type { AreaCatalogEntry } from "@/lib/areas";
import type {
  CatalogDuplicateGroup,
  DuplicateCatalogMode,
} from "@/lib/duplicate-catalog";

// ── Styles ────────────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

// ── Range helpers ─────────────────────────────────────────────────────────────

/** Number of stamps a vendor's First/Last range spans, or null when empty/unparseable
 *  (mirrors the auto-create generation in src/app/actions/issues.ts). */
function rangeCount(first: string, last: string): number | null {
  if (!first.trim()) return null;
  const range = resolveCatalogRange(first, last.trim() ? last : null);
  if ("error" in range) return null;
  return range.span ?? 1;
}

/** Generated numbers for a vendor's range, capped at `count` positions. */
function rangeNumbers(first: string, last: string, count: number): string[] {
  const range = resolveCatalogRange(first, last.trim() ? last : null);
  if ("error" in range) return [];
  return generateCatalogNumbers(range.scheme, count);
}

// ── Component ─────────────────────────────────────────────────────────────────

type VendorRow = { first: string; last: string; selected: boolean };

interface AddStampRangeDialogProps {
  collectionId: string;
  issueName: string;
  areaId: string;
  vendors: AreaCatalogEntry[];
  primaryVendorId: string | null;
  isPending: boolean;
  error?: React.ReactNode;
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
}

export function AddStampRangeDialog({
  collectionId,
  issueName,
  areaId,
  vendors,
  primaryVendorId,
  isPending,
  error,
  onSubmit,
  onClose,
}: AddStampRangeDialogProps) {
  const sortedVendors = useMemo(() => {
    if (!primaryVendorId) return vendors;
    return [...vendors].sort((a, b) => {
      if (a.catalogVendorId === primaryVendorId) return -1;
      if (b.catalogVendorId === primaryVendorId) return 1;
      return 0;
    });
  }, [vendors, primaryVendorId]);

  const [rows, setRows] = useState<Record<string, VendorRow>>(() =>
    Object.fromEntries(
      vendors.map((v) => [
        v.catalogVendorId,
        { first: "", last: "", selected: v.catalogVendorId === primaryVendorId },
      ])
    )
  );

  function update(vendorId: string, patch: Partial<VendorRow>) {
    setRows((prev) => ({ ...prev, [vendorId]: { ...prev[vendorId], ...patch } }));
  }

  const selectedVendors = sortedVendors.filter((v) => rows[v.catalogVendorId]?.selected);

  // Effective stamp count: the single span shared by every selected vendor's explicit
  // range. Vendors with a single number (span 1) don't constrain it. `mismatch` flags
  // two explicit ranges of different lengths — stamps are matched by position, so those
  // can't be combined.
  const { count, mismatch } = useMemo(() => {
    let resolved: number | null = null;
    let bad = false;
    for (const v of selectedVendors) {
      const r = rows[v.catalogVendorId];
      const c = rangeCount(r.first, r.last);
      if (c === null || c === 1) continue;
      if (resolved === null) resolved = c;
      else if (resolved !== c) bad = true;
    }
    return { count: resolved ?? 1, mismatch: bad };
  }, [selectedVendors, rows]);

  const anyFirstEntered = selectedVendors.some((v) => rows[v.catalogVendorId]?.first.trim());
  const overLimit = count > 50;

  // Live duplicate check (#85): the generated numbers become real stamps. Debounced; a
  // "block" collection disables Save, a "warn" collection only shows an advisory.
  const [dup, setDup] = useState<{ mode: DuplicateCatalogMode; groups: CatalogDuplicateGroup[] }>({
    mode: "warn",
    groups: [],
  });
  useEffect(() => {
    let cancelled = false;
    // Debounced: keystrokes re-run this effect (via `rows`) and just reset the timer, so
    // the lookup only fires once the user pauses. State updates happen in the callback.
    const timer = setTimeout(async () => {
      const candidates = selectedVendors.flatMap((v) => {
        const r = rows[v.catalogVendorId];
        if (!r?.first.trim()) return [];
        return rangeNumbers(r.first, r.last, count).map((number) => ({
          catalogVendorId: v.catalogVendorId,
          number,
        }));
      });
      if (candidates.length === 0 || mismatch || overLimit) {
        if (!cancelled) setDup((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const { checkCatalogDuplicatesAction } = await import("@/app/actions/duplicate-catalog");
      const res = await checkCatalogDuplicatesAction(collectionId, candidates, {
        contextAreaId: areaId,
      });
      if (!cancelled) setDup(res);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collectionId, areaId, count, mismatch, overLimit, selectedVendors, rows]);

  const dupBlocking = dup.mode === "block" && dup.groups.length > 0;

  const canSubmit =
    !isPending &&
    selectedVendors.length > 0 &&
    anyFirstEntered &&
    !mismatch &&
    !overLimit &&
    !dupBlocking;

  const previewNumbers = useMemo(() => {
    const primary =
      selectedVendors.find((v) => v.catalogVendorId === primaryVendorId) ?? selectedVendors[0];
    if (!primary) return [];
    const r = rows[primary.catalogVendorId];
    if (!r?.first.trim() || mismatch || overLimit) return [];
    return rangeNumbers(r.first, r.last, count);
  }, [selectedVendors, primaryVendorId, rows, count, mismatch, overLimit]);

  return (
    <DialogShell title="Add stamp range" onClose={onClose} minHeight="24rem">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit(new FormData(e.currentTarget));
        }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            Add stamps to <strong>{issueName}</strong> by catalog-number range. New stamps
            join this issue as additional root nodes.
          </p>

          {sortedVendors.length === 0 ? (
            <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              This issue&apos;s area has no catalog vendors configured.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {sortedVendors.map((v) => {
                const r = rows[v.catalogVendorId];
                const isPrimary = v.catalogVendorId === primaryVendorId;
                return (
                  <div key={v.catalogVendorId}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        marginBottom: "0.25rem",
                        fontSize: "0.8125rem",
                        color: "var(--color-text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={r.selected}
                        disabled={isPending}
                        onChange={(e) => update(v.catalogVendorId, { selected: e.target.checked })}
                      />
                      {v.vendorName} ({v.vendorAbbreviation})
                      {v.prefix ? ` · ${v.prefix}` : ""}
                      {isPrimary && (
                        <span
                          style={{
                            fontSize: "0.6875rem",
                            color: "var(--color-accent)",
                            border: "1px solid var(--color-accent)",
                            borderRadius: "0.2rem",
                            padding: "0.05rem 0.3rem",
                            fontWeight: 600,
                          }}
                        >
                          Primary
                        </span>
                      )}
                    </label>
                    {/* Selection is carried by presence of this key (the action reads
                        autoCreateVendor_* keys). First/Last feed the range generator. */}
                    {r.selected && (
                      <input type="hidden" name={`autoCreateVendor_${v.catalogVendorId}`} value="1" />
                    )}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        name={`issueCatalogFirst_${v.catalogVendorId}`}
                        type="text"
                        value={r.first}
                        disabled={isPending || !r.selected}
                        placeholder="First"
                        onChange={(e) => update(v.catalogVendorId, { first: e.target.value })}
                        style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
                      />
                      <input
                        name={`issueCatalogLast_${v.catalogVendorId}`}
                        type="text"
                        value={r.last}
                        disabled={isPending || !r.selected}
                        placeholder="Last (optional)"
                        onChange={(e) => update(v.catalogVendorId, { last: e.target.value })}
                        style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Live summary */}
              <div style={{ marginTop: "0.25rem", fontSize: "0.8125rem" }}>
                {mismatch ? (
                  <span style={{ color: "var(--color-error)" }}>
                    Selected vendors must span the same number of stamps.
                  </span>
                ) : overLimit ? (
                  <span style={{ color: "var(--color-error)" }}>
                    Range cannot exceed 50 stamps ({count} requested).
                  </span>
                ) : anyFirstEntered ? (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Will create <strong>{count}</strong> {count === 1 ? "stamp" : "stamps"}
                    {previewNumbers.length > 0 && (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {" "}
                        ({previewNumbers.slice(0, 8).join(", ")}
                        {previewNumbers.length > 8 ? "…" : ""})
                      </span>
                    )}
                    .
                  </span>
                ) : (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    Enter a First catalog number to preview.
                  </span>
                )}
              </div>

              {dup.groups.length > 0 && (
                <div
                  style={{
                    fontSize: "0.8125rem",
                    color: dupBlocking ? "var(--color-error)" : "var(--color-warning)",
                  }}
                >
                  {dupBlocking ? "Blocked — duplicate" : "Warning — duplicate"} catalog{" "}
                  {dup.groups.length === 1 ? "number" : "numbers"} already in this collection:{" "}
                  {dup.groups.slice(0, 5).map((g) => g.label).join(", ")}
                  {dup.groups.length > 5 ? ` and ${dup.groups.length - 5} more` : ""}.
                  {dupBlocking ? " Switch to warnings under Settings → Duplicates to save anyway." : ""}
                </div>
              )}
            </div>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Adding…" : "Add stamps"}
          onCancel={onClose}
          disabled={!canSubmit}
          cancelDisabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
