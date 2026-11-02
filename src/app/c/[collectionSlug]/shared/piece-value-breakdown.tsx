"use client";

import { PIECE_PRICE_LABELS, type PiecePrice } from "@/lib/piece-valuation";
import {
  componentPrice,
  missingPricesText,
  onPiecePrice,
  pieceArithmetic,
  pieceValueRule,
  priceSymbol,
} from "@/lib/piece-value-words";
import type { PieceValuation } from "@/lib/valuation";
import { Tooltip } from "./tooltip";

// How a piece's value was reached (#2353), drawn the same way in its Valuation window and in the
// identification step: each stamp's used price and its price on the piece, then the arithmetic under
// them. Every figure is in the collection currency, where the method compared them.

/** The heading of the price-on-the-piece column: *Cover MiF*, *⊠*, *On piece*. */
export function onPiecePriceHeading(piece: PieceValuation): string | null {
  const price = onPiecePrice(piece);
  if (price === null) return null;
  return piece.method === "fischer" && price === "cover_mif" ? "⊠ (Cover MiF)" : PIECE_PRICE_LABELS[price];
}

/**
 * One stamp's price, as the method read it: the figure, or — when it is missing — a mark on the stamp,
 * amber when the value is partial for it and muted when the rule did not need it.
 */
export function PiecePriceFigure({
  piece,
  componentId,
  price,
}: {
  piece: PieceValuation;
  componentId: string;
  price: PiecePrice;
}) {
  const component = piece.components.find((c) => c.id === componentId);
  const amount = component ? componentPrice(component, price) : null;
  if (amount !== null) {
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{amount.toFixed(2)}</span>;
  }
  const counted = piece.missing.some((m) => m.componentId === componentId && m.price === price);
  return (
    <Tooltip
      content={
        counted
          ? `No ${PIECE_PRICE_LABELS[price]} price for this stamp at this condition, without a certificate — the value is partial without it.`
          : `No ${PIECE_PRICE_LABELS[price]} price for this stamp — this piece's value does not read it.`
      }
      align="end"
    >
      <span
        style={{
          color: counted ? "var(--color-warning)" : "var(--color-text-muted)",
          cursor: "default",
        }}
      >
        {counted ? "no price" : "—"}
      </span>
    </Tooltip>
  );
}

/**
 * The arithmetic and the rule under the stamps: *MiF: 50 % × Mi 123 ⊠ 40.00 + Mi 124 ⊙ 2.00 =
 * 22.00*, then the method, the franking and where the method came from, then what is missing.
 */
export function PieceArithmetic({
  piece,
  label,
  methodSource,
}: {
  piece: PieceValuation;
  /** An entry named the way the surface names a stamp — its main catalogue number. */
  label: (componentId: string) => string;
  /** Where the method came from, in words: *from Poland*, *set on this copy*. */
  methodSource: string;
}) {
  const arithmetic = pieceArithmetic(piece, label);
  const missing = missingPricesText(piece.missing);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.8125rem" }}>
      {arithmetic && (
        <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
          {arithmetic}
        </div>
      )}
      <div style={{ color: "var(--color-text-muted)" }}>
        {pieceValueRule(piece)} — method {methodSource}.
      </div>
      {missing && (
        <div style={{ color: "var(--color-warning)" }}>
          Partial — {missing}: the value is what is priced.
        </div>
      )}
    </div>
  );
}

/** A price's short name beside its figure, as the arithmetic writes it: ⊙, EF, ⊠. */
export function PriceSymbol({ piece, price }: { piece: PieceValuation; price: PiecePrice }) {
  return (
    <Tooltip content={PIECE_PRICE_LABELS[price]} align="start">
      <span style={{ color: "var(--color-text-muted)", cursor: "default" }}>
        {priceSymbol(price, piece.method)}
      </span>
    </Tooltip>
  );
}
