"use client";

import Link from "next/link";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { TradeIntakeRead } from "@/lib/trade-intake";

// **Where the incoming material went** (#644), on the trade that produced it.
//
// Closing an exchange turns its receive side into a `Purchase` — one lot per line that actually
// arrived, priced at the carried-over cost basis of the copies that went the other way — and the
// material is identified through the ordinary scan-sheet intake against that order. So what this
// card is, is the door to it: a collector who has just closed a trade and is holding the partner's
// envelope needs to be told where to scan it, and the trade is the screen they are on.
//
// It says three things and no more. **Where** — the order, as a link. **What the pool is** — because
// that figure is the whole point of the treatment and appears nowhere else on this screen: no
// revenue, no profit, no cash, just the same money now sitting in different stamps. And **what is
// still in the way** — the copies whose own cost has not settled, named by the orders they are
// waiting on, since that is what holds the incoming lots open.
//
// It is deliberately not a second intake screen. A detail page reads; it does not become a second
// editor, and the order already has the whole apparatus on it.

const CARD: React.CSSProperties = {
  marginTop: "1rem",
  padding: "0.75rem 0.875rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
  display: "grid",
  gap: "0.375rem",
};

const LINE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
};

const MUTED: React.CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

const WARNING: React.CSSProperties = {
  ...MUTED,
  color: "var(--color-warning)",
};

export function TradeIntakeCard({
  collectionSlug,
  intake,
}: {
  collectionSlug: string;
  intake: TradeIntakeRead | undefined;
}) {
  const purchase = intake?.purchase;
  if (!intake || !purchase) return null;

  const lotWord = purchase.lotCount === 1 ? "lot" : "lots";
  const copyWord = purchase.itemCount === 1 ? "copy" : "copies";

  return (
    <section style={CARD}>
      <p style={LINE}>
        <Tooltip content="Closing this trade created an order to hold what came in. Identify the partner's material against it exactly as you would a parcel you bought — scan the cards, cut them into tiles, name each piece.">
          <Link
            href={`/c/${collectionSlug}/purchases/${purchase.id}`}
            style={{ color: "var(--color-accent)", textDecoration: "none", fontWeight: 600 }}
          >
            <Icon name="purchases" size="sm" /> Order #{purchase.purchaseNo}
          </Link>
        </Tooltip>{" "}
        holds what came in — {purchase.lotCount} {lotWord}, {purchase.itemCount} {copyWord}{" "}
        identified so far.
      </p>

      {/* The figure the whole treatment turns on. Stated plainly, with what it is *not* said in the
          hover: an exchange recognises nothing, so a collector reading a purchase total here must
          not take it for money spent. */}
      <p style={MUTED}>
        <Tooltip content="The cost basis of the copies that went the other way, carried over rather than spent. No revenue and no profit is recorded on an exchange: the same money now sits in different stamps, and the profit appears on a real sale later.">
          <span>
            Carried over: {purchase.pool} {purchase.currency}
          </span>
        </Tooltip>
        {intake.settled ? "" : " — provisional"}
      </p>

      {intake.pendingMessage && <p style={WARNING}>{intake.pendingMessage}</p>}
      {intake.unrecordedNote && <p style={MUTED}>{intake.unrecordedNote}</p>}

      {/* #566's warning, on the screen the tiles are *not* on: the order's own close already says
          this, and a collector who never goes back to the order would otherwise never hear it. */}
      {purchase.unidentifiedTileCount > 0 && (
        <p style={MUTED}>
          {purchase.unidentifiedTileCount} scan tile
          {purchase.unidentifiedTileCount === 1 ? " is" : "s are"} still unidentified on that order.
        </p>
      )}
    </section>
  );
}
