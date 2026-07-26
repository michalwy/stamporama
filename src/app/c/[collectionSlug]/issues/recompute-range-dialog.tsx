"use client";

import { useEffect, useState } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { getIssueRangeSuggestionsAction, applyIssueRangeSuggestionAction } from "@/app/actions/issues";
import type { IssueRangeSuggestion } from "@/lib/issues";

const INPUT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontFamily: "monospace",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2rem",
  width: "6rem",
};

/** Format a declared range for display, e.g. "Mi 100–105" or "Mi 100". */
function rangeLabel(prefix: string, first: string, last: string | null): string {
  const range = last ? `${first}–${last}` : first;
  return prefix ? `${prefix} ${range}` : range;
}

type Draft = { first: string; last: string };

interface RecomputeRangeDialogProps {
  collectionId: string;
  issueId: string;
  issueLabel: string;
  /** Refresh the list once ranges have been written. */
  onApplied: () => void;
  onClose: () => void;
}

/**
 * On-demand recomputation of an issue's declared catalog ranges (#333). Runs the same coverage
 * check that fires when a stamp is added — against every stamp currently attached to the issue —
 * but as an explicit action, and nothing is written until the collector confirms. Each proposed
 * First/Last is editable, so a range can be corrected by hand instead of taking the computed
 * widening verbatim.
 */
export function RecomputeRangeDialog({
  collectionId,
  issueId,
  issueLabel,
  onApplied,
  onClose,
}: RecomputeRangeDialogProps) {
  const [suggestions, setSuggestions] = useState<IssueRangeSuggestion[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getIssueRangeSuggestionsAction(collectionId, issueId);
      if (cancelled) return;
      setSuggestions(result);
      setDrafts(
        Object.fromEntries(
          result.map((s) => [s.catalogVendorId, { first: s.proposedFirst, last: s.proposedLast ?? "" }])
        )
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionId, issueId]);

  function update(vendorId: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [vendorId]: { ...prev[vendorId], ...patch } }));
  }

  const hasProposals = !!suggestions && suggestions.length > 0;
  const allFirstsFilled =
    !!suggestions && suggestions.every((s) => drafts[s.catalogVendorId]?.first.trim());

  async function handleApply() {
    if (!suggestions || isPending || !allFirstsFilled) return;
    setIsPending(true);
    setError(undefined);
    try {
      for (const s of suggestions) {
        const draft = drafts[s.catalogVendorId];
        const result = await applyIssueRangeSuggestionAction(
          collectionId,
          issueId,
          s.catalogVendorId,
          draft.first.trim(),
          draft.last.trim() || null
        );
        if (result.status === "error") {
          setError(result.message);
          return;
        }
      }
      onApplied();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <DialogShell title="Recompute declared range" onClose={onClose}>
      <DialogBody>
        {suggestions === null ? (
          <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Checking the stamps attached to {issueLabel}…
          </p>
        ) : !hasProposals ? (
          <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.5 }}>
            Every declared catalog range on <strong>{issueLabel}</strong> already covers its
            required-for-completeness stamps. Nothing to change.
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 0.875rem", fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.5 }}>
              Some stamps attached to <strong>{issueLabel}</strong> fall outside its declared catalog
              range. Review the proposed ranges below — adjust any of them by hand — then apply.
            </p>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                fontSize: "0.8125rem",
              }}
            >
              {suggestions.map((s) => {
                const draft = drafts[s.catalogVendorId] ?? { first: "", last: "" };
                return (
                  <li key={s.catalogVendorId} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                        {rangeLabel(s.vendorAbbreviation, s.currentFirst, s.currentLast)}
                      </span>
                      <span style={{ color: "var(--color-text-muted)" }}>→</span>
                      <input
                        type="text"
                        value={draft.first}
                        disabled={isPending}
                        aria-label={`${s.vendorAbbreviation} first catalog number`}
                        placeholder="First"
                        onChange={(e) => update(s.catalogVendorId, { first: e.target.value })}
                        style={INPUT_STYLE}
                      />
                      <span style={{ color: "var(--color-text-muted)" }}>–</span>
                      <input
                        type="text"
                        value={draft.last}
                        disabled={isPending}
                        aria-label={`${s.vendorAbbreviation} last catalog number`}
                        placeholder="Last (optional)"
                        onChange={(e) => update(s.catalogVendorId, { last: e.target.value })}
                        style={{ ...INPUT_STYLE, width: "9rem" }}
                      />
                    </div>
                    {s.outsideNumbers.length > 0 && (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        Outside the current range: {s.outsideNumbers.join(", ")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Applying…" : "Apply range"}
        cancelLabel={hasProposals ? "Cancel" : "Close"}
        disabled={!hasProposals || isPending || !allFirstsFilled}
        onAction={handleApply}
        onCancel={onClose}
        cancelDisabled={isPending}
        error={error}
      />
    </DialogShell>
  );
}
