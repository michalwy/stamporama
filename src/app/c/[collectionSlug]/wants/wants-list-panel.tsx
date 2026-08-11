"use client";

import { useMemo, useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import type { CollectionAreaData } from "@/lib/areas";
import type { WantCreateInput, WantListItem } from "@/lib/wants";
// The priority vocabulary comes from the pure module: `@/lib/wants` is `server-only`.
import { WANT_PRIORITIES, WANT_PRIORITY_LABEL } from "@/lib/want-rules";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useDebouncedValue } from "@/app/c/[collectionSlug]/shared/autocomplete";
import { isWantPriority, type WantPriority } from "@/lib/want-rules";
import {
  useWantsInfinite,
  useWantIssueGroups,
  useWantYears,
  useInvalidateWants,
  type WantListFilters,
} from "./use-wants-query";
import { WantIssueGroupRow } from "./want-issue-group-row";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { WantFormDialog } from "./want-form-dialog";
import { useToast } from "@/app/toast-provider";
import { WantRow, type WantDictionaries } from "./want-row";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; want: WantListItem }
  | { kind: "delete"; want: WantListItem };

type StatusFilter = "open" | "closed" | "all";

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

/**
 * The want list (#532; ADR-0032) — what the collection is looking for.
 *
 * Filtered client-side over the whole list, like Contacts: a want list is bounded by what a
 * collector keeps track of by hand, and every filter offered is a property already on the row.
 *
 * The status filter defaults to **Open**, because that is the list's subject. Closed wants stay
 * reachable rather than being deleted — a closed want is the record that the thing was looked for
 * and found, which is what makes reopening it meaningful.
 */
