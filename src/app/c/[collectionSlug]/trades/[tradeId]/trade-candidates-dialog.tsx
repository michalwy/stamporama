"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogFooter,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { setTradeCopyBlockAction } from "@/app/actions/trades";
import { Icon } from "@/app/icons";
import { useTradeLineCandidates, useInvalidateTradeDetail } from "./use-trade-detail-query";

// **Which of my copies could go instead of this one** (#657).
//
// The give side of a trade names a concrete copy, but a collection holding four of the same stamp in
// the same condition has not really decided *which* of them travels — and the partner is the one who
// should decide it (#658). This is the collector's half of that: the set the partner will be offered,
// and the control over what is in it.
//
// The copies are drawn with `InventoryItemRow`, the row every other screen draws a copy with, because
// the question being asked here is the question the Copies list exists for — which of these do I want
// to send. Thumbnail, copy number, where it is filed and what it cost are exactly what answers it.
//
// **Everything eligible is offered by default and the collector removes.** So the control is a tick
// that starts on, not one that starts off: the ordinary case is a collector who never opens this
// dialog at all and whose duplicates are all interchangeable, which is what it means for the pool to
// be derived. Unticking writes one row (`TradeCopyBlock`); ticking deletes it.
//
// **The promised copy is at the head of the list and has no tick.** It is what the alternatives are
// alternatives *to*, and holding it back is not a thing to be able to do — the server refuses it by
// name, but the dialog never offers the button in the first place: the pool it is drawn from excludes
// every copy already on the trade.

const HINT: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
};

const GROUP_HEADING: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  padding: "0.3rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-secondary)",
  borderTop: "1px solid var(--color-border)",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
};

const EMPTY: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const STRIP_NOTE: React.CSSProperties = {
  ...SELECT_STRIP,
  cursor: "default",
  color: "var(--color-text-muted)",
};

export function TradeCandidatesDialog({
  collectionId,
  tradeId,
  lineId,
  areas,
  locations,
  baseCurrency,
  vendorMaps,
  onClose,
}: {
  collectionId: string;
  tradeId: string;
  lineId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  vendorMaps: AreaVendorMaps;
  onClose: () => void;
}) {
  const { data, isLoading } = useTradeLineCandidates(collectionId, tradeId, lineId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateTrade } = useInvalidateTradeDetail();

  /** One tick. The write is idempotent in both directions, so this is a plain call rather than a
   *  read-modify-write over a list the other tab may also be looking at. */
  function toggle(itemId: string, blocked: boolean) {
    setError(undefined);
    startTransition(async () => {
      const result = await setTradeCopyBlockAction(tradeId, itemId, blocked);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      // The whole `trades` key: the row's own chip counts this pool, and a count that still said
      // three after one was held back would be the screen disagreeing with the dialog on top of it.
      invalidateTrade(collectionId);
    });
  }

  function row(copy: ItemListItem, isLast: boolean, strip: React.ReactNode) {
    return (
      <div key={copy.id} style={{ display: "flex", alignItems: "stretch" }}>
        {strip}
        <div style={{ flex: 1, minWidth: 0 }}>
          <InventoryItemRow
            collectionId={collectionId}
            item={copy}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            primaryVendorId={
              copy.areaId ? (vendorMaps.primaryVendorByArea.get(copy.areaId) ?? null) : null
            }
            vendorMap={vendorMaps.vendorMapFor(copy.areaId, copy.issueId)}
            isLast={isLast}
            readOnly
            showCostBasis
          />
        </div>
      </div>
    );
  }

  if (typeof document === "undefined") return null;

  const candidates = data?.candidates ?? [];
  const editable = data?.editable ?? false;

  return createPortal(
    <DialogShell
      title="Alternatives on this line"
      onClose={onClose}
      maxWidth="min(96vw, 80rem)"
      height="min(90vh, 55rem)"
    >
      <p style={HINT}>
        {data?.closedReason ??
          "Every copy below answers this line exactly — same stamp, condition, certificate and " +
            "format — so sending any of them changes no figure on this trade. Untick one to hold it " +
            "back from this exchange; it stays available to every other trade."}
      </p>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={EMPTY}>Loading copies…</p>
        ) : (
          <>
            {data?.promised && (
              <>
                <div style={GROUP_HEADING}>
                  <Icon name="trades" size="sm" /> Promised
                </div>
                {row(
                  data.promised,
                  candidates.length === 0,
                  <span style={STRIP_NOTE}>
                    {/* No tick: this copy is the promise, not an alternative to it. */}
                    <Tooltip content="This is the copy the line promises. To stop offering it, remove the line or swap the copy.">
                      <span style={{ display: "inline-flex" }}>
                        <Icon name="locked" size="sm" />
                      </span>
                    </Tooltip>
                  </span>
                )}
              </>
            )}

            {candidates.length === 0 ? (
              <p style={EMPTY}>
                {data?.closedReason
                  ? "The alternatives to this line are settled."
                  : "No other copy of yours answers this line exactly. A copy differing in " +
                    "certificate or format is a different line, not an alternative — and one that " +
                    "is sold, gone, not yet in hand or promised to another trade is never offered."}
              </p>
            ) : (
              <>
                <div style={GROUP_HEADING}>
                  <Icon name="duplicate" size="sm" /> Alternatives ({candidates.length})
                </div>
                {candidates.map(({ copy, blocked }, i) =>
                  row(
                    copy,
                    i === candidates.length - 1,
                    <label style={{ ...SELECT_STRIP, cursor: editable ? "pointer" : "default" }}>
                      <input
                        type="checkbox"
                        checked={!blocked}
                        disabled={!editable || isPending}
                        onChange={(e) => toggle(copy.id, !e.target.checked)}
                        aria-label="Offer this copy to the partner"
                        style={{ cursor: editable ? "pointer" : "default" }}
                      />
                    </label>
                  )
                )}
              </>
            )}
          </>
        )}
      </div>

      <DialogFooter>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            Held back here, and here only — the copy stays available to every other trade.
          </span>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Done
          </DialogSecondaryButton>
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
