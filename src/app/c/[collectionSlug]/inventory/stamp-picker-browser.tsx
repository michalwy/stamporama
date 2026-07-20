"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogShell } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import type { IssueData, IssueListItem, StampNodeData } from "@/lib/issues";
import { createIssueAction, addStampToIssueAction } from "@/app/actions/issues";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { IssueDialog } from "@/app/c/[collectionSlug]/shared/issue-form-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import {
  effectiveVendorsForArea,
  effectivePrimaryVendorId,
  getDescendantIds,
} from "@/app/c/[collectionSlug]/shared/area-helpers";
import {
  formatStampCN,
  CREATE_LINK_STYLE,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
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
import { issueLabel, primaryLabel, type PickedStamp } from "./stamp-picker-shared";
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
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: String(issue.createdAt),
    catalogNumbers: issue.catalogNumbers,
    memberCount: issue.members.length,
    requiredCount: issue.completeness.required,
    requiredPriceTotal: null,
    requiredPriceStale: false,
    photos: [],
  };
}

/** Build the picked-stamp summary for a just-created stamp from its submitted
 * form data (the new row isn't in the refreshed tree synchronously), mirroring
 * how {@link IssueBrowser}'s handlePick composes labels. */
function buildPickedFromForm(
  areas: CollectionAreaData[],
  areaById: Map<string, CollectionAreaData>,
  issue: IssueData,
  stampId: string,
  fd: FormData
): PickedStamp {
  const vendors = effectiveVendorsForArea(areas, issue.collectionAreaId);
  const vm: VendorMap = new Map(vendors.map((v) => [v.catalogVendorId, v]));
  const cats: string[] = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("catalogNumber_")) continue;
    const num = String(value).trim();
    if (num) cats.push(formatStampCN(num, vm.get(key.slice("catalogNumber_".length))));
  }
  const name = (fd.get("name") as string | null)?.trim() || null;
  const areaName = areaById.get(issue.collectionAreaId)?.name ?? null;
  const secondary =
    [issue.name || issue.year ? issueLabel(issue.name, issue.year) : null, areaName]
      .filter(Boolean)
      .join(" · ") || null;
  return {
    stampId,
    primary: primaryLabel(cats, name),
    secondary,
    // A just-created stamp has no children yet, so it is never an unknown-variant base.
    unknownVariant: false,
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

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Selecting a parent area includes its descendants, so their issues surface too.
  const areaIds = useMemo(() => {
    if (!areaId) return null;
    const ids = getDescendantIds(areas, areaId);
    ids.add(areaId);
    return [...ids];
  }, [areas, areaId]);

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

  // Keep the capture-phase Escape handler stable while still reacting to whether a
  // nested create dialog is currently open (synced via effect, not during render).
  const createOpenRef = useRef(false);
  useEffect(() => {
    createOpenRef.current = create !== null;
  }, [create]);

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

  // This popup nests inside the item-form dialog, and a nested create dialog nests
  // inside this popup — all register document-level Escape handlers. Intercept
  // Escape in the capture phase and stop it so only the topmost surface closes: the
  // create dialog if one is open, otherwise the browser — never the parent form
  // (with its in-progress edits).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        if (createOpenRef.current) {
          setCreate(null);
          setCreateError(undefined);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

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

  function handleCreateStamp(issue: IssueData, issueId: string, fd: FormData) {
    startTransition(async () => {
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      if (result.status === "success" && result.stampId) {
        invalidatePickerData(collectionId);
        // Auto-select the freshly created stamp as the copy's target; `onPick` also
        // closes the browser (matching a normal pick).
        onPick(buildPickedFromForm(areas, areaById, issue, result.stampId, fd));
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
        maxWidth="min(94vw, 88rem)"
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
              const vendors = effectiveVendorsForArea(areas, issue.collectionAreaId);
              const uniqueVendors = Array.from(
                new Map(vendors.map((v) => [v.catalogVendorId, v])).values()
              );
              return (
                <StampFormDialog
                  mode="add"
                  collectionId={collectionId}
                  issues={[toIssueListItem(issue)]}
                  areaVendors={uniqueVendors}
                  prefilledIssueId={issue.id}
                  prefilledParentStampId={parentStampId ?? null}
                  isPending={isPending}
                  error={createError}
                  onClose={closeCreate}
                  onSubmit={(issueId, fd) => handleCreateStamp(issue, issueId, fd)}
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
  const [filter, setFilter] = useState("");

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Effective vendor entries + primary vendor per area (ancestor-inherited), matching
  // how the main issues list builds them — a parent/"All areas" mixes many areas.
  const vendorMapByArea = useMemo(() => {
    const m = new Map<string, VendorMap>();
    for (const a of areas) {
      const vendors = effectiveVendorsForArea(areas, a.id);
      m.set(a.id, new Map(vendors.map((v) => [v.catalogVendorId, v])));
    }
    return m;
  }, [areas]);

  const primaryVendorByArea = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of areas) m.set(a.id, effectivePrimaryVendorId(areas, a.id));
    return m;
  }, [areas]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter((issue) => {
      if ((issue.name ?? "").toLowerCase().includes(q)) return true;
      if (issue.year && String(issue.year).includes(q)) return true;
      // Match catalog numbers on their normalized key (vendor abbreviation + area
      // prefix + number) so a prefixed query resolves in any spacing — "Mi PL 200",
      // "MiPL200", "PL200", or bare "200" all hit the same stamp (#146).
      const vm = vendorMapByArea.get(issue.collectionAreaId);
      const keys = issue.members.flatMap((m) =>
        m.catalogNumbers.map((cn) => {
          const v = vm?.get(cn.catalogVendorId);
          return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
        })
      );
      return catalogKeyMatches(filter, keys);
    });
  }, [issues, filter, vendorMapByArea]);

  function handlePick(node: StampNodeData, unknownVariant: boolean, issue: IssueData) {
    const vm = vendorMapByArea.get(issue.collectionAreaId);
    const cat = node.catalogNumbers
      .map((cn) => formatStampCN(cn.number, vm?.get(cn.catalogVendorId)))
      .join(", ");
    const primary = [cat || null, node.name || null].filter(Boolean).join(" · ") || "(unnamed stamp)";
    const areaName = areaById.get(issue.collectionAreaId)?.name ?? null;
    const context = [
      issue.name || issue.year ? issueLabel(issue.name, issue.year) : null,
      areaName,
    ]
      .filter(Boolean)
      .join(" · ");
    onPick({ stampId: node.stampId, primary, secondary: context || null, unknownVariant });
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
              vendorMap={vendorMapByArea.get(issue.collectionAreaId) ?? new Map()}
              primaryVendorId={primaryVendorByArea.get(issue.collectionAreaId) ?? null}
              isLast={i === filtered.length - 1}
              defaultExpanded={issue.id === justCreatedIssueId}
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
  onPick: (node: StampNodeData, unknownVariant: boolean, issue: IssueData) => void;
  /** When set, an "Add whole issue" button appears on the row header (lot intake, #121). */
  onPickIssue?: () => void;
  onNewStamp: () => void;
  onNewVariant: (parentStampId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [hovered, setHovered] = useState(false);
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setIsExpanded((v) => !v)}
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
            setIsExpanded((v) => !v);
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
