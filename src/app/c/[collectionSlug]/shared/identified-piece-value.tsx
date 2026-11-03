"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DraftPieceEntry } from "@/lib/carrier-value";
import type { Franking, ValuationMethod } from "@/lib/piece-valuation";
import type { CopyValuation, PieceValuation, ValueModifier } from "@/lib/valuation";
import type { TypedPiecePrice } from "@/lib/piece-price-entry";
import { PieceArithmetic } from "./piece-value-breakdown";

// What a piece carrying several stamps will be worth, in the identification step (#2353) — read
// before the copy exists, by the method, exactly as the copy will be valued once written. Each stamp
// on the piece has its used price and its price on the piece typed in place (#2368,
// `piece-stamp-prices.tsx`); under them, the computed value and how it was reached. Re-read as the
// format, the stamps, the franking, the method or the typed prices change. A piece has no condition
// (#2383), so none is waited for.

export interface PiecePreviewSubject {
  collectionId: string;
  /** Never read for a piece, which has none (#2383); `""` when the step shows no Condition field. */
  conditionId: string;
  /** The piece's own format, `""` for none. */
  formatId: string;
  stamps: readonly DraftPieceEntry[];
  /** The franking chosen; null on a correction, which reads the copy's own. */
  franking: Franking | null;
  /** The piece's own method chosen (#2369), null for *As inherited*; absent on a correction, which
   *  reads the copy's own. */
  method?: ValuationMethod | null;
  /** The copy a correction re-answers. */
  itemId: string | null;
  /** Stamp prices typed and not yet saved (#2368), read as if they were. */
  typed: readonly TypedPiecePrice[];
  /** The value modifier typed in the step (#2398); null for none. */
  valueModifier?: ValueModifier | null;
}

/** The preview's value, or null while there is none — no stamps yet, or not a piece. */
export function usePiecePreview(subject: PiecePreviewSubject | null): CopyValuation | null {
  const query = useQuery<CopyValuation | null>({
    queryKey: ["piecePreview", subject] as const,
    enabled: subject !== null && subject.stamps.length > 0,
    queryFn: async () => {
      const { previewPieceValueAction } = await import("@/app/actions/items");
      return previewPieceValueAction(subject!.collectionId, {
        conditionId: subject!.conditionId || null,
        formatId: subject!.formatId || null,
        stamps: subject!.stamps,
        franking: subject!.franking,
        method: subject!.method,
        itemId: subject!.itemId,
        typed: subject!.typed,
        valueModifier: subject!.valueModifier ?? null,
      });
    },
    // A change of franking re-reads; the old figure stays on screen until the new one is in, rather
    // than the lines blinking out under the collector's hand.
    placeholderData: keepPreviousData,
  });
  return subject && query.data?.piece ? query.data : null;
}

/** The id the preview files the entry at `index` under — `previewPieceValue`'s key, then its index. */
export function componentIdAt(subject: PiecePreviewSubject, index: number): string {
  return `${subject.itemId ?? "preview"}:${index}`;
}

/** The computed value under the stamps, and how it was reached — the method's figure, before the
 *  value modifier (#2398), whose result is stated under its own fields. */
export function IdentifiedPieceFigure({
  value,
  labels,
}: {
  value: CopyValuation;
  /** Each stamp named as the list names it, in its order. */
  labels: readonly string[];
}) {
  const piece: PieceValuation = value.piece!;
  const label = (componentId: string) => {
    const index = Number(componentId.slice(componentId.lastIndexOf(":") + 1));
    return labels[index] ?? `stamp ${index + 1}`;
  };
  return (
    <div style={{ marginTop: "0.375rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div style={{ color: "var(--color-text-primary)" }}>
        Computed value:{" "}
        {value.unpriced ? (
          <span style={{ color: "var(--color-text-muted)" }}>none — no price this method reads is recorded</span>
        ) : (
          <strong style={{ fontVariantNumeric: "tabular-nums" }}>
            {value.valueModifier?.fullAmount ?? value.amount} {value.currency}
          </strong>
        )}
        {piece.partial && !value.unpriced && (
          <span style={{ color: "var(--color-warning)" }}> partial</span>
        )}
      </div>
      <PieceArithmetic piece={piece} label={label} />
    </div>
  );
}
