"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { IssueListItem, StampNodeData, IssueChecklistTotals } from "@/lib/issues";
import type { CollectionAreaData } from "@/lib/areas";
import type { IssueCompleteness, ChecklistCompleteness } from "@/lib/checklist-completeness";
import {
  COMPLETENESS_DISPOSITIONS,
  COMPLETENESS_DISPOSITION_LABEL,
} from "@/lib/checklist-completeness-rules";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
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
import {
  IssueTitle,
  IssueCatalogChips,
  ChecklistsBadge,
  ChecklistTreeFilter,
  filterStampTreeByChecklists,
  StampTitle,
  StampDetailLine,
  buildStampTree,
  type StampTreeNodeData,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import {
  ReorderModeButton,
  StampDragGrip,
  StampTreeGroup,
  useStampTreeReorder,
  type StampNodeDragProps,
  type StampTreeReorder,
} from "@/app/c/[collectionSlug]/shared/stamp-tree-reorder";
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
import { IssueDialog } from "@/app/c/[collectionSlug]/shared/issue-form-dialog";
import { useInvalidateIssues } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import { Icon } from "@/app/icons";

// The issue detail screen (#519). Two things the list row cannot give: the stamp tree with enough
// room to read it, and the completeness question answered from the copies actually held rather
// than as one owned/not-owned indicator.
//
// Since #531 the subject of that question is a **checklist**, and an issue may carry several. This
// is the screen with room for all of them: one card per checklist, each with its own grid — where
// the list row could only collapse them to a count.
//
// **Edit** on the identity band (#751) is #673's rule applied to this record: it opens the Issues
// list's own dialog, so there is still exactly one editor per issue and not one field on this page
// becomes typeable in place. The stamp tree below it is already *worked* here — reordered (#549),
// narrowed by checklist (#531) — for the reason #630 gives about the variant tree: those are the
// relationships between an issue's stamps, not fields of the issue. The issue's own fields had no
// way in at all, which meant a wrong year noticed on this screen was a trip back to the list.

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
  // Same narrowing the list row's expanded tree offers (#531), on the screen where the tree has
  // the most room. Local state for the same reason: the filter is per issue, and this page's copy
  // follows the list's rule rather than inventing a second one.
  const [treeChecklistIds, setTreeChecklistIds] = useState<string[]>([]);
  const router = useRouter();
  // Manual ordering (#549), the same mode the list row's tree carries. This page's members are a
  // server prop, so a saved reorder asks the route for fresh data; the optimistic order the hook
  // holds is what the tree is drawn from until it arrives.
  const treeReorder = useStampTreeReorder({
    collectionId,
    issueId: issue.id,
    members,
    onSaved: () => router.refresh(),
  });
  // The edit dialog this screen opens (#751) — the Issues list's own, over this issue.
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const { invalidateList: invalidateIssues } = useInvalidateIssues();
  function closeDialog() {
    if (isPending) return;
    setEditing(false);
    setError(undefined);
  }
  // Server-rendered page, so a save is shown by re-reading it; the Issues list goes stale with it,
  // because **Back to issues** is the way out and its row must not still read as it did before.
  function onSaved() {
    setEditing(false);
    setError(undefined);
    router.refresh();
    void invalidateIssues(collectionId);
  }
  // Dropped while reordering: a drag inside a narrowed tree would move a stamp past a sibling
  // that was never on screen, and the server refuses a partial group.
  const { tree, contextIds } = filterStampTreeByChecklists(
    buildStampTree(treeReorder.members),
    treeReorder.active ? [] : treeChecklistIds
  );

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
          <ChecklistsBadge
            checklists={issue.checklists}
            requiredCount={issue.requiredCount}
            memberCount={issue.memberCount}
          />
          {/* What this screen can start (#751), at the end of the line that says which issue it is
              about. */}
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: "0.375rem" }}>
            <Tooltip content="Edit this issue — name, year, area, catalog numbers and checklists.">
              <button type="button" style={DETAIL_BUTTON} onClick={() => setEditing(true)}>
                <Icon name="edit" size="sm" /> Edit
              </button>
            </Tooltip>
          </span>
        </DetailFullRow>

        <DetailColumns>
          {/* Left: what the issue *is* — its facts, its stamps, what they are worth. */}
          <DetailColumn>
            <DetailCard title="Details">
              <FieldGrid>
                <Field label="Area">{areaPath}</Field>
                <Field label="Year">{issue.year}</Field>
                <Field label="Stamps">
                  {issue.memberCount} ({issue.requiredCount} on a checklist)
                </Field>
                {/* One value line per checklist (#531): summing them would double-count a stamp a
                    basic and a specialized set both claim, so each set states its own worth. */}
                {issue.checklists.map((c) =>
                  c.priceTotal ? (
                    <Field key={c.id} label={`Catalog value — ${c.name}`}>
                      <ChecklistValue checklist={c} />
                    </Field>
                  ) : null
                )}
                <Field label="Created">{new Date(issue.createdAt).toLocaleDateString()}</Field>
                <Field label="Auto-created">{issue.isAutoCreated ? "Yes" : "No"}</Field>
              </FieldGrid>
            </DetailCard>

            <DetailCard
              title="Stamps"
              count={members.length || null}
              // Absent when the issue holds nothing (#536). A tree the *filter* narrowed to nothing
              // is a different thing and stays: the control that emptied it lives in this header.
              empty={members.length === 0}
              actions={
                issue.checklists.length > 1 && !treeReorder.active ? (
                  <ChecklistTreeFilter
                    checklists={issue.checklists}
                    selected={treeChecklistIds}
                    onChange={setTreeChecklistIds}
                  />
                ) : undefined
              }
            >
              {tree.length === 0 ? (
                <EmptyNote>No stamp is on the checklists you picked.</EmptyNote>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <StampTreeGroup
                    nodes={tree}
                    parentStampId={null}
                    reorder={treeReorder.reorder}
                    renderNode={({ node, drag }) => (
                      <TreeNode
                        node={node}
                        depth={0}
                        contextIds={contextIds}
                        collectionId={collectionId}
                        collectionSlug={collectionSlug}
                        vendorMap={vendorMap}
                        primaryVendorId={primaryVendorId}
                        reorder={treeReorder.reorder}
                        drag={drag}
                      />
                    )}
                  />
                </div>
              )}
              {/* At the foot of the tree, as on the list row (#549) — reordering is done to the
                  tree as a whole, and this is where the eye lands after reading down it. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  paddingTop: "0.75rem",
                }}
              >
                <ReorderModeButton active={treeReorder.active} onToggle={treeReorder.toggle} />
                {treeReorder.error ? (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-danger)" }}>
                    {treeReorder.error}
                  </span>
                ) : (
                  treeReorder.active && (
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Drag a stamp by its grip. A stamp only moves among its own siblings.
                    </span>
                  )
                )}
              </div>
            </DetailCard>

            {/* One card per checklist, for the same reason the value fields are per checklist. */}
            {issue.checklists.map((c) => (
              <CatalogPricesCard
                key={c.id}
                target={{ kind: "checklist", collectionId, checklistId: c.id }}
                title={
                  issue.checklists.length === 1 ? "Catalog value" : `Catalog value — ${c.name}`
                }
              />
            ))}
          </DetailColumn>

          {/* Right: how the collection stands against it. */}
          <DetailColumn>
            {/* One card per checklist — and none at all for an issue that carries no checklist
                (#536): there is then no set to be complete against, and a card saying so was a
                heading over a sentence. The way to add one is the issue's own ⋮ menu, which is
                where checklists are managed from anyway. */}
            {completeness.checklists.map((checklist) => (
              <DetailCard
                key={checklist.checklistId}
                title={
                  completeness.checklists.length === 1
                    ? "Completeness"
                    : `Completeness — ${checklist.name}`
                }
              >
                <ChecklistCompletenessGrid
                  checklist={checklist}
                  conditions={completeness.conditions}
                  formats={completeness.formats}
                />
                <AddMissingToWantList
                  collectionId={collectionId}
                  checklistId={checklist.checklistId}
                  requiredCount={checklist.requiredCount}
                />
              </DetailCard>
            ))}

            <RelatedCopiesCard
              collectionId={collectionId}
              areas={areas}
              baseCurrency={baseCurrency}
              target={{ kind: "issue", issueId: issue.id }}
            />

            <RelatedOffersCard collectionId={collectionId} target={{ kind: "issue", issueId: issue.id }} />
          </DetailColumn>
        </DetailColumns>
      </DetailLayout>

      {/* The Issues list's own dialog (#142/#531), opened over this one issue. */}
      {editing && (
        <IssueDialog
          mode="edit"
          collectionId={collectionId}
          areas={areas}
          issue={issue}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={(fd) =>
            startTransition(async () => {
              const { updateIssueAction } = await import("@/app/actions/issues");
              const result = await updateIssueAction(collectionId, issue.id, fd);
              if (result.status === "success") onSaved();
              else if (result.status === "error") setError(result.message);
            })
          }
        />
      )}
    </>
  );
}

