"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { PiecePrice } from "@/lib/piece-valuation";
import {
  componentPrice,
  isDerivedPrice,
  methodSourceText,
  missingPricesText,
  onPiecePrice,
  pieceArithmetic,
  pieceValueRule,
  priceHeading,
  priceRoleLabel,
  priceSymbol,
  unmappedRolesText,
} from "@/lib/piece-value-words";
import type { PieceValuation } from "@/lib/valuation";
import { Tooltip } from "./tooltip";

// How a piece's value was reached (#2353), drawn the same way in its Valuation window and in the
// identification step: each stamp's used price and its price on the piece, then the arithmetic under
// them. Every figure is in the collection currency, where the method compared them.

/** The heading of the price-on-the-piece column (#2375): the condition the method maps it to — *FM*,
 *  *MiF* — or its role's name while that is not set up. */
export function onPiecePriceHeading(piece: PieceValuation): string | null {
  const price = onPiecePrice(piece);
  return price === null ? null : priceHeading(piece, price);
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
  if (amount !== null && component && isDerivedPrice(component, price)) {
    // Michel's rule (#2358): the method's working, never written to the stamp's prices.
    return (
      <Tooltip
        content="Worked out by Michel's rule for a stamp still valid for postage: the used price +20 %, at least 0.40, at most the never-hinged price."
        align="end"
      >
        <span style={{ fontVariantNumeric: "tabular-nums", cursor: "default" }}>~{amount.toFixed(2)}</span>
      </Tooltip>
    );
  }
  if (amount !== null) {
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{amount.toFixed(2)}</span>;
  }
  const counted = piece.missing.some((m) => m.componentId === componentId && m.price === price);
  const unmapped = !piece.columns[price];
  const name = priceHeading(piece, price);
  return (
    <Tooltip
      content={
        unmapped
          ? `${priceRoleLabel(piece, price)} is not set up for this method — choose its condition under Settings → Valuation methods.`
          : counted
            ? `No ${name} price for this stamp without a certificate — the value is partial without it.`
            : `No ${name} price for this stamp — this piece's value does not read it.`
      }
      align="end"
    >
      <span
        style={{
          color: counted ? "var(--color-warning)" : "var(--color-text-muted)",
          cursor: "default",
        }}
      >
        {unmapped ? "not set up" : counted ? "no price" : "—"}
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
}: {
  piece: PieceValuation;
  /** An entry named the way the surface names a stamp — its main catalogue number. */
  label: (componentId: string) => string;
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  // Settings → Valuation methods, where a role not set up is chosen (#2375).
  const methodsHref = collectionSlug ? `/c/${collectionSlug}/settings?tab=valuation-methods` : null;
  const arithmetic = pieceArithmetic(piece, label);
  const missing = missingPricesText(piece);
  const unmapped = unmappedRolesText(piece.unmapped);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.8125rem" }}>
      {arithmetic && (
        <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
          {arithmetic}
        </div>
      )}
      <div style={{ color: "var(--color-text-muted)" }}>
        {/* Without a kind no method applies, so where one came from is beside the point (#2369). */}
        {pieceValueRule(piece)}
        {piece.kind === null ? "." : ` — method ${methodSourceText(piece)}.`}
      </div>
      {unmapped && (
        <div style={{ color: "var(--color-warning)" }}>
          Partial — {unmapped}
          {methodsHref ? (
            <>
              {": "}
              <Link href={methodsHref} style={{ color: "inherit", textDecoration: "underline" }}>
                set it up in Valuation methods
              </Link>
              .
            </>
          ) : (
            "."
          )}
        </div>
      )}
      {missing && (
        <div style={{ color: "var(--color-warning)" }}>
          Partial — {missing}: the value is what is priced.
        </div>
      )}
    </div>
  );
}

/** A price's short name beside its figure, as the arithmetic writes it: ⊙, MiF, ⊠ — the mapped
 *  condition's symbol or abbreviation (#2375), its role in the hover. */
export function PriceSymbol({ piece, price }: { piece: PieceValuation; price: PiecePrice }) {
  return (
    <Tooltip content={priceRoleLabel(piece, price)} align="start">
      <span style={{ color: "var(--color-text-muted)", cursor: "default" }}>
        {priceSymbol(piece, price)}
      </span>
    </Tooltip>
  );
}
