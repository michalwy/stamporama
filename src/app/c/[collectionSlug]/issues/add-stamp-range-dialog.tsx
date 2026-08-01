"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
} from "@/app/dialog-shell";
import {
  resolveCatalogRange,
  formatSchemeValue,
  parseCatalogNumberSpec,
  AUTO_CREATE_MAX_STAMPS,
  type CatalogNumberSpec,
} from "@/lib/catalog-number";
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

// ── Spec helpers (#452) ───────────────────────────────────────────────────────

// A spec that is a single number and nothing else — the shape the span fill completes.
const LONE_NUMBER = /^[^,\-–—]+$/;

/** Complete a lone number to the span the primary catalog runs to (#185): with the primary at
 *  `100-105` and `200` typed here, this returns `200-205`. Null when either side is not the
 *  simple shape the fill is for — a list the collector composed is never rewritten. */
function fillSpanFromPrimary(own: string, primary: CatalogNumberSpec | null): string | null {
  const trimmed = own.trim();
  if (!trimmed || !LONE_NUMBER.test(trimmed)) return null;
  if (!primary || primary.segments.length !== 1 || primary.numbers.length < 2) return null;
  const range = resolveCatalogRange(trimmed, null);
  if ("error" in range) return null;
  return `${trimmed}-${formatSchemeValue(range.scheme, range.scheme.from + primary.numbers.length - 1)}`;
}

/** A catalog's spec only once it parses — the shape the numbers can be read off. */
function resolvedOf(
  spec: CatalogNumberSpec | { error: string } | null | undefined
): CatalogNumberSpec | null {
  return spec && !("error" in spec) ? spec : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

type VendorRow = { numbers: string; selected: boolean };

interface AddStampRangeDialogProps {
  collectionId: string;
  issueId: string;
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
  issueId,
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
        { numbers: "", selected: v.catalogVendorId === primaryVendorId },
      ])
    )
  );

  function update(vendorId: string, patch: Partial<VendorRow>) {
    setRows((prev) => ({ ...prev, [vendorId]: { ...prev[vendorId], ...patch } }));
  }

  // Each catalog's spec as typed (#452): the parsed result, or null for an untouched field.
  const specs = useMemo(() => {
    const out: Record<string, CatalogNumberSpec | { error: string } | null> = {};
    for (const v of vendors) {
      const raw = rows[v.catalogVendorId]?.numbers.trim() ?? "";
      out[v.catalogVendorId] = raw ? parseCatalogNumberSpec(raw) : null;
    }
    return out;
  }, [vendors, rows]);

  const resolvedSpec = (vendorId: string) => resolvedOf(specs[vendorId]);

  const selectedVendors = sortedVendors.filter((v) => rows[v.catalogVendorId]?.selected);

  // Stamps are matched across catalogs by position, so every selected catalog must produce the
  // same number of them (#452 keeps #70's rule). A spec says exactly what it says — a lone number
  // is one stamp — so a catalog that does not line up is a mismatch rather than being stretched.
  const counts = selectedVendors
    .map((v) => resolvedSpec(v.catalogVendorId)?.numbers.length)
    .filter((c): c is number => c !== undefined);
  const count = counts[0] ?? 0;
  const mismatch = counts.some((c) => c !== count);
  const anyError = selectedVendors.some((v) => {
    const spec = specs[v.catalogVendorId];
    return spec !== null && "error" in spec;
  });
  const missingNumbers = selectedVendors.some((v) => specs[v.catalogVendorId] === null);
  const anyEntered = counts.length > 0;
  const overLimit = count > AUTO_CREATE_MAX_STAMPS;

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
      const candidates = selectedVendors.flatMap((v) =>
        (resolvedOf(specs[v.catalogVendorId])?.numbers ?? []).map((number) => ({
          catalogVendorId: v.catalogVendorId,
          number,
        }))
      );
      if (candidates.length === 0 || mismatch || overLimit) {
        if (!cancelled) setDup((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const { checkCatalogDuplicatesAction } = await import("@/app/actions/duplicate-catalog");
      const res = await checkCatalogDuplicatesAction(collectionId, candidates, {
        contextAreaId: areaId,
        // The issue may override its area's prefix (#377), which is part of the identity checked.
        contextIssueId: issueId,
      });
      if (!cancelled) setDup(res);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collectionId, issueId, areaId, count, mismatch, overLimit, selectedVendors, specs]);

  const dupBlocking = dup.mode === "block" && dup.groups.length > 0;

  const canSubmit =
    !isPending &&
    selectedVendors.length > 0 &&
    anyEntered &&
    !missingNumbers &&
    !anyError &&
    !mismatch &&
    !overLimit &&
    !dupBlocking;

  const previewNumbers = (() => {
    const primary =
      selectedVendors.find((v) => v.catalogVendorId === primaryVendorId) ?? selectedVendors[0];
    if (!primary || mismatch || overLimit) return [];
    return resolvedSpec(primary.catalogVendorId)?.numbers ?? [];
  })();

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
                    <input
                      name={`issueCatalogNumbers_${v.catalogVendorId}`}
                      type="text"
                      value={r.numbers}
                      disabled={isPending || !r.selected}
                      placeholder="e.g. 2820-2822, 2823a"
                      aria-label={`${v.vendorAbbreviation} catalog numbers`}
                      onChange={(e) => update(v.catalogVendorId, { numbers: e.target.value })}
                      onBlur={() => {
                        // Typing a lone number for a secondary catalog completes it to the
                        // primary's span (#185) — the one place that fill still makes sense once
                        // a field can hold several ranges.
                        if (isPrimary) return;
                        const filled = fillSpanFromPrimary(
                          r.numbers,
                          primaryVendorId ? resolvedSpec(primaryVendorId) : null
                        );
                        if (filled) update(v.catalogVendorId, { numbers: filled });
                      }}
                      style={{ ...INPUT_STYLE, width: "100%" }}
                    />
                    {(() => {
                      const spec = specs[v.catalogVendorId];
                      if (!spec || !("error" in spec)) return null;
                      return (
                        <div
                          style={{
                            marginTop: "0.25rem",
                            fontSize: "0.75rem",
                            color: "var(--color-error)",
                          }}
                        >
                          {spec.error}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              {/* Live summary */}
              <div style={{ marginTop: "0.25rem", fontSize: "0.8125rem" }}>
                {!anyEntered ? (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    Enter catalog numbers to preview.
                  </span>
                ) : missingNumbers ? (
                  <span style={{ color: "var(--color-error)" }}>
                    Enter catalog numbers for each selected catalog.
                  </span>
                ) : mismatch ? (
                  <span style={{ color: "var(--color-error)" }}>
                    Selected catalogs must span the same number of stamps.
                  </span>
                ) : overLimit ? (
                  <span style={{ color: "var(--color-error)" }}>
                    Range cannot exceed {AUTO_CREATE_MAX_STAMPS} stamps ({count} requested).
                  </span>
                ) : anyError ? null : ( // the field's own message says what is wrong
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
