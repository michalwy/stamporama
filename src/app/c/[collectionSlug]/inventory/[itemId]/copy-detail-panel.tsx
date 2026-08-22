"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ItemListItem } from "@/lib/items";
import type { ItemSaleRecord } from "@/lib/sales";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { formatItemNo } from "@/lib/item-number";
import { deliveryStateLabel, deliveryStateToken } from "@/lib/delivery-state";
import { disposalReasonLabel } from "@/lib/disposal";
import { saleStatusMeta } from "@/app/c/[collectionSlug]/sales/sale-status";
import {
  DetailBackLink,
  DetailCard,
  DetailFullRow,
  DetailLayout,
  DetailColumn,
  DetailColumns,
  DETAIL_BUTTON,
  Field,
  FieldGrid,
} from "@/app/c/[collectionSlug]/shared/detail-page";
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { CatalogPricesCard } from "@/app/c/[collectionSlug]/shared/catalog-prices-card";
import { RelatedOffersCard } from "@/app/c/[collectionSlug]/offers/related-offers-card";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { buildLocationPath } from "@/app/c/[collectionSlug]/shared/location-helpers";
import { PhotoStrip } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import {
  useCollectionCertificateStatuses,
  useCollectionItemNoPad,
  useInvalidateInventory,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
import { IdentifyVariantDialog } from "@/app/c/[collectionSlug]/inventory/identify-variant-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

// The copy detail screen (#517). Read-only by design: every field here is edited through the copy
// form dialog the list already opens, and a second editing surface for one record is two places to
// keep honest. What this page adds is *everything in one place* — the identity, the physical facts,
// the money, the photos, and the three relationships (purchase, offers, sale) that a list row can
// only hint at.
//
// The two acts a copy's own screen **starts** (#673) are the exception that proves it: **Edit** and
// **Identify variant** open the very dialogs the Copies list opens, so there is still exactly one
// editor per record and no field here becomes typeable in place. What they save is the trip back to
// the list to hunt down the row this page was opened from — the whole reason for the screen. They
// sit on the identity band rather than on the cards they would change, because they are about the
// copy as a whole and a per-card button would be four of them saying the same thing.
//
// Identify variant follows the row's own rule and shows only on an unknown-variant copy: elsewhere
// there is nothing to decide.

const ITEM_NO: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontFamily: "monospace",
  fontVariantNumeric: "tabular-nums",
  padding: "0.125rem 0.4rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

function StateChip({ label, token }: { label: string; token?: string }) {
  return (
    <span
      style={{
        fontSize: "0.75rem",
        fontWeight: 600,
        padding: "0.125rem 0.5rem",
        borderRadius: "0.375rem",
        whiteSpace: "nowrap",
        border: `1px solid ${token ? `var(--color-${token}-border)` : "var(--color-border)"}`,
        color: token ? `var(--color-${token})` : "var(--color-text-secondary)",
        background: token ? `var(--color-${token}-soft)` : "var(--color-bg-page)",
      }}
    >
      {label}
    </span>
  );
}

export function CopyDetailPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  item,
  areas,
  locations,
  sale,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  item: ItemListItem;
  areas: CollectionAreaData[];
  locations: LocationData[];
  sale: ItemSaleRecord | null;
}) {
  const maps = useAreaVendorMaps(areas, collectionId);
  const vendorMap = maps.vendorMapFor(item.areaId, item.issueId);
  const primaryVendorId = maps.primaryVendorByArea.get(item.areaId ?? "") ?? null;
  const itemNoPad = useCollectionItemNoPad(collectionId);

  // The two dialogs this screen opens (#673). The dictionaries the copy form needs are fetched
  // here rather than loaded on the server beside the copy: both are cached per collection and
  // shared with every other screen that opens the same dialog, and a page that is read far more
  // often than it is edited should not pay for them on the way in.
  const router = useRouter();
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const [dialog, setDialog] = useState<"none" | "edit" | "identify">("none");
  const [actionError, setActionError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const closeDialog = () => {
    if (isPending) return;
    setDialog("none");
    setActionError(undefined);
  };
  // The page is server-rendered, so a save is shown by re-reading it. The Copies list's own cached
  // pages are marked stale in the same breath — the collector arrived here from one of its rows and
  // **Back to copies** is the way out, so a row still reading the way it read before the edit is the
  // one thing this page must not leave behind.
  const { invalidateList: invalidateInventory } = useInvalidateInventory();
  const onSaved = () => {
    setDialog("none");
    setActionError(undefined);
    router.refresh();
    void invalidateInventory(collectionId);
  };

  const areaPath = buildAreaPath(areas, item.areaId);
  const locationPath = item.locationId ? buildLocationPath(locations, item.locationId) : null;

  const value = item.value;

  return (
    <>
      <DetailBackLink href={`/c/${collectionSlug}/inventory`} label="Back to copies" />

      <DetailLayout>
        <DetailFullRow style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <Tooltip content="Internal copy number — never changes, never reused">
            <span style={ITEM_NO}>{formatItemNo(item.itemNo, itemNoPad)}</span>
          </Tooltip>
          <StampIdentity
            stamp={{
              name: item.stampName,
              catalogNumbers: item.catalogNumbers,
              colnectId: item.colnectId,
              subtype: item.subtype,
            }}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
            href={`/c/${collectionSlug}/stamps/${item.stampId}`}
          />
          {item.unknownVariant && (
            <Tooltip content="Linked to a base stamp that has variants — which variant this copy is has not been decided">
              <span>
                <StateChip label="Variant unknown" token="warning" />
              </span>
            </Tooltip>
          )}
          {/* What this screen can start (#673), at the end of the line that says which copy it is
              about. Both open the Copies list's own dialogs. */}
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: "0.375rem" }}>
            {item.unknownVariant && (
              <Tooltip content="Say which variant this copy is, from the variants under its current stamp.">
                <button type="button" style={DETAIL_BUTTON} onClick={() => setDialog("identify")}>
                  <Icon name="variant" size="sm" /> Identify variant
                </button>
              </Tooltip>
            )}
            <Tooltip content="Edit this copy — condition, filing, disposition, notes and photos.">
              <button type="button" style={DETAIL_BUTTON} onClick={() => setDialog("edit")}>
                <Icon name="edit" size="sm" /> Edit
              </button>
            </Tooltip>
          </span>
        </DetailFullRow>

        <DetailFullRow style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
          {item.inCollection && <StateChip label="In collection" />}
          {item.forSale && <StateChip label="For sale" />}
          {item.forTrade && <StateChip label="For trade" />}
          <StateChip
            label={deliveryStateLabel(item.deliveryState)}
            token={deliveryStateToken(item.deliveryState)}
          />
          {item.sold && <StateChip label="Sold" token="success" />}
          {item.disposedAt && (
            <StateChip
              label={`Disposed — ${disposalReasonLabel(item.disposalReason ?? "other")}`}
              token="error"
            />
          )}
          {/* Promised in an agreed trade (#639) — the same fact the Copies list chips, from the same
              source, because a flag shown on a list is shown on the thing's own screen too. Here it
              is a link: the collector reading a copy's page and finding it committed wants the trade,
              and the number alone would leave them to go and search for it. */}
          {item.promisedTo && (
            <Tooltip
              content={`Promised to ${item.promisedTo.partnerName} in an agreed trade. It cannot go live on a marketplace while that stands.`}
            >
              <Link
                href={`/c/${collectionSlug}/trades/${item.promisedTo.tradeId}`}
                style={{ textDecoration: "none" }}
              >
                <StateChip label={`Promised — trade #${item.promisedTo.tradeNo}`} token="accent" />
              </Link>
            </Tooltip>
          )}
          {/* Gone to a partner (#644). The same source and the same link as the promise above, one
              stage further on: this copy is not in the collection any more, and the page it left
              through is the one that says what it was exchanged for. */}
          {item.tradedAway && (
            <Tooltip
              content={`Traded to ${item.tradedAway.partnerName} in a closed trade. It left the collection with no sale and no proceeds — what it cost was carried over into what came back.`}
            >
              <Link
                href={`/c/${collectionSlug}/trades/${item.tradedAway.tradeId}`}
                style={{ textDecoration: "none" }}
              >
                <StateChip label={`Traded away — trade #${item.tradedAway.tradeNo}`} token="success" />
              </Link>
            </Tooltip>
          )}
        </DetailFullRow>

        <DetailColumns>
          {/* Left: the copy itself — its facts, what was written about it, what it looks
              like, what its stamp is worth. */}
          <DetailColumn>
            <DetailCard title="Details">
              <FieldGrid>
                <Field label="Condition">
                  {item.conditionName} ({item.conditionAbbreviation})
                </Field>
                <Field label="Certificate">{item.certificateStatusName}</Field>
                <Field label="Format">{item.formatName ?? "Single"}</Field>
                <Field label="Delivery">{deliveryStateLabel(item.deliveryState)}</Field>
                <Field label="Area">{areaPath}</Field>
                <Field label="Issue">
                  {item.issueId ? (
                    <Link
                      href={`/c/${collectionSlug}/issues/${item.issueId}`}
                      style={{ color: "var(--color-accent)", textDecoration: "none" }}
                    >
                      {[item.issueYear, item.issueName].filter(Boolean).join(", ") || "(unnamed issue)"}
                    </Link>
                  ) : null}
                </Field>
                <Field label="Location">{locationPath}</Field>
                <Field label="Ref">{item.locationRef}</Field>
                <Field label="Cost basis">
                  {item.costBasis ? (
                    `${item.costBasis} ${baseCurrency}`
                  ) : item.lotId ? (
                    <Tooltip content="The purchase lot is still open — the cost per copy is not settled yet">
                      <span style={{ color: "var(--color-text-muted)" }}>Pending</span>
                    </Tooltip>
                  ) : null}
                </Field>
                <Field label="Catalog value">
                  {value.unpriced
                    ? null
                    : `${value.amount} ${value.currency}${
                        value.baseAmountDisplay && value.currency !== baseCurrency
                          ? ` ≈ ${value.baseAmountDisplay} ${baseCurrency}`
                          : ""
                      }${value.uncertain ? " (estimate)" : ""}`}
                </Field>
                <Field label="Added">{new Date(item.createdAt).toLocaleDateString()}</Field>
                {item.disposedAt && (
                  <Field label="Disposed">
                    {new Date(item.disposedAt).toLocaleDateString()}
                    {item.disposalNote ? ` — ${item.disposalNote}` : ""}
                  </Field>
                )}
              </FieldGrid>
            </DetailCard>

            <DetailCard title="Notes" empty={!item.notes}>
              <div style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{item.notes}</div>
            </DetailCard>

            <DetailCard title="Photos" count={item.photos.length} empty={item.photos.length === 0}>
              <PhotoStrip collectionId={collectionId} photos={item.photos} size="7rem" />
            </DetailCard>

            <CatalogPricesCard target={{ kind: "stamp", stampId: item.stampId }} />
          </DetailColumn>

          {/* Right: its trade history, in the order it happens — bought, sold, listed. */}
          <DetailColumn>
            <DetailCard title="Purchase" empty={!item.purchase}>
              {item.purchase && (
                <Link
                  href={`/c/${collectionSlug}/purchases/${item.purchase.id}`}
                  style={{ ...DETAIL_BUTTON, color: "var(--color-accent)" }}
                >
                  <Icon name="receipt" size="sm" /> {item.purchase.label}
                </Link>
              )}
            </DetailCard>

            <DetailCard title="Sale" empty={!sale}>
              {sale && (
                <FieldGrid>
                  <Field label="Sale">
                    <Link
                      href={`/c/${collectionSlug}/sales/${sale.saleId}`}
                      style={{ color: "var(--color-accent)", textDecoration: "none" }}
                    >
                      #{sale.saleNo}
                    </Link>
                  </Field>
                  <Field label="Sold on">{new Date(sale.soldAt).toLocaleDateString()}</Field>
                  <Field label="Status">{saleStatusMeta(sale.status).label}</Field>
                  <Field label="Platform">{sale.platformName}</Field>
                  <Field label="Buyer">{sale.buyerName}</Field>
                  <Field label={sale.lineItemCount > 1 ? `Line price (${sale.lineItemCount} copies)` : "Line price"}>
                    {sale.linePrice} {sale.currency}
                  </Field>
                  <Field label="Through offer">{sale.offerNo != null ? `#${sale.offerNo}` : null}</Field>
                  <Field label="Packed">{sale.packed ? "Yes" : "Not yet"}</Field>
                </FieldGrid>
              )}
            </DetailCard>

            <RelatedOffersCard collectionId={collectionId} target={{ kind: "item", itemId: item.id }} />
          </DetailColumn>
        </DetailColumns>
      </DetailLayout>

      {/* The Copies list's own dialogs (#99, #100), opened over this one copy. */}
      {dialog === "edit" && (
        <InventoryItemFormDialog
          mode="edit"
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          item={item}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            setActionError(undefined);
            startTransition(async () => {
              const { updateItemAction } = await import("@/app/actions/items");
              const result = await updateItemAction(item.id, fd);
              if (result.status === "success") onSaved();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {dialog === "identify" && (
        <IdentifyVariantDialog
          collectionId={collectionId}
          item={item}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            setActionError(undefined);
            startTransition(async () => {
              const { resolveItemVariantAction } = await import("@/app/actions/items");
              const result = await resolveItemVariantAction(item.id, fd);
              if (result.status === "success") onSaved();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </>
  );
}
