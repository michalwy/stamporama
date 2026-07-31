"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogShell } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import type { IssueData, IssueListItem, StampNodeData } from "@/lib/issues";
import { createIssueAction, addStampToIssueAction } from "@/app/actions/issues";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import { IssueDialog } from "@/app/c/[collectionSlug]/shared/issue-form-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { CREATE_LINK_STYLE } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  buildStampTree,
  IssueTitle,
  IssueCatalogChips,
  StampCountBadge,
  type VendorMap,
  type StampTreeNodeData,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useIssuesByArea, useInvalidateInventory } from "./use-inventory-query";
import { issueLabel, orderedCatalogLabels, type PickedStamp } from "./stamp-picker-shared";
import { SelectableStampNode } from "./selectable-stamp-node";
import { PhotoThumb } from "./photo-thumb";

/** An in-progress inline create from the picker popup (#105): a new issue in an
 * area, or a new stamp / variant (parent set) in an issue. */
type CreateState =
  | { kind: "issue"; areaId: string | null }
  | { kind: "stamp"; issue: IssueData; parentStampId?: string };

/** Adapt a browser `IssueData` to the `IssueListItem` shape `StampFormDialog`
 * expects. Only id/name/year are actually read (the issue step is prefilled), so
 * list-only fields are filled with safe placeholders. */
function toIssueListItem(issue: IssueData): IssueListItem {
  return {
    id: issue.id,
    collectionId: issue.collectionId,
    issueNo: issue.issueNo,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    nameByLanguage: issue.nameByLanguage,
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: String(issue.createdAt),
    catalogNumbers: issue.catalogNumbers,
    catalogPrefixes: [],
    memberCount: issue.members.length,
    requiredCount: issue.completeness.required,
    requiredPriceTotal: null,
    requiredPriceStale: false,
    rangeSuggestions: [],
    photos: [],
  };
}

// ── Styles ──────────────────────────────────────────────────────────────────