/** What one checklist is worth, with the caveats the figure carries. */
function ChecklistValue({ checklist }: { checklist: IssueChecklistTotals }) {
  const total = checklist.priceTotal;
  if (!total) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      <span style={PRICE_MAIN}>{moneyPrimaryText(total)}</span>
      {moneySecondaryText(total) && (
        <span style={PRICE_CONVERTED}>{moneySecondaryText(total)}</span>
      )}
      {checklist.priceStale && <StalePriceIcon />}
      <Tooltip
        content={`${total.pricedCount} of ${total.requiredCount} stamps on this checklist are priced${
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
  );
}

/** The roll-up tab: every format at once, which is what the card showed before #133's format axis. */
const ANY_FORMAT = "any";

/**
 * One checklist's disposition × condition grid — #519's card, once per set the issue carries.
 *
 * Format is the third axis (#133) and it is **tabs, not more columns**, the choice the catalog
 * price grid already made: the table is disposition × condition, and a third dimension inline is
 * unreadable. Only the formats the checklist is actually held in get a tab, so a collection that
 * owns singles and nothing else — nearly all of them — sees the card it always saw.
 */
function ChecklistCompletenessGrid({
  checklist,
  conditions,
  formats,
}: {
  checklist: ChecklistCompleteness;
  conditions: { id: string; name: string; abbreviation: string }[];
  formats: { id: string; name: string; abbreviation: string }[];
}) {
  const [activeFormat, setActiveFormat] = useState<string>(ANY_FORMAT);
  if (checklist.requiredCount === 0) {
    return (
      <EmptyNote>
        Nothing is on this checklist yet, so there is no set to be complete against.
      </EmptyNote>
    );
  }
  const formatName = (id: string | null) =>
    id === null ? "Single" : (formats.find((f) => f.id === id)?.name ?? "Format");
  const formatAbbr = (id: string | null) =>
    id === null ? "Single" : (formats.find((f) => f.id === id)?.abbreviation ?? "?");
  // A single format held is no choice to offer: its grid and the roll-up are the same numbers.
  const tabs =
    checklist.formats.length > 1
      ? [{ key: ANY_FORMAT, label: "Any format", title: "Every format together" }, ...checklist.formats.map((f) => ({
          key: f.formatId ?? "",
          label: formatAbbr(f.formatId),
          title:
            f.formatId === null
              ? "Single stamps only — a multiple is not one of them"
              : formatName(f.formatId),
        }))]
      : [];
  const active =
    tabs.length === 0 || activeFormat === ANY_FORMAT
      ? null
      : (checklist.formats.find((f) => (f.formatId ?? "") === activeFormat) ?? null);
  const rows = active ? active.rows : checklist.rows;
  return (
    <>
      {tabs.length > 0 && (
        <div
          role="tablist"
          aria-label="Format"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.25rem",
            borderBottom: "1px solid var(--color-border)",
            paddingBottom: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.key === activeFormat;
            return (
              <Tooltip key={tab.key || "single"} content={tab.title}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveFormat(tab.key)}
                  style={{
                    padding: "0.25rem 0.625rem",
                    fontSize: "0.8125rem",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    background: isActive ? "var(--color-bg-page)" : "transparent",
                    border: `1px solid ${isActive ? "var(--color-border-strong)" : "transparent"}`,
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: "24rem" }}>
          <thead>
            <tr>
              <th style={{ ...HEAD, textAlign: "left" }}>Disposition</th>
              <th style={HEAD}>Any condition</th>
              {conditions.map((c) => (
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
                {[null, ...conditions.map((c) => c.id)].map((conditionId) => {
                  const row = rows.find(
                    (r) => r.disposition === disposition && r.conditionId === conditionId
                  );
                  if (!row) return <td key={conditionId ?? "any"} style={CELL} />;
                  return (
                    <td key={conditionId ?? "any"} style={CELL}>
                      <Tooltip
                        content={`${row.owned} of ${checklist.requiredCount} stamps held · ${row.completeSets} complete ${
                          row.completeSets === 1 ? "set" : "sets"
                        }`}
                      >
                        <span
                          style={{
                            color:
                              row.owned === checklist.requiredCount
                                ? "var(--color-success)"
                                : row.owned === 0
                                  ? "var(--color-text-muted)"
                                  : "var(--color-text-primary)",
                          }}
                        >
                          {row.owned}/{checklist.requiredCount}
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
        Stamps of this checklist held, and after ×, how many complete sets those copies make — the
        thinnest one decides. Dispositions overlap: a copy can be in the collection and for sale at
        once. Sold, disposed and undelivered copies are not counted.
        {active
          ? ` Counting ${formatName(active.formatId).toLowerCase()} copies only — a multiple never counts toward a set of singles.`
          : tabs.length > 0
            ? " Every format together; pick one above to ask whether the set is complete in it."
            : ""}
      </div>
    </>
  );
}

/**
 * "Add missing to want list" (#532; ADR-0032 §6).
 *
 * A **generator, not a live source**: it writes explicit, editable want rows once, for the
 * checklist stamps with no held copy and no open want, and a checklist edited afterwards touches
 * nothing. Every want it creates is wide open — "anything will do" — because a gap says only that
 * the stamp is absent, and inventing acceptance criteria from that is the derivation this design
 * refuses.
 *
 * Pressing it a second time is a no-op rather than a pile of duplicates, which is why it can stay
 * a plain button with no confirmation: the worst it does is nothing.
 */
function AddMissingToWantList({
  collectionId,
  checklistId,
  requiredCount,
}: {
  collectionId: string;
  checklistId: string;
  requiredCount: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (requiredCount === 0) return null;

  return (
    <div
      style={{
        marginTop: "0.75rem",
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const { addMissingToWantListAction } = await import("@/app/actions/wants");
            const result = await addMissingToWantListAction(collectionId, checklistId);
            if (result.status === "error") {
              setMessage(result.message);
              return;
            }
            if (result.missing === 0) {
              setMessage("Nothing is missing from this checklist.");
            } else if (result.created === 0) {
              setMessage(
                `All ${result.missing} missing ${result.missing === 1 ? "stamp is" : "stamps are"} already on the want list.`
              );
            } else {
              setMessage(
                `Added ${result.created} ${result.created === 1 ? "want" : "wants"}, one per missing stamp. Edit what would satisfy each on the want list.`
              );
            }
          })
        }
        style={{
          padding: "0.3125rem 0.625rem",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
          background: "var(--color-bg-elevated)",
          color: "var(--color-text-primary)",
          cursor: isPending ? "not-allowed" : "pointer",
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? "Adding…" : "Add missing to want list"}
      </button>
      {message && (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{message}</span>
      )}
    </div>
  );
}

/** One member of the issue, and its variants under it. Every node links to its own screen (#518) —
 *  the tree is what this page is for, so it is drawn whole rather than behind an expander. */
function TreeNode({
  node,
  depth,
  contextIds,
  collectionId,
  collectionSlug,
  vendorMap,
  primaryVendorId,
  reorder,
  drag,
}: {
  node: StampTreeNodeData;
  depth: number;
  /** Stamps the checklist filter kept only as context for a matching descendant (#531). */
  contextIds: Set<string>;
  collectionId: string;
  collectionSlug: string;
  vendorMap: Map<string, import("@/lib/areas").AreaCatalogEntry>;
  primaryVendorId: string | null;
  /** Reorder mode (#549), passed down so this node's variants become a drag list of their own. */
  reorder: StampTreeReorder | null;
  /** This row's place in its sibling group's drag list, or null when it cannot move. */
  drag: StampNodeDragProps | null;
}) {
  const [hovered, setHovered] = useState(false);
  const detailPage = useDetailPageAction("stamp", node.node.stampId);

  return (
    <>
      <div
        {...(drag?.item ?? {})}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.625rem",
          padding: "0.5rem 0",
          paddingLeft: `${depth * 1.5}rem`,
          borderTop: depth === 0 ? "1px solid var(--color-border)" : undefined,
          // Context, not a member of the filtered set — see the list row's own tree.
          opacity: contextIds.has(node.node.stampId) ? 0.5 : undefined,
          ...(drag?.style ?? {}),
        }}
      >
        {/* The grip leads the row while reordering, as it does on the list's own tree. */}
        {reorder && <StampDragGrip drag={drag} />}
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
              fontWeight: node.node.checklistIds.length > 0 ? 600 : 400,
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
        <RowQuickActions actions={[detailPage]} visible={hovered && !reorder} />
      </div>
      <StampTreeGroup
        nodes={node.children}
        parentStampId={node.node.stampId}
        reorder={reorder}
        indent={(depth + 1) * 24}
        renderNode={({ node: child, drag: childDrag }) => (
          <TreeNode
            node={child}
            depth={depth + 1}
            contextIds={contextIds}
            collectionId={collectionId}
            collectionSlug={collectionSlug}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
            reorder={reorder}
            drag={childDrag}
          />
        )}
      />
    </>
  );
}
