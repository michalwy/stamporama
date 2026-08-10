"use client";

import { useState } from "react";
import Link from "next/link";
import type { IssueListItem, StampNodeData } from "@/lib/issues";
import type { CollectionAreaData } from "@/lib/areas";
import type { IssueCompleteness } from "@/lib/issue-completeness";
import {
  COMPLETENESS_DISPOSITIONS,
  COMPLETENESS_DISPOSITION_LABEL,
} from "@/lib/issue-completeness-rules";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
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
import {
  IssueTitle,
  IssueCatalogChips,
  StampCountBadge,
  StampTitle,
  StampDetailLine,
  buildStampTree,
  type StampTreeNodeData,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { CatalogPricesCard } from "@/app/c/[collectionSlug]/shared/catalog-prices-card";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { RowQuickActions } from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import { StalePriceIcon } from "@/app/c/[collectionSlug]/shared/stale-price-icon";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { PRICE_MAIN, PRICE_CONVERTED } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { RelatedCopiesCard } from "@/app/c/[collectionSlug]/inventory/related-copies-card";
import { RelatedOffersCard } from "@/app/c/[collectionSlug]/offers/related-offers-card";

// The issue detail screen (#519). Two things the list row cannot give: the stamp tree with enough
// room to read it, and the completeness question answered from the copies actually held rather
// than as one owned/not-owned indicator.

const CELL: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  fontSize: "0.8125rem",
  borderTop: "1px solid var(--color-border)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const HEAD: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  textAlign: "right",
  whiteSpace: "nowrap",
};

