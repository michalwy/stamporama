"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { ItemListItem } from "@/lib/items";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { useSaleLineSetOptions } from "../use-sales-query";

// *Choose set* (#697): which of an offer's interchangeable sets actually left on this line.
//
// **Which set went is not a fact about the order.** An offer listed at quantity 3 has three sets and
// a buyer who takes one has said *one of these*, not *this one* — they are the same thing at the
// same price, which is why they are one listing. So this is the seller's own fulfilment choice, made
// at the packing table, and it stays changeable afterwards: a copy turns out to have a thin and a
// different one goes in the envelope.
//
// The list is deliberately the plain one — each set with the copies it holds, in the offer's own
// order — rather than the browse-and-filter shape `AddSaleLineDialog` has. That dialog searches the
// whole platform; this one is choosing among the two or three sets of a single listing, and a facet
// panel over three rows is furniture.

const HINT: React.CSSProperties = {
  padding: "1.5rem 0",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const CURRENT_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
  flexShrink: 0,
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.375rem",
  color: "var(--color-accent)",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--color-accent-border, var(--color-border))",
  background: "var(--color-accent-soft, var(--color-bg-page))",
};

export interface ChooseSetDialogProps {
  collectionId: string;
  lineId: string;
  /** What the copy rows need to draw themselves as the Copies list does — the area tree for the
   *  catalogue vocabulary (#379), the locations for the shelf chip, the base currency for the
   *  figures. Passed down rather than fetched here: the sale screen already holds all three. */
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (offerSetId: string) => void;
}

export function ChooseSetDialog({
  collectionId,
  lineId,
  areas,
  locations,
  baseCurrency,
  isPending,
  error,
  onClose,
  onSubmit,
}: ChooseSetDialogProps) {
  const { data, isLoading, isError } = useSaleLineSetOptions(collectionId, lineId);
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const copyById = useMemo(
    () => new Map((data?.copies ?? []).map((c) => [c.id, c])),
    [data]
  );
  const [touched, setTouched] = useState<string | null>(null);
  // Opens on the set the line names today, so *Choose* with nothing touched is **confirming** it —
  // which is exactly what a line marked pending needs from a collector who is happy with the pick.
  // Derived rather than seeded into state by an effect: the answer is a function of what came back.
  const picked = touched ?? data?.currentSetId ?? null;

  if (typeof document === "undefined") return null;

  const sets = data?.sets ?? [];
  // Choosing the set the line already names is *confirming* it, which the domain takes as an
  // idempotent write — so there is no state in which the button has to be withheld. A dialog that
  // shows one set and then refuses to let you press the only affordance on it would be asking the
  // collector to work out why.
  const canChoose = !isPending && !!picked;

  return createPortal(
    <DialogShell
      title="Choose set"
      onClose={onClose}
      maxWidth="min(94vw, 60rem)"
      height="min(90vh, 46rem)"
      zIndexBase={120}
    >
      <DialogBody>
        {data && (
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            {data.offerLabel} — pick the set that actually left. The sale price stays as it is; the
            copies on this line move to the set you choose.
          </p>
        )}

        {isLoading ? (
          <p style={HINT}>Loading sets…</p>
        ) : isError || !data ? (
          <p style={HINT}>This line&rsquo;s sets could not be loaded.</p>
        ) : (
          // The list is drawn **whatever its length**, an offer with a single set included. What the
          // collector came here to see is which set this line is standing on, and a sentence saying
          // there is nothing else to choose answers a question they did not ask while withholding
          // the one they did. A one-row list marked *On this line now* says both at once.
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              overflow: "clip",
            }}
          >
            {sets.map((s, i) => {
              const isPicked = picked === s.offerSetId;
              // The set's copies in the set's own order, enriched as the Copies list draws them.
              // Empty only while the read is in flight, where the labels below stand in for them.
              const rows = s.itemIds
                .map((id) => copyById.get(id))
                .filter((c): c is ItemListItem => !!c);
              return (
                <div
                  key={s.offerSetId}
                  style={{
                    borderTop: i === 0 ? undefined : "1px solid var(--color-border)",
                    background: isPicked ? "var(--color-bg-row-hover)" : undefined,
                  }}
                >
                  {/* Only the heading is the label: the copy rows below carry controls of their own,
                      and a label wrapped round them would select the radio on every click inside. */}
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.625rem",
                      padding: "0.625rem 0.875rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="choose-set"
                      checked={isPicked}
                      onChange={() => setTouched(s.offerSetId)}
                      style={{ marginTop: "0.2rem", flexShrink: 0 }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          color: "var(--color-text-primary)",
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.label}
                        </span>
                        {s.offerSetId === data.currentSetId && (
                          <span style={CURRENT_CHIP}>On this line now</span>
                        )}
                      </div>
                      <div
                        style={{
                          marginTop: "0.1875rem",
                          fontSize: "0.75rem",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {s.itemLabels.length} cop{s.itemLabels.length === 1 ? "y" : "ies"}
                        {rows.length === 0 && s.itemLabels.length > 0
                          ? ` · ${s.itemLabels.join(", ")}`
                          : ""}
                      </div>
                    </div>
                  </label>

                  {/* What is actually in the set, **always open**: choosing between interchangeable
                      sets is choosing between physical pieces, and what separates two copies of one
                      stamp — a thin, a corner, the cancel — is only visible in the scan. Behind a
                      toggle this dialog would name three identical rows and send the collector
                      somewhere else to do the comparing. */}
                  {rows.length > 0 && (
                    <div style={{ background: "var(--color-bg-page)", paddingLeft: "2.25rem" }}>
                      {rows.map((item, j) => (
                        <InventoryItemRow
                          key={item.id}
                          collectionId={collectionId}
                          item={item}
                          areas={areas}
                          locations={locations}
                          baseCurrency={baseCurrency}
                          primaryVendorId={
                            item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null
                          }
                          vendorMap={vendorMapFor(item.areaId, item.issueId)}
                          isLast={j === rows.length - 1}
                          readOnly
                          showCostBasis
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Said **under** the list rather than in place of it (above): with one row on screen the
            collector can see there is nothing else, and what is worth adding is *why* — every other
            set of this offer has left on a sale of its own. */}
        {data && sets.length === 1 && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            No other set of this offer is still available, so this is the only one this line could
            have gone out as. Choosing it confirms it.
          </p>
        )}

        {error && <ErrorBubble>{error}</ErrorBubble>}
      </DialogBody>

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <DialogPrimaryButton
          type="button"
          disabled={!canChoose}
          onClick={() => picked && onSubmit(picked)}
        >
          {isPending ? "Saving…" : "Choose"}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