export function WantsListPanel({
  collectionId,
  areas,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
}) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [priorities, setPriorities] = useState<WantPriority[]>([]);
  const [conditionIds, setConditionIds] = useState<string[]>([]);
  /**
   * Flat by default, one row per series on request (#532).
   *
   * A *view* of the list, not its shape. A want's subject is a stamp and its terms are per stamp,
   * so grouping is right for "what is left of this series" and wrong for the job the list is opened
   * for most — matching a stamp in hand against what is wanted. Remembered per collection, like
   * every other view preference here: it is how this collector reads their list, not a filter.
   */
  const [groupByIssue, setGroupByIssue] = usePersistedFlag(
    `stamporama:wants:groupByIssue:${collectionId}`
  );

  // Area + year come from the shared per-collection store (#143), so this screen opens on the same
  // scope the stamps, issues and inventory lists were left on, and a change here carries back to
  // them. No URL parameter, for the reason the stamp picker has none: every other filter on this
  // screen is local state too, and one half of the toolbar living in the address bar would be a
  // second mechanism for one job.
  const { storedAreaId, storedYear, writeStore } = useCollectionFilterStore(collectionId);
  const filterAreaId = storedAreaId;
  const year = storedYear;
  // Whether a selected area brings its sub-areas with it is the collector's choice (#385), shared
  // so every list agrees.
  const [includeSubAreas] = useSubtreeScope("area");
  const filterAreaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas),
    [areas, filterAreaId, includeSubAreas]
  );
  // What a whole-set add did, said in words. A control that can write twelve rows *or* none has to
  // report which, or "Add 12 wants" silently doing nothing reads as a bug.
  const [notice, setNotice] = useState<string | null>(null);

  const { invalidate } = useInvalidateWants();
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  const dictionaries: WantDictionaries = useMemo(
    () => ({
      conditions: new Map((conditions ?? []).map((c) => [c.id, c])),
      certificateStatuses: new Map((certificateStatuses ?? []).map((c) => [c.id, c])),
      formats: new Map((formats ?? []).map((f) => [f.id, f])),
    }),
    [conditions, certificateStatuses, formats]
  );

  // Typing narrows on the server now, so the request waits for the typist to stop. 300ms is the
  // delay every other search box here uses.
  const debouncedQuery = useDebouncedValue(query);

  /**
   * Everything the year facets are counted against — that is, every filter *except* the year, so a
   * facet says how many wants that year would leave rather than how many survive a year already
   * picked. The list filters are the same object plus the year, which keeps the two questions from
   * drifting apart.
   */
  const facetFilters = useMemo(
    () => ({
      status,
      priorities: priorities.length > 0 ? priorities : undefined,
      conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
      areaIds: filterAreaIds ?? undefined,
      search: debouncedQuery.trim() || undefined,
    }),
    [status, priorities, conditionIds, filterAreaIds, debouncedQuery]
  );
  const listFilters: WantListFilters = useMemo(
    () => ({ ...facetFilters, year: year || undefined }),
    [facetFilters, year]
  );

  // Only the view in front of the collector is fetched; the other is not kept warm for a toggle
  // that is pressed rarely.
  const flat = useWantsInfinite(collectionId, listFilters, !groupByIssue);
  const grouped = useWantIssueGroups(collectionId, listFilters, groupByIssue);
  const { data: yearFacets, isLoading: yearsLoading } = useWantYears(collectionId, facetFilters);

  const { isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = groupByIssue
    ? grouped
    : flat;
  const rows = useMemo(() => (flat.data?.pages ?? []).flatMap((p) => p.items), [flat.data]);
  const groups = useMemo(
    () => (grouped.data?.pages ?? []).flatMap((p) => p.groups),
    [grouped.data]
  );
  const isEmpty = groupByIssue ? groups.length === 0 : rows.length === 0;

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidate(collectionId);
  }

  /** Run a want mutation, refreshing the list and surfacing its message on failure. */
  function run(
    mutate: () => Promise<{ status: string; message?: string; created?: number; skipped?: number }>,
    onDone?: (result: { created?: number; skipped?: number }) => void
  ) {
    startTransition(async () => {
      const result = await mutate();
      if (result.status === "success") {
        handleSuccess();
        onDone?.(result);
      } else setActionError(result.message ?? "Something went wrong. Please try again.");
    });
  }

  const hasActiveFilters =
    status !== "open" ||
    priorities.length > 0 ||
    conditionIds.length > 0 ||
    query.trim().length > 0 ||
    !!filterAreaId ||
    !!year;

  // Confirmation toasts (#541), on exactly the three actions that make the row **disappear** from
  // the list the collector is looking at: the panel opens on `status: open`, so closing a want, and
  // deleting one, both take it out of view with nothing left to confirm against. Reopening does the
  // reverse from the closed list. Adding and editing are deliberately left alone — the row is right
  // there afterwards, and a fan-out already reports itself in the notice strip above the list.
  const { toast } = useToast();

  /** How a want is named in a one-line message: the stamp it is for, or a plain "Want" where the
   * stamp has no name of its own — which a catalogue-number-only entry routinely does not. */
  function wantLabel(want: WantListItem): string {
    return want.stampName ?? "Want";
  }

  const editing = dialog.kind === "edit" ? dialog.want : null;

  /** One set of row actions for both views — see the note at the render site. */
  const rowActions = {
    onEdit: (want: WantListItem) => setDialog({ kind: "edit", want }),
    onClose: (want: WantListItem) =>
      run(
        async () => {
          const { closeWantAction } = await import("@/app/actions/wants");
          return closeWantAction(want.id);
        },
        () => toast({ message: `${wantLabel(want)} closed` })
      ),
    onReopen: (want: WantListItem) =>
      run(
        async () => {
          const { reopenWantAction } = await import("@/app/actions/wants");
          return reopenWantAction(want.id);
        },
        () => toast({ message: `${wantLabel(want)} reopened` })
      ),
    onDelete: (want: WantListItem) => setDialog({ kind: "delete", want }),
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        overflow: "clip",
        flex: 1,
        minHeight: "24rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      {/* The same left rail every list screen carries: the area tree and the year facets. */}
      <ListFilterSidebar
        areas={areas}
        filterAreaId={filterAreaId}
        onNavigateArea={(areaId) => writeStore({ areaId, year })}
        yearFacets={yearFacets}
        yearsLoading={yearsLoading}
        selectedYear={year}
        onSelectYear={(y) => writeStore({ areaId: filterAreaId, year: y })}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          borderLeft: "1px solid var(--color-border)",
        }}
      >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by catalog no., name, issue or note…"
          style={{ ...CONTROL_STYLE, width: "18rem" }}
        />

        <div style={{ display: "flex", gap: "0.375rem" }}>
          {STATUS_OPTIONS.map(({ key, label }) => {
            const active = status === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                style={{
                  ...CONTROL_STYLE,
                  cursor: "pointer",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: active ? "var(--color-accent)" : "var(--color-border-strong)",
                  background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* A view, not a filter — so it sits apart from the narrowing controls rather than among
            them, and its state is remembered rather than counted as an "active filter". */}
        <button
          type="button"
          onClick={() => setGroupByIssue(!groupByIssue)}
          aria-pressed={groupByIssue}
          style={{
            ...CONTROL_STYLE,
            cursor: "pointer",
            fontWeight: groupByIssue ? 600 : 400,
            color: groupByIssue ? "var(--color-accent)" : "var(--color-text-secondary)",
            borderColor: groupByIssue ? "var(--color-accent)" : "var(--color-border-strong)",
            background: groupByIssue ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
          }}
        >
          <Icon name="group" size="sm" />
          By issue
        </button>

        <MultiSelectFilter
          options={WANT_PRIORITIES.map((p) => ({ id: p, label: WANT_PRIORITY_LABEL[p] }))}
          selected={priorities}
          onChange={(ids) => setPriorities(ids.filter(isWantPriority))}
          allLabel="Any priority"
          itemNoun="priorities"
          ariaLabel="Filter by priority"
        />

        <MultiSelectFilter
          options={(conditions ?? []).map((c) => ({ id: c.id, label: c.abbreviation || c.name }))}
          selected={conditionIds}
          onChange={setConditionIds}
          allLabel="Any condition"
          itemNoun="conditions"
          ariaLabel="Filter by acceptable condition"
        />

        <button
          type="button"
          onClick={() => setDialog({ kind: "add" })}
          style={{
            ...CONTROL_STYLE,
            cursor: "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-action-primary)",
            border: "none",
            padding: "0.375rem 0.875rem",
            marginLeft: "auto",
          }}
        >
          Add want
        </button>
      </div>

      {/* What the last whole-set add did. Dismissed by starting the next one, not by a timer: a
          count that vanishes on its own is one you can miss entirely. */}
      {notice && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            borderBottom: "1px solid var(--color-border)",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
          }}
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: "0.75rem",
              color: "var(--color-accent)",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading the want list…
          </div>
        )}

        {!isLoading && isEmpty && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No wants match these filters."
              : "Nothing on the want list yet. Add the stamps you are looking for — and the ones you own but want in better shape."}
          </div>
        )}

        {/* A grouping decides what a want is listed *under*, never what may be done to it, so the
            member rows carry the very same actions the flat list offers. */}
        {groupByIssue
          ? groups.map((group, idx) => (
              <WantIssueGroupRow
                key={group.key}
                collectionId={collectionId}
                group={group}
                baseFilters={listFilters}
                dictionaries={dictionaries}
                vendorMapFor={vendorMapFor}
                primaryVendorByArea={primaryVendorByArea}
                isLast={idx === groups.length - 1 && !hasNextPage}
                onEdit={rowActions.onEdit}
                onClose={rowActions.onClose}
                onReopen={rowActions.onReopen}
                onDelete={rowActions.onDelete}
              />
            ))
          : rows.map((w, idx) => (
              <WantRow
                key={w.id}
                want={w}
                collectionId={collectionId}
                dictionaries={dictionaries}
                vendorMap={vendorMapFor(w.areaId, w.issueId)}
                primaryVendorId={w.areaId ? (primaryVendorByArea.get(w.areaId) ?? null) : null}
                isLast={idx === rows.length - 1}
                onEdit={rowActions.onEdit}
                onClose={rowActions.onClose}
                onReopen={rowActions.onReopen}
                onDelete={rowActions.onDelete}
              />
            ))}

        <InfiniteScrollSentinel
          onLoadMore={fetchNextPage}
          hasMore={!!hasNextPage}
          isLoading={isFetchingNextPage}
        />
      </div>
      </div>

      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <WantFormDialog
          mode={dialog.kind}
          collectionId={collectionId}
          areas={areas}
          want={editing ?? undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(input: WantCreateInput) => {
            setNotice(null);
            const editingWant = dialog.kind === "edit" ? dialog.want : null;
            run(
              async () => {
                if (!editingWant) {
                  const { createWantAction } = await import("@/app/actions/wants");
                  return createWantAction(collectionId, input);
                }
                const { updateWantAction } = await import("@/app/actions/wants");
                // An edit never carries a checklist, so the stamp is always there; the fallback is
                // the want's own, not a guess.
                return updateWantAction(editingWant.id, {
                  ...input,
                  stampId: input.stampId ?? editingWant.stampId,
                });
              },
              ({ created, skipped }) => {
                // Only a fan-out has anything to report; a plain add is its own confirmation.
                if (created === undefined || (created <= 1 && !skipped)) return;
                setNotice(
                  [
                    created > 0
                      ? `Added ${created} want${created === 1 ? "" : "s"}.`
                      : "Nothing added.",
                    skipped
                      ? `${skipped} stamp${skipped === 1 ? " was" : "s were"} already on the list.`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")
                );
              }
            );
          }}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete want"
          message="Permanently delete this want? Closing it instead keeps the record that you were looking for it."
          actionLabel="Delete want"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() =>
            run(
              async () => {
                const { deleteWantAction } = await import("@/app/actions/wants");
                return deleteWantAction(dialog.want.id);
              },
              () => toast({ message: `${wantLabel(dialog.want)} deleted` })
            )
          }
        />
      )}
    </div>
  );
}