const SEARCH_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const NEW_ISSUE_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.5rem 0.875rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Popup area→issue→stamp browser for the inventory picker (#104). Left: the area
 * tree (reused `AreaFilterSidebar`); "All areas" (no selection) lists every issue,
 * a parent area includes its descendants. Right: the scope's issues, text-filterable,
 * each expandable to its stamp/variant tree — rendered with the same shared
 * presentation as the main issues list, minus action buttons; a click selects. */
/** A whole issue picked for bulk intake (#121): the issue id, a display label, and how
 * many of its stamps are required-for-completeness (the copies that will be created). */
export interface PickedIssue {
  issueId: string;
  label: string;
  requiredCount: number;
}

export function StampPickerBrowser({
  collectionId,
  areas,
  onPick,
  onPickIssue,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  onPick: (picked: PickedStamp) => void;
  /** When provided, each issue row offers an "Add whole issue" action (lot intake, #121). */
  onPickIssue?: (picked: PickedIssue) => void;
  onClose: () => void;
}) {
  // Area + year come from the shared per-collection store (#143), so the picker
  // opens on the same filter as the lists and changes here carry back to them.
  // Year values: "none" = no-year bucket, a numeric string = a year, null = all.
  // Filtering is client-side — the picker already loads every in-scope issue.
  const { storedAreaId, storedYear, writeStore } =
    useCollectionFilterStore(collectionId);
  const areaId = storedAreaId;
  const year = storedYear;
  const setAreaId = useCallback(
    (id: string | null) => writeStore({ areaId: id, year: storedYear }),
    [writeStore, storedYear]
  );
  const setYear = useCallback(
    (y: string | null) => writeStore({ areaId: storedAreaId, year: y }),
    [writeStore, storedAreaId]
  );
  const [create, setCreate] = useState<CreateState | null>(null);
  const [createError, setCreateError] = useState<string>();
  const [justCreatedIssueId, setJustCreatedIssueId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { invalidatePickerData } = useInvalidateInventory();
  // Only for the inline create dialogs' catalog-number labels: an issue may override its area's
  // prefix (#377), and the input a number is typed into should be labelled with the prefix that
  // number will carry. The list below resolves its own for the rows it renders.
  const { vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  // Selecting a parent area brings its descendants' issues with it, unless the collector has
  // narrowed the scope to the node alone (#385) — the toggle is in the sidebar rendered below.
  const [includeSubAreas] = useSubtreeScope("area");
  const areaIds = useMemo(
    () => resolveAreaFilterIds(areas, areaId, includeSubAreas),
    [areas, areaId, includeSubAreas]
  );

  const { data: issues = [], isLoading } = useIssuesByArea(collectionId, areaIds);

  // Year facets from the full in-scope issue set (before the year filter), so the
  // counts stay stable while a year is selected. null → the "No year" bucket.
  const yearFacets = useMemo(() => {
    const counts = new Map<number | null, number>();
    for (const issue of issues) {
      counts.set(issue.year, (counts.get(issue.year) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([y, count]) => ({ year: y, count }))
      .sort((a, b) => {
        if (a.year === null) return 1;
        if (b.year === null) return -1;
        return b.year - a.year;
      });
  }, [issues]);

  const yearFilteredIssues = useMemo(() => {
    if (!year) return issues;
    if (year === "none") return issues.filter((i) => i.year === null);
    const y = Number(year);
    return issues.filter((i) => i.year === y);
  }, [issues, year]);

  const selectedYearNumber = year && year !== "none" ? Number(year) : undefined;

  function closeCreate() {
    if (!isPending) {
      setCreate(null);
      setCreateError(undefined);
    }
  }

  function openCreate(next: CreateState) {
    setCreateError(undefined);
    setCreate(next);
  }

  // This popup nests inside the item-form dialog, and a nested create dialog nests inside this
  // popup. Each is its own Escape layer (#361), so the topmost one closes and the parent form keeps
  // its in-progress edits — `dismissable={!create}` below is what steps this popup aside while the
  // create dialog is up.

  function handleCreateIssue(newAreaId: string, fd: FormData) {
    startTransition(async () => {
      const result = await createIssueAction(collectionId, newAreaId, fd);
      if (result.status === "success") {
        if (result.issueId) setJustCreatedIssueId(result.issueId);
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  function handleCreateStamp(issueId: string, fd: FormData) {
    startTransition(async () => {
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      if (result.status === "success" && result.stampId) {
        // #182: creating a stamp inline just adds it to the picker — refresh so it appears
        // in its issue's (already-expanded) tree, then close the create dialog. It is not
        // auto-selected, and the browser stays open, so the user still picks it explicitly
        // (or keeps browsing), mirroring inline issue creation.
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  // The parent item-form dialog panel uses `transform` for centering, which makes
  // it the containing block for `position: fixed` descendants — so an un-portaled
  // popup gets clipped to that dialog's box. Portal to <body> to escape it. The
  // create dialogs are portaled as body-level siblings for the same reason (this
  // popup's own panel is also transform-centered).
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <DialogShell
        title="Browse stamps"
        onClose={onClose}
        // A create dialog stacks above this one; while it is up this dialog must stop dismissing
        // itself, or one Esc would close both.
        dismissable={!create}
        maxWidth="min(96vw, 110rem)"
        height="min(90vh, 60rem)"
      >
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* The sidebar is authored for the page layout (max-height: 100vh, sticky);
              wrap it so a long area tree scrolls within the dialog instead. */}
          <ListFilterSidebar
            variant="dialog"
            areas={areas}
            filterAreaId={areaId}
            onNavigateArea={setAreaId}
            yearFacets={yearFacets}
            yearsLoading={isLoading}
            selectedYear={year}
            onSelectYear={setYear}
          />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              borderLeft: "1px solid var(--color-border)",
            }}
          >
            <IssueBrowser
              collectionId={collectionId}
              areas={areas}
              selectedAreaId={areaId}
              issues={yearFilteredIssues}
              isLoading={isLoading}
              justCreatedIssueId={justCreatedIssueId}
              onPick={onPick}
              onPickIssue={onPickIssue}
              onNewIssue={(a) => openCreate({ kind: "issue", areaId: a })}
              onNewStamp={(issue) => openCreate({ kind: "stamp", issue })}
              onNewVariant={(issue, parentStampId) =>
                openCreate({ kind: "stamp", issue, parentStampId })
              }
            />
          </div>
        </div>
      </DialogShell>

      {/* These dialogs are portaled to <body>, but in the React tree they remain
          descendants of the inventory item <form> (this picker lives inside it). React
          events follow the React tree, not the DOM, so a create dialog's submit would
          bubble to that form and fire its "A stamp must be selected" validation. Contain
          submit here so creating an issue/stamp never triggers the outer copy form. */}
      {create && (
        <div style={{ display: "contents" }} onSubmit={(e) => e.stopPropagation()}>
          {create.kind === "issue" && (
            <IssueDialog
              mode="create"
              collectionId={collectionId}
              areas={areas}
              defaultAreaId={create.areaId ?? undefined}
              defaultYear={selectedYearNumber}
              isPending={isPending}
              error={createError}
              onClose={closeCreate}
              onSubmit={handleCreateIssue}
            />
          )}

          {create.kind === "stamp" &&
            (() => {
              const { issue, parentStampId } = create;
              // Already deduplicated by vendor, and carrying the issue's own prefix override (#377).
              const uniqueVendors = [...vendorMapFor(issue.collectionAreaId, issue.id).values()];
              // `members` is the issue's stamps *flat* (each carrying its own `parentId`), so a
              // parent is found by id however deep it hangs in the variant tree.
              const parent = issue.members.find((m) => m.stampId === parentStampId);
              return (
                <StampFormDialog
                  mode="add"
                  collectionId={collectionId}
                  issues={[toIssueListItem(issue)]}
                  areaVendors={uniqueVendors}
                  prefilledIssueId={issue.id}
                  prefilledParentStampId={parentStampId ?? null}
                  prefilledParentIssuedYear={parent?.issuedYear ?? null}
                  // A variant is numbered off its parent (`309` → `309A`), so the inputs open on
                  // the parent's numbers for the collector to suffix — the same prefill the
                  // issue list's add-variant entry does (#386).
                  defaultCatalogNumbers={parent?.catalogNumbers}
                  isPending={isPending}
                  error={createError}
                  onClose={closeCreate}
                  onSubmit={handleCreateStamp}
                />
              );
            })()}
        </div>
      )}
    </>,
    document.body
  );
}

function IssueBrowser({
  collectionId,
  areas,
  selectedAreaId,
  issues,
  isLoading,
  justCreatedIssueId,
  onPick,
  onPickIssue,
  onNewIssue,
  onNewStamp,
  onNewVariant,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  selectedAreaId: string | null;
  /** Issues in scope, already filtered by the year panel (#142). */
  issues: IssueData[];
  isLoading: boolean;
  justCreatedIssueId: string | null;
  onPick: (picked: PickedStamp) => void;
  onPickIssue?: (picked: PickedIssue) => void;
  onNewIssue: (areaId: string | null) => void;
  onNewStamp: (issue: IssueData) => void;
  onNewVariant: (issue: IssueData, parentStampId: string) => void;
}) {
  const [filter, setFilter] = usePersistedSearch(`${collectionId}:issues`);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Effective vendor entries + primary vendor per area (ancestor-inherited), matching how the main
  // issues list builds them — a parent/"All areas" mixes many areas — and applying each issue's own
  // prefix override (#377), so the picker's chips and its search keys read like the list's.
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  // Filter issues by the search term, matching issue name/year AND the stamps nested within each
  // issue — by stamp name or catalog number (#186). `innerMatchByIssue` records, for issues that
  // surfaced *only* because of an inner stamp match (the issue header itself didn't match), which
  // member stamps matched; the row uses it to reveal and highlight those while dimming the rest.
  const { filtered, innerMatchByIssue } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return { filtered: issues, innerMatchByIssue: new Map<string, Set<string>>() };
    const out: IssueData[] = [];
    const innerMatch = new Map<string, Set<string>>();
    for (const issue of issues) {
      const headerMatch =
        (issue.name ?? "").toLowerCase().includes(q) ||
        (issue.year != null && String(issue.year).includes(q));
      // Match catalog numbers on their normalized key (vendor abbreviation + area prefix +
      // number) so a prefixed query resolves in any spacing — "Mi PL 200", "MiPL200", "PL200",
      // or bare "200" all hit the same stamp (#146).
      const vm = vendorMapFor(issue.collectionAreaId, issue.id);
      const matchedStampIds = new Set<string>();
      for (const m of issue.members) {
        const nameHit = (m.name ?? "").toLowerCase().includes(q);
        const keys = m.catalogNumbers.map((cn) => {
          const v = vm.get(cn.catalogVendorId);
          return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
        });
        if (nameHit || catalogKeyMatches(filter, keys)) matchedStampIds.add(m.stampId);
      }
      if (headerMatch || matchedStampIds.size > 0) {
        out.push(issue);
        // Grey-out only when the issue surfaced purely via its stamps; a header match shows the
        // whole tree normally.
        if (!headerMatch && matchedStampIds.size > 0) innerMatch.set(issue.id, matchedStampIds);
      }
    }
    return { filtered: out, innerMatchByIssue: innerMatch };
  }, [issues, filter, vendorMapFor]);

  function handlePick(node: StampNodeData, unknownVariant: boolean, issue: IssueData) {
    const vm = vendorMapFor(issue.collectionAreaId, issue.id);
    const catalogLabels = orderedCatalogLabels(
      node.catalogNumbers,
      vm,
      primaryVendorByArea.get(issue.collectionAreaId) ?? null
    );
    const areaName = areaById.get(issue.collectionAreaId)?.name ?? null;
    const context = [
      issue.name || issue.year ? issueLabel(issue.name, issue.year) : null,
      areaName,
    ]
      .filter(Boolean)
      .join(" · ");
    onPick({
      stampId: node.stampId,
      catalogLabels,
      name: node.name,
      secondary: context || null,
      unknownVariant,
    });
  }

  return (
    <>
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          gap: "0.5rem",
        }}
      >
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={selectedAreaId ? "Filter issues in this area…" : "Filter issues…"}
          style={{ ...SEARCH_STYLE, flex: 1 }}
          aria-label="Filter issues"
          // Focus + select the remembered filter text on open, so typing overwrites it (#183).
          data-autofocus-select
        />
        <button
          type="button"
          onClick={() => onNewIssue(selectedAreaId)}
          style={NEW_ISSUE_BUTTON_STYLE}
        >
          + New issue
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={HINT_STYLE}>Loading issues…</p>
        ) : filtered.length === 0 ? (
          <p style={HINT_STYLE}>
            {issues.length === 0 ? "No issues here yet." : "No issues match your filter."}
          </p>
        ) : (
          filtered.map((issue, i) => (
            <PickIssueRow
              key={issue.id}
              issue={issue}
              areaName={areaById.get(issue.collectionAreaId)?.name ?? null}
              showArea={selectedAreaId !== issue.collectionAreaId}
              vendorMap={vendorMapFor(issue.collectionAreaId, issue.id)}
              primaryVendorId={primaryVendorByArea.get(issue.collectionAreaId) ?? null}
              isLast={i === filtered.length - 1}
              defaultExpanded={issue.id === justCreatedIssueId}
              justAdded={issue.id === justCreatedIssueId}
              matchedStampIds={innerMatchByIssue.get(issue.id) ?? null}
              onPick={handlePick}
              onPickIssue={
                onPickIssue
                  ? () =>
                      onPickIssue({
                        issueId: issue.id,
                        label: issueLabel(issue.name, issue.year),
                        requiredCount: issue.completeness.required,
                      })
                  : undefined
              }
              onNewStamp={() => onNewStamp(issue)}
              onNewVariant={(parentStampId) => onNewVariant(issue, parentStampId)}
            />
          ))
        )}
      </div>
    </>
  );
}

function PickIssueRow({
  issue,
  areaName,
  showArea,
  vendorMap,
  primaryVendorId,
  isLast,
  defaultExpanded,
  justAdded,
  matchedStampIds,
  onPick,
  onPickIssue,
  onNewStamp,
  onNewVariant,
}: {
  issue: IssueData;
  areaName: string | null;
  showArea: boolean;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  defaultExpanded: boolean;
  /** Flash this row once right after the issue is created inline (#158). */
  justAdded: boolean;
  /** When set, this issue surfaced only via matching stamps inside it (#186): expand the tree
   * and let the nodes dim non-matches. Null when the issue matched by name/year (show normally). */
  matchedStampIds: Set<string> | null;
  onPick: (node: StampNodeData, unknownVariant: boolean, issue: IssueData) => void;
  /** When set, an "Add whole issue" button appears on the row header (lot intake, #121). */
  onPickIssue?: () => void;
  onNewStamp: () => void;
  onNewVariant: (parentStampId: string) => void;
}) {
  const [userExpanded, setUserExpanded] = useState(defaultExpanded);
  const [hovered, setHovered] = useState(false);
  // An inner-stamp match forces the issue open (so the matching stamp is visible, #186); when the
  // filter clears, the row falls back to the user's own toggle.
  const isExpanded = userExpanded || matchedStampIds !== null;
  const tree = useMemo<StampTreeNodeData[]>(() => buildStampTree(issue.members), [issue.members]);
  // Issue-level gallery (#137): the main photos of the required-for-completeness stamps —
  // computed client-side from the members the picker already loaded.
  const issuePhotos = useMemo(
    () =>
      issue.members
        .filter((m) => m.requiredForCompleteness)
        .flatMap((m) => m.photos.filter((p) => p.role === "main")),
    [issue.members]
  );

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        className={justAdded ? "just-added-flash" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setUserExpanded(!isExpanded)}
        style={{
          padding: "0.875rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        {/* Expand/collapse toggle sits first, before the photo. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setUserExpanded(!isExpanded);
          }}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          style={{
            alignSelf: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: "0.25rem",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {isExpanded ? "▼" : "▶"}
        </button>

        {/* Issue-level gallery as a left column, matching the inventory list. Reserved even when
            empty for alignment. Stop propagation so opening a thumbnail's lightbox doesn't toggle
            the issue row. */}
        <div onClick={(e) => e.stopPropagation()}>
          <PhotoThumb collectionId={issue.collectionId} photos={issuePhotos} plain reserveWhenEmpty />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {showArea && areaName && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
                background: "var(--color-bg-page)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.25rem",
                padding: "0.1rem 0.4rem",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {areaName}
            </span>
          )}

          <span
            style={{
              flex: 1,
              fontSize: "0.9375rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <IssueTitle name={issue.name} year={issue.year} />
          </span>

          {onPickIssue && issue.completeness.required > 0 && (
            <Tooltip content="Add every required stamp of this issue to the lot" align="end">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPickIssue();
                }}
                style={{
                  flexShrink: 0,
                  padding: "0.25rem 0.5rem",
                  background: "transparent",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "0.375rem",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                + Whole issue ({issue.completeness.required})
              </button>
            </Tooltip>
          )}
        </div>

        {(issue.catalogNumbers.length > 0 || issue.members.length > 0) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              marginTop: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            <IssueCatalogChips
              catalogNumbers={issue.catalogNumbers}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
            />
            {issue.members.length > 0 && (
              <StampCountBadge required={issue.completeness.required} total={issue.members.length} />
            )}
          </div>
        )}
        </div>
      </div>

      {isExpanded && (
        <div
          style={{
            background: "var(--color-bg-elevated)",
            borderTop: "1px solid var(--color-border)",
            marginLeft: "1.25rem",
            borderLeft: "2px solid var(--color-border)",
          }}
        >
          {tree.length === 0 ? (
            <div
              style={{
                padding: "0.875rem 0 0.875rem 0.5rem",
                fontSize: "0.875rem",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              No stamps in this issue yet.
            </div>
          ) : (
            tree.map((treeNode, i) => (
              <SelectableStampNode
                key={treeNode.node.stampId}
                treeNode={treeNode}
                depth={0}
                collectionId={issue.collectionId}
                vendorMap={vendorMap}
                primaryVendorId={primaryVendorId}
                isLast={i === tree.length - 1}
                onPick={(node, unknownVariant) => onPick(node, unknownVariant, issue)}
                onNewVariant={onNewVariant}
                matchedStampIds={matchedStampIds}
              />
            ))
          )}
          <div style={{ padding: "0.625rem 1rem 0.75rem 0.5rem" }}>
            <button type="button" onClick={onNewStamp} style={CREATE_LINK_STYLE}>
              + New stamp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
