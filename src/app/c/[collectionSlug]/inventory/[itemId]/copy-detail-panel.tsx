"use client";

import Link from "next/link";
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
  EmptyNote,
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
import { useCollectionItemNoPad } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

// The copy detail screen (#517). Read-only by design: every field here is edited through the copy
// form dialog the list already opens, and a second editing surface for one record is two places to
// keep honest. What this page adds is *everything in one place* — the identity, the physical facts,
// the money, the photos, and the three relationships (purchase, offers, sale) that a list row can
// only hint at.

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

            {/* Only when there is something to read: an empty Notes card would push the rest of
                the column down to say that a free-text field was left blank. */}
            {item.notes && (
              <DetailCard title="Notes">
                <div style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{item.notes}</div>
              </DetailCard>
            )}

            <DetailCard title="Photos" count={item.photos.length || null}>
              {item.photos.length === 0 ? (
                <EmptyNote>No photos of this copy yet.</EmptyNote>
              ) : (
                <PhotoStrip collectionId={collectionId} photos={item.photos} size="7rem" />
              )}
            </DetailCard>

            <CatalogPricesCard
              target={{ kind: "stamp", stampId: item.stampId }}
              emptyText="No catalog price is recorded for this copy's stamp yet."
            />
          </DetailColumn>

          {/* Right: its trade history, in the order it happens — bought, sold, listed. */}
          <DetailColumn>
            <DetailCard title="Purchase">
              {item.purchase ? (
                <Link
                  href={`/c/${collectionSlug}/purchases/${item.purchase.id}`}
                  style={{ ...DETAIL_BUTTON, color: "var(--color-accent)" }}
                >
                  <Icon name="receipt" size="sm" /> {item.purchase.label}
                </Link>
              ) : (
                <EmptyNote>This copy is not linked to a purchase order.</EmptyNote>
              )}
            </DetailCard>

            <DetailCard title="Sale">
              {sale ? (
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
              ) : (
                <EmptyNote>This copy has not been sold.</EmptyNote>
              )}
            </DetailCard>

            <RelatedOffersCard collectionId={collectionId} target={{ kind: "item", itemId: item.id }} />
          </DetailColumn>
        </DetailColumns>
      </DetailLayout>
    </>
  );
}
