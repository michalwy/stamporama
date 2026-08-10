"use client";

import { useState } from "react";
import Link from "next/link";
import type { StampIssueMembership, StampListItem, StampRelatives } from "@/lib/stamps";
import type { CollectionAreaData } from "@/lib/areas";
import { formatIssuedDate, moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import {
  DetailBackLink,
  DetailCard,
  DetailFullRow,
  DetailLayout,
  DetailColumn,
  DetailColumns,
  EmptyNote,
  Field,
  FieldGrid,
} from "@/app/c/[collectionSlug]/shared/detail-page";
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { CatalogPricesCard } from "@/app/c/[collectionSlug]/shared/catalog-prices-card";
import { CopyCountBadge } from "@/app/c/[collectionSlug]/shared/copy-count-badge";
import { RowQuickActions } from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import { StalePriceIcon } from "@/app/c/[collectionSlug]/shared/stale-price-icon";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { PhotoStrip } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { RelatedCopiesCard } from "@/app/c/[collectionSlug]/inventory/related-copies-card";
import { RelatedOffersCard } from "@/app/c/[collectionSlug]/offers/related-offers-card";
import { PRICE_MAIN, PRICE_CONVERTED } from "@/app/c/[collectionSlug]/shared/chip-styles";

// The stamp detail screen (#518). Everything the flat list row hints at, at full size — and the
// two relationships a row cannot draw at all: the variant tree around it (#54) and the copies
// held of it (#348).

export function StampDetailPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  stamp,
  relatives,
  areas,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  stamp: StampListItem;
  relatives: StampRelatives;
  areas: CollectionAreaData[];
}) {
  const maps = useAreaVendorMaps(areas, collectionId);
  const firstIssue = stamp.issues[0] ?? null;
  const vendorMap = maps.vendorMapFor(stamp.areaId, firstIssue?.issueId ?? null);
  const primaryVendorId = maps.primaryVendorByArea.get(stamp.areaId ?? "") ?? null;

  const areaPath = buildAreaPath(areas, stamp.areaId);
  const issuedDate = formatIssuedDate(stamp.issuedDay, stamp.issuedMonth, stamp.issuedYear);
  const price = stamp.mainCatalogPrice;

  return (
    <>
      <DetailBackLink href={`/c/${collectionSlug}/stamps`} label="Back to stamps" />

      <DetailLayout>
        <DetailFullRow style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <StampIdentity
            stamp={stamp}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
          />
          <CopyCountBadge copies={stamp.copies} size="medium" />
          {price && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <span style={PRICE_MAIN}>{moneyPrimaryText(price)}</span>
              {moneySecondaryText(price) && (
                <span style={PRICE_CONVERTED}>{moneySecondaryText(price)}</span>
              )}
              {stamp.mainCatalogPriceStale && <StalePriceIcon />}
              {stamp.mainCatalogPriceDerived && (
                <Tooltip content="Derived from the single's price by a format multiplier, not read from a catalog">
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>≈</span>
                </Tooltip>
              )}
            </span>
          )}
        </DetailFullRow>

        <DetailColumns>
          {/* Left: the stamp itself — what it is, where it belongs, what it looks like,
              what it is worth, and what hangs around it in the variant tree. */}
          <DetailColumn>
            <DetailCard title="Details">
              <FieldGrid>
                <Field label="Area">{areaPath}</Field>
                <Field label="Issued">{issuedDate}</Field>
                <Field label="Subtype">
                  {stamp.subtype ? stamp.subtype.name : stamp.parentId ? null : "Base stamp"}
                </Field>
                <Field label="Copies held">
                  {stamp.copies.total > 0
                    ? [
                        `${stamp.copies.total} held`,
                        stamp.copies.inCollection ? `${stamp.copies.inCollection} in collection` : null,
                        stamp.copies.forSale ? `${stamp.copies.forSale} for sale` : null,
                        stamp.copies.forTrade ? `${stamp.copies.forTrade} for trade` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null}
                </Field>
              </FieldGrid>
            </DetailCard>

            <DetailCard title="Issues" count={stamp.issues.length || null}>
              {stamp.issues.length === 0 ? (
                <EmptyNote>This stamp does not belong to an issue.</EmptyNote>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  {stamp.issues.map((m) => (
                    <IssueMembershipRow
                      key={m.issueId}
                      membership={m}
                      collectionSlug={collectionSlug}
                    />
                  ))}
                </div>
              )}
            </DetailCard>

            <DetailCard title="Photos" count={stamp.photos.length || null}>
              {stamp.photos.length === 0 ? (
                <EmptyNote>No catalog photos of this stamp yet.</EmptyNote>
              ) : (
                <PhotoStrip collectionId={collectionId} photos={stamp.photos} size="7rem" />
              )}
            </DetailCard>

            <CatalogPricesCard
              target={{ kind: "stamp", stampId: stamp.id }}
              emptyText="No catalog price is recorded for this stamp yet."
            />

            <DetailCard title="Variants" count={relatives.children.length || null}>
              {!relatives.parent && relatives.children.length === 0 ? (
                <EmptyNote>
                  This stamp has no variants and hangs under no base stamp — it stands on its own.
                </EmptyNote>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {relatives.parent && (
                    <RelativeRow
                      role="Base stamp"
                      stamp={relatives.parent}
                      collectionSlug={collectionSlug}
                      maps={maps}
                    />
                  )}
                  {relatives.children.map((child) => (
                    <RelativeRow
                      key={child.id}
                      role="Variant"
                      stamp={child}
                      collectionSlug={collectionSlug}
                      maps={maps}
                      indented={!!relatives.parent}
                      showCopies
                    />
                  ))}
                </div>
              )}
            </DetailCard>
          </DetailColumn>

          {/* Right: what the collection holds and does with it. */}
          <DetailColumn>
            <RelatedCopiesCard
              collectionId={collectionId}
              areas={areas}
              baseCurrency={baseCurrency}
              target={{ kind: "stamp", stampId: stamp.id }}
              emptyText="No copy of this stamp is recorded yet."
            />

            <RelatedOffersCard collectionId={collectionId} target={{ kind: "stamp", stampId: stamp.id }} />
          </DetailColumn>
        </DetailColumns>
      </DetailLayout>
    </>
  );
}

