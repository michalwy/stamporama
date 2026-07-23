"use client";

import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import type { IssueRangeSuggestion } from "@/lib/issues";

/** Format a declared range for display, e.g. "Mi 100–105" or "Mi 100". */
function rangeLabel(prefix: string, first: string, last: string | null): string {
  const range = last ? `${first}–${last}` : first;
  return prefix ? `${prefix} ${range}` : range;
}

interface RangeExtendedDialogProps {
  issueLabel: string;
  suggestions: IssueRangeSuggestion[];
  isPending: boolean;
  error?: React.ReactNode;
  /** Widen every affected vendor's declared range to cover the new stamps. */
  onWiden: () => void;
  /** Leave the declared ranges as they are (the stamps stay outside). */
  onKeep: () => void;
}

/**
 * Follow-up decision shown right after a bulk add-range (#219) or a merge (#218) when the
 * resulting stamps push one or more of the issue's declared catalog ranges beyond their
 * current bounds. Mirrors the Add-stamp dialog's widen-vs-keep choice, but after the fact:
 * the stamps are already in place, and the only decision is whether to widen the declared
 * range to cover them. Declining leaves the non-blocking range warning on the list row.
 */
export function RangeExtendedDialog({
  issueLabel,
  suggestions,
  isPending,
  error,
  onWiden,
  onKeep,
}: RangeExtendedDialogProps) {
  return (
    <DialogShell title="Declared range extended" onClose={onKeep}>
      <DialogBody>
        <p style={{ margin: "0 0 0.875rem", fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.5 }}>
          The stamps added to <strong>{issueLabel}</strong> fall outside its declared catalog
          range. Widen the range to cover them, or keep it as it is.
        </p>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            fontSize: "0.8125rem",
          }}
        >
          {suggestions.map((s) => {
            const current = rangeLabel(s.vendorAbbreviation, s.currentFirst, s.currentLast);
            const proposed = rangeLabel(s.vendorAbbreviation, s.proposedFirst, s.proposedLast);
            return (
              <li key={s.catalogVendorId}>
                <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{current}</span>
                <span style={{ color: "var(--color-text-muted)" }}> → </span>
                <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{proposed}</span>
                {s.outsideNumbers.length > 0 && (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {" "}· covers {s.outsideNumbers.join(", ")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Widening…" : "Widen range"}
        cancelLabel="Keep as-is"
        disabled={isPending}
        onAction={onWiden}
        onCancel={onKeep}
        error={error}
      />
    </DialogShell>
  );
}
