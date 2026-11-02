"use client";

import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import {
  listedElsewhereSentence,
  swapAllPairs,
  twinSentence,
  type ListedElsewhereCopy,
} from "@/lib/listed-elsewhere-rules";

const SMALL_BTN: React.CSSProperties = {
  ...baseBtn,
  minHeight: 0,
  padding: "0.125rem 0.625rem",
  fontSize: "0.75rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-primary)",
};

/**
 * The *listed elsewhere* note (#2339): which of the copies being made into an offer are already in an
 * open offer, where, and the twin of the same stamp listed nowhere that could go instead — **Swap** for
 * one, **Swap all** for every one that has a twin. A copy with no twin is only named. It never stops
 * anything: the same copy on two platforms stays possible.
 */
export function ListedElsewhereNote({
  copies,
  onSwap,
  disabled = false,
  label,
  footnote,
}: {
  copies: readonly ListedElsewhereCopy[];
  /** What the copies belong to, ahead of the heading — *Lot 3* on *Convert to sale…*. */
  label?: string;
  onSwap: (pairs: { from: string; to: string }[]) => void;
  disabled?: boolean;
  /** A line under the list, for what a dialog adds — *Convert to sale…*'s other offer. */
  footnote?: React.ReactNode;
}) {
  if (copies.length === 0) return null;
  const all = swapAllPairs(copies);
  return (
    <div
      role="note"
      aria-label="Copies listed elsewhere"
      style={{
        display: "flex",
        gap: "0.5rem",
        padding: "0.625rem 0.75rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
        color: "var(--color-warning)",
        fontSize: "0.8125rem",
      }}
    >
      <Icon name="warning" size="sm" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <strong style={{ flex: 1, minWidth: 0 }}>
            {label ? `${label}: ` : ""}
            {copies.length === 1 ? (label ? "a copy is" : "A copy is") : `${copies.length} copies are`} already in an
            open offer
          </strong>
          {all.length > 1 && (
            <button type="button" style={SMALL_BTN} disabled={disabled} onClick={() => onSwap(all)}>
              Swap all ({all.length})
            </button>
          )}
        </div>
        <ul style={{ margin: "0.375rem 0 0", paddingLeft: "1.1rem" }}>
          {copies.map((copy) => (
            <li key={copy.itemId} style={{ marginTop: "0.25rem" }}>
              <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem" }}>
                <span>
                  {listedElsewhereSentence(copy)}
                  {copy.twin ? ` — ${twinSentence(copy.twin)}` : " — no copy of it is listed nowhere"}
                </span>
                {copy.twin && (
                  <button
                    type="button"
                    style={SMALL_BTN}
                    disabled={disabled}
                    onClick={() => onSwap([{ from: copy.itemId, to: copy.twin!.itemId }])}
                  >
                    Swap
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {footnote && <p style={{ margin: "0.375rem 0 0" }}>{footnote}</p>}
      </div>
    </div>
  );
}
