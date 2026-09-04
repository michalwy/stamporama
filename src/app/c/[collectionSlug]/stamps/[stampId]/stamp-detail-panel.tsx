"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StampIssueMembership, StampListItem, StampRelatives } from "@/lib/stamps";
import type { IssueListItem } from "@/lib/issues";
import type { CollectionAreaData } from "@/lib/areas";
import { formatIssuedDate, moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
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
import {
  STAMP_ATTRIBUTE_FIELDS,
  statedStampAttributes,
} from "@/lib/stamp-attribute-kinds";
import { CatalogPricesCard } from "@/app/c/[collectionSlug]/shared/catalog-prices-card";
import { CopyCountBadge, dispositionParts } from "@/app/c/[collectionSlug]/shared/copy-count-badge";
import { RowQuickActions } from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import { StalePriceIcon } from "@/app/c/[collectionSlug]/shared/stale-price-icon";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { PhotoStrip } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { RelatedCopiesCard } from "@/app/c/[collectionSlug]/inventory/related-copies-card";
import { RelatedOffersCard } from "@/app/c/[collectionSlug]/offers/related-offers-card";
import { RelatedWantsCard } from "@/app/c/[collectionSlug]/wants/related-wants-card";
import { PRICE_MAIN, PRICE_CONVERTED } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { useInvalidateStamps } from "@/app/c/[collectionSlug]/stamps/use-stamps-query";
import { Icon } from "@/app/icons";
import { StampVariantsCard } from "./stamp-variants-card";

// The stamp detail screen (#518). Everything the flat list row hints at, at full size — and the
// two relationships a row cannot draw at all: the variant tree around it (#54) and the copies
// held of it (#348). The tree is also **worked** here (#630) — see `stamp-variants-card.tsx` for
// why that is not the page becoming a second editor.
//
// **Edit** on the identity band (#751) is #673's rule applied to this record: it opens the very
// dialog the Issues list opens, so there is still exactly one editor per stamp and not one field on
// this page becomes typeable in place. It closes an odd gap the Variants card left — that card has
// edited every stamp *under* this one since #630, while the stamp the page is actually about could
// only be reached by going back to a list and finding its row again. It sits on the band rather
// than on the Details card, because it is about the stamp as a whole and a button per card would be
// several of them saying the same thing.

export function StampDetailPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  stamp,
  relatives,
  treeIssue,
  areas,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  stamp: StampListItem;
  relatives: StampRelatives;
  /** The issue the Variants card writes against (#630) — {@link StampRelatives.treeIssueId}
   *  enriched as its list row, or null when this stamp belongs to no issue. */
  treeIssue: IssueListItem | null;
  areas: CollectionAreaData[];
}) {
  const maps = useAreaVendorMaps(areas, collectionId);
  const firstIssue = stamp.issues[0] ?? null;
  const vendorMap = maps.vendorMapFor(stamp.areaId, firstIssue?.issueId ?? null);
  const primaryVendorId = maps.primaryVendorByArea.get(stamp.areaId ?? "") ?? null;

  const areaPath = buildAreaPath(areas, stamp.areaId);
  const statedAttributes = statedStampAttributes(stamp.attributes);
  const issuedDate = formatIssuedDate(stamp.issuedDay, stamp.issuedMonth, stamp.issuedYear);
  const price = stamp.mainCatalogPrice;

  // The edit dialog this screen opens (#751). Its catalog-number inputs are labelled through the
  // same resolution the band's chips use — the area's vendors as the stamp's first issue overrides
  // them (#377) — so the prefix on the form is the prefix the numbers will actually carry.
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const areaVendors = [...vendorMap.values()];
  const { invalidateList: invalidateStamps } = useInvalidateStamps();
  function closeDialog() {
    if (isPending) return;
    setEditing(false);
    setError(undefined);
  }
  // The page is server-rendered, so a save is shown by re-reading it. The Stamps list's cached
  // pages go stale in the same breath: the collector arrived from one of its rows and **Back to
  // stamps** is the way out, so a row still reading the way it read before the edit is the one
  // thing this must not leave behind.
  function onSaved() {
    setEditing(false);
    setError(undefined);
    router.refresh();
    void invalidateStamps(collectionId);
  }

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
          <CopyCountBadge
            copies={stamp.copies}
            variantCopies={stamp.variantCopies}
            size="medium"
          />
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
          {/* What this screen can start (#751), at the end of the line that says which stamp it is
              about — the Issues list's own dialog, over this stamp. */}
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: "0.375rem" }}>
            <Tooltip content="Edit this stamp — name, issued date, catalog numbers, attributes and checklists.">
              <button type="button" style={DETAIL_BUTTON} onClick={() => setEditing(true)}>
                <Icon name="edit" size="sm" /> Edit
              </button>
            </Tooltip>
          </span>
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
                  {stamp.copies.total > 0 || stamp.variantCopies.total > 0
                    ? [
                        stamp.copies.total > 0 ? `${stamp.copies.total} held` : null,
                        // Markers, not slices: they overlap, so they are listed after the total
                        // rather than presented as its parts.
                        ...dispositionParts(stamp.copies),
                        // The variants' copies (#528) are held of something else and are stated as
                        // their own figure, never folded into the number before them.
                        stamp.variantCopies.total > 0 ? `${stamp.variantCopies.total} in variants` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null}
                </Field>
              </FieldGrid>
            </DetailCard>

            {/* What the catalogue states about this stamp beyond its number (#736). Display only:
                the values are edited in the dialog that already owns the record, because a detail
                page reads and does not become a second editor. The card omits itself when the stamp
                states none — which is the normal case, and six em dashes on every stamp would push
                what the page does say further down the column (#536). Once it is here it lists all
                six, so what is *not* stated is visible too. */}
            <DetailCard title="Attributes" empty={statedAttributes.length === 0}>
              <FieldGrid min="9rem">
                {STAMP_ATTRIBUTE_FIELDS.map(({ key, label }) => (
                  <Field key={key} label={label}>
                    {stamp.attributes[key]}
                  </Field>
                ))}
              </FieldGrid>
            </DetailCard>

            <DetailCard
              title="Issues"
              count={stamp.issues.length}
              empty={stamp.issues.length === 0}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {stamp.issues.map((m) => (
                  <IssueMembershipRow
                    key={m.issueId}
                    membership={m}
                    collectionSlug={collectionSlug}
                  />
                ))}
              </div>
            </DetailCard>

            <DetailCard
              title="Photos"
              count={stamp.photos.length}
              empty={stamp.photos.length === 0}
            >
              <PhotoStrip collectionId={collectionId} photos={stamp.photos} size="7rem" />
            </DetailCard>

            <CatalogPricesCard target={{ kind: "stamp", stampId: stamp.id }} />

            <StampVariantsCard
              collectionId={collectionId}
              collectionSlug={collectionSlug}
              stamp={stamp}
              relatives={relatives}
              treeIssue={treeIssue}
              maps={maps}
            />
          </DetailColumn>

          {/* Right: what the collection holds and does with it. */}
          <DetailColumn>
            {/* Leads the column, and renders **only when this stamp is wanted** (#532) — as every
                card here now does when it has nothing on it (#536), so the column is what this
                stamp actually has, in order, and nothing else. */}
            <RelatedWantsCard collectionId={collectionId} stampId={stamp.id} />

            <RelatedCopiesCard
              collectionId={collectionId}
              areas={areas}
              baseCurrency={baseCurrency}
              target={{ kind: "stamp", stampId: stamp.id }}
            />

            <RelatedOffersCard collectionId={collectionId} target={{ kind: "stamp", stampId: stamp.id }} />
          </DetailColumn>
        </DetailColumns>
      </DetailLayout>

      {/* The Issues list's own stamp dialog (#54), opened over this one stamp. Its memberships go in
          as they are — the dialog edits the first one's checklists, the same rule the Variants card
          and `toStampListItem` already follow. */}
      {editing && (
        <StampFormDialog
          mode="edit"
          stampId={stamp.id}
          collectionId={collectionId}
          stamp={{
            name: stamp.name,
            issuedDay: stamp.issuedDay,
            issuedMonth: stamp.issuedMonth,
            issuedYear: stamp.issuedYear,
            catalogNumbers: stamp.catalogNumbers,
            colnectId: stamp.colnectId,
            issues: stamp.issues.map((m) => ({
              issueId: m.issueId,
              checklists: m.checklists,
            })),
          }}
          areaVendors={areaVendors}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={(fd) =>
            startTransition(async () => {
              const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
              const result = await updateStampWithCatalogAction(stamp.id, fd);
              if (result.status === "success") onSaved();
              else if (result.status === "error") setError(result.message);
            })
          }
        />
      )}
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
