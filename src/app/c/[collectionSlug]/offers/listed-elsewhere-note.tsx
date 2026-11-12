"use client";

import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  NO_TWIN_SENTENCE,
  listedElsewhereMarker,
  listedElsewhereSentence,
  listedElsewhereSummary,
  listedOnSentence,
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
const NOTE_BOX: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  padding: "0.625rem 0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-warning-border)",
  background: "var(--color-warning-soft)",
  color: "var(--color-warning)",
  fontSize: "0.8125rem",
};

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
      style={NOTE_BOX}
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
                  {` — ${copy.twin ? twinSentence(copy.twin) : NO_TWIN_SENTENCE}`}
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

/**
 * The generator's form of the note (#2479): one line above the preview — how many copies, in how many
 * of the offers, are already in an open offer, how many can be swapped — with **Swap all**. A pass of
 * hundreds of offers would otherwise list hundreds of copies before its first offer; each copy is
 * named on its own offer's line instead ({@link ListedElsewhereMarker}, {@link ListedElsewhereCopyNote}).
 */
export function ListedElsewhereSummary({
  copies,
  offers,
  onSwap,
  disabled = false,
}: {
  copies: readonly ListedElsewhereCopy[];
  /** How many of the offers hold them. */
  offers: number;
  onSwap: (pairs: { from: string; to: string }[]) => void;
  disabled?: boolean;
}) {
  if (copies.length === 0) return null;
  const all = swapAllPairs(copies);
  return (
    <div role="note" aria-label="Copies listed elsewhere" style={{ ...NOTE_BOX, alignItems: "center" }}>
      <Icon name="warning" size="sm" />
      <span style={{ flex: 1, minWidth: 0 }}>{listedElsewhereSummary(copies, offers)}</span>
      {all.length > 0 && (
        <button type="button" style={SMALL_BTN} disabled={disabled} onClick={() => onSwap(all)}>
          Swap all ({all.length})
        </button>
      )}
    </div>
  );
}

/** The marker beside a generator line's title (#2479) — *2 on Colnect* — or nothing when none of its
 *  copies is already in an open offer. A click on it reaches the line, which it expands. */
export function ListedElsewhereMarker({ copies }: { copies: readonly ListedElsewhereCopy[] }) {
  const label = listedElsewhereMarker(copies);
  if (!label) return null;
  return (
    <Tooltip
      content={`${copies.length === 1 ? "A copy is" : `${copies.length} copies are`} already in an open offer — open the line to see where`}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          flexShrink: 0,
          fontSize: "0.75rem",
          fontWeight: 500,
          padding: "0.0625rem 0.375rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-warning-border)",
          background: "var(--color-warning-soft)",
          color: "var(--color-warning)",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name="warning" size="sm" />
        {label}
      </span>
    </Tooltip>
  );
}

/** Under a copy of an expanded generator line (#2479): the open offer it is already in, and the twin
 *  with **Swap**, or that there is none. */
export function ListedElsewhereCopyNote({
  copy,
  onSwap,
  disabled = false,
}: {
  copy: ListedElsewhereCopy;
  onSwap: (pairs: { from: string; to: string }[]) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="note"
      aria-label={listedElsewhereSentence(copy)}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0.3125rem 0.75rem",
        borderTop: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
        color: "var(--color-warning)",
        fontSize: "0.75rem",
      }}
    >
      <Icon name="warning" size="sm" />
      <span>
        {`${listedOnSentence(copy).replace(/^on/, "On")} — ${copy.twin ? twinSentence(copy.twin) : NO_TWIN_SENTENCE}`}
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
    </div>
  );
}