/**
 * Which of an issue's checklists claim this stamp (#531). Named when there is one — the ordinary
 * case, and the name is what the collector reads a set by — counted when there are several, and
 * *Optional* when there are none, which is the extra that belongs to the issue but to no set.
 */
function ChecklistMembershipChip({
  checklists,
}: {
  checklists: { id: string; name: string; on: boolean }[];
}) {
  const on = checklists.filter((c) => c.on);
  return (
    <Tooltip
      content={
        on.length > 0
          ? `Counted towards ${on.map((c) => c.name).join(", ")}`
          : "An extra in this issue — on no checklist, so counted towards no set"
      }
    >
      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
        {on.length === 0
          ? "Optional"
          : on.length === 1
            ? on[0].name
            : `${on.length} checklists`}
      </span>
    </Tooltip>
  );
}

/** One issue the stamp is a member of, and which of its checklists count it. */
function IssueMembershipRow({
  membership,
  collectionSlug,
}: {
  membership: StampIssueMembership;
  collectionSlug: string;
}) {
  const [hovered, setHovered] = useState(false);
  const detailPage = useDetailPageAction("issue", membership.issueId);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
    >
      <Link
        href={`/c/${collectionSlug}/issues/${membership.issueId}`}
        style={{ fontSize: "0.875rem", color: "var(--color-accent)", textDecoration: "none" }}
      >
        {[membership.issueYear, membership.issueName].filter(Boolean).join(", ") ||
          "(unnamed issue)"}
      </Link>
      <ChecklistMembershipChip checklists={membership.checklists} />
      <span style={{ marginLeft: "auto" }}>
        <RowQuickActions actions={[detailPage]} visible={hovered} />
      </span>
    </div>
  );
}

/**
 * A neighbour in the variant tree: what it is to this stamp, its identity, and the same dimmed
 * icon every row in the app carries to reach a record's own screen.
 */
function RelativeRow({
  role,
  stamp,
  collectionSlug,
  maps,
  indented = false,
  showCopies = false,
}: {
  /** How this stamp relates to the one on screen — "Base stamp" or "Variant". */
  role: string;
  stamp: StampListItem;
  collectionSlug: string;
  maps: ReturnType<typeof useAreaVendorMaps>;
  indented?: boolean;
  showCopies?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const detailPage = useDetailPageAction("stamp", stamp.id);
  const vendorMap = maps.vendorMapFor(stamp.areaId, stamp.issues[0]?.issueId ?? null);
  const primaryVendorId = maps.primaryVendorByArea.get(stamp.areaId ?? "") ?? null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        paddingLeft: indented ? "1rem" : 0,
      }}
    >
      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
        {role}
      </span>
      <StampIdentity
        stamp={stamp}
        vendorMap={vendorMap}
        primaryVendorId={primaryVendorId}
        size="small"
        href={`/c/${collectionSlug}/stamps/${stamp.id}`}
      />
      {showCopies && <CopyCountBadge copies={stamp.copies} />}
      <span style={{ marginLeft: "auto" }}>
        <RowQuickActions actions={[detailPage]} visible={hovered} />
      </span>
    </div>
  );
}