export function IssueDetailPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  issue,
  members,
  completeness,
  areas,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  issue: IssueListItem;
  members: StampNodeData[];
  completeness: IssueCompleteness;
  areas: CollectionAreaData[];
}) {
  const maps = useAreaVendorMaps(areas, collectionId);
  const vendorMap = maps.vendorMapFor(issue.collectionAreaId, issue.id);
  const primaryVendorId = maps.primaryVendorByArea.get(issue.collectionAreaId) ?? null;
  const areaPath = buildAreaPath(areas, issue.collectionAreaId);
  const total = issue.requiredPriceTotal;
  const tree = buildStampTree(members);

  return (
    <>
      <DetailBackLink href={`/c/${collectionSlug}/issues`} label="Back to issues" />

      <DetailLayout>
        <DetailFullRow style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <EntityNoChip entity="issue" no={issue.issueNo} prefix="iss" />
          <span style={{ fontSize: "1rem" }}>
            <IssueTitle name={issue.name} year={issue.year} />
          </span>
          <IssueCatalogChips
            catalogNumbers={issue.catalogNumbers}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
            rangeSuggestions={issue.rangeSuggestions}
          />
          <StampCountBadge required={issue.requiredCount} total={issue.memberCount} />
        </DetailFullRow>

        <DetailColumns>
          {/* Left: what the issue *is* — its facts, its stamps, what they are worth. */}
          <DetailColumn>
            <DetailCard title="Details">
              <FieldGrid>
                <Field label="Area">{areaPath}</Field>
                <Field label="Year">{issue.year}</Field>
                <Field label="Stamps">
                  {issue.memberCount} ({issue.requiredCount} required for completeness)
                </Field>
                <Field label="Catalog value of the required stamps">
                  {total ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                      <span style={PRICE_MAIN}>{moneyPrimaryText(total)}</span>
                      {moneySecondaryText(total) && (
                        <span style={PRICE_CONVERTED}>{moneySecondaryText(total)}</span>
                      )}
                      {issue.requiredPriceStale && <StalePriceIcon />}
                      <Tooltip
                        content={`${total.pricedCount} of ${total.requiredCount} required stamps are priced${
                          total.estimatedCount
                            ? `; ${total.estimatedCount} rolled up from a variant child (estimate)`
                            : ""
                        }${
                          total.derivedCount
                            ? `; ${total.derivedCount} derived from the single by a format multiplier`
                            : ""
                        }.`}
                      >
                        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                          {total.pricedCount}/{total.requiredCount} priced
                        </span>
                      </Tooltip>
                    </span>
                  ) : null}
                </Field>
                <Field label="Created">{new Date(issue.createdAt).toLocaleDateString()}</Field>
                <Field label="Auto-created">{issue.isAutoCreated ? "Yes" : "No"}</Field>
              </FieldGrid>
            </DetailCard>

            <DetailCard title="Stamps" count={members.length || null}>
              {members.length === 0 ? (
                <EmptyNote>This issue has no stamps yet.</EmptyNote>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {tree.map((node) => (
                    <TreeNode
                      key={node.node.stampId}
                      node={node}
                      depth={0}
                      collectionId={collectionId}
                      collectionSlug={collectionSlug}
                      vendorMap={vendorMap}
                      primaryVendorId={primaryVendorId}
                    />
                  ))}
                </div>
              )}
            </DetailCard>

            <CatalogPricesCard
              target={{ kind: "issue", collectionId, issueId: issue.id }}
              title="Catalog value"
              emptyText="No catalog price is recorded for this issue's required stamps yet."
            />
          </DetailColumn>

          {/* Right: how the collection stands against it. */}
          <DetailColumn>
            <DetailCard title="Completeness">
              {completeness.requiredCount === 0 ? (
                <EmptyNote>
                  No stamp in this issue is marked required for completeness, so there is no set to be
                  complete against.
                </EmptyNote>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", minWidth: "24rem" }}>
                      <thead>
                        <tr>
                          <th style={{ ...HEAD, textAlign: "left" }}>Disposition</th>
                          <th style={HEAD}>Any condition</th>
                          {completeness.conditions.map((c) => (
                            <th key={c.id} style={HEAD}>
                              <Tooltip content={c.name}>
                                <span>{c.abbreviation}</span>
                              </Tooltip>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {COMPLETENESS_DISPOSITIONS.map((disposition) => (
                          <tr key={disposition}>
                            <td style={{ ...CELL, textAlign: "left", fontWeight: 500 }}>
                              {COMPLETENESS_DISPOSITION_LABEL[disposition]}
                            </td>
                            {[null, ...completeness.conditions.map((c) => c.id)].map((conditionId) => {
                              const row = completeness.rows.find(
                                (r) => r.disposition === disposition && r.conditionId === conditionId
                              );
                              if (!row) return <td key={conditionId ?? "any"} style={CELL} />;
                              return (
                                <td key={conditionId ?? "any"} style={CELL}>
                                  <Tooltip
                                    content={`${row.owned} of ${completeness.requiredCount} required stamps held · ${row.completeSets} complete ${
                                      row.completeSets === 1 ? "set" : "sets"
                                    }`}
                                  >
                                    <span
                                      style={{
                                        color:
                                          row.owned === completeness.requiredCount
                                            ? "var(--color-success)"
                                            : row.owned === 0
                                              ? "var(--color-text-muted)"
                                              : "var(--color-text-primary)",
                                      }}
                                    >
                                      {row.owned}/{completeness.requiredCount}
                                      {row.completeSets > 0 && (
                                        <span
                                          style={{
                                            marginLeft: "0.35rem",
                                            fontSize: "0.6875rem",
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          ×{row.completeSets}
                                        </span>
                                      )}
                                    </span>
                                  </Tooltip>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    Required stamps held, and after ×, how many complete sets those copies make — the
                    thinnest required stamp decides. Dispositions overlap: a copy can be in the
                    collection and for sale at once. Sold, disposed and undelivered copies are not
                    counted.
                  </div>
                </>
              )}
            </DetailCard>

            <RelatedCopiesCard
              collectionId={collectionId}
              areas={areas}
              baseCurrency={baseCurrency}
              target={{ kind: "issue", issueId: issue.id }}
              emptyText="No copy from this issue is recorded yet."
            />

            <RelatedOffersCard collectionId={collectionId} target={{ kind: "issue", issueId: issue.id }} />
          </DetailColumn>
        </DetailColumns>
      </DetailLayout>
    </>
  );
}

/** One member of the issue, and its variants under it. Every node links to its own screen (#518) —
 *  the tree is what this page is for, so it is drawn whole rather than behind an expander. */
function TreeNode({
  node,
  depth,
  collectionId,
  collectionSlug,
  vendorMap,
  primaryVendorId,
}: {
  node: StampTreeNodeData;
  depth: number;
  collectionId: string;
  collectionSlug: string;
  vendorMap: Map<string, import("@/lib/areas").AreaCatalogEntry>;
  primaryVendorId: string | null;
}) {
  const [hovered, setHovered] = useState(false);
  const detailPage = useDetailPageAction("stamp", node.node.stampId);

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.625rem",
          padding: "0.5rem 0",
          paddingLeft: `${depth * 1.5}rem`,
          borderTop: depth === 0 ? "1px solid var(--color-border)" : undefined,
        }}
      >
        {/* The stamp's own photo, on the stamp's own line. This is why the screen carries no
            separate issue gallery: a strip of thumbnails detached from the tree makes the reader
            match pictures to numbers by eye, which is the work the tree is already doing.
            `reserveWhenEmpty` keeps every line's text on one left edge whether or not there is a
            picture — a tree that jogs sideways per row is harder to read down than one with gaps. */}
        <PhotoThumb
          collectionId={collectionId}
          photos={node.node.photos}
          size="3rem"
          reserveWhenEmpty
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link
            href={`/c/${collectionSlug}/stamps/${node.node.stampId}`}
            style={{
              fontSize: "0.875rem",
              fontWeight: node.node.requiredForCompleteness ? 600 : 400,
              textDecoration: "none",
            }}
          >
            <StampTitle node={node.node} />
          </Link>
          <StampDetailLine
            node={node.node}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
          />
        </div>
        {/* The same dimmed icon the lists carry, on the same hover rule — a row inside a detail
            card is still a row, and the way to a record should not be a different gesture here
            than it is on the list this card mirrors. */}
        <RowQuickActions actions={[detailPage]} visible={hovered} />
      </div>
      {node.children.map((child) => (
        <TreeNode
          key={child.node.stampId}
          node={child}
          depth={depth + 1}
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          vendorMap={vendorMap}
          primaryVendorId={primaryVendorId}
        />
      ))}
    </>
  );
}
