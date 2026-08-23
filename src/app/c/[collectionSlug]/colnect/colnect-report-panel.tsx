"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import type { CollectionAreaData } from "@/lib/areas";
import type { ColnectReportRow } from "@/lib/colnect-list-report";
import { COLNECT_LIST_BUCKETS, colnectListBucketLabel } from "@/lib/colnect-list-sync-rules";
import {
  setColnectReportDoneAction,
  setColnectReportIgnoredAction,
} from "@/app/actions/colnect";
import { FilterChip, FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { ColnectImportDialog } from "./colnect-import-dialog";
import { ColnectReportRowView } from "./colnect-report-row";
import {
  useColnectReport,
  useColnectReportLists,
  useInvalidateColnectReport,
  type ColnectReportFilterState,
} from "./use-colnect-report-query";

// **The Colnect list-sync report** (#686) — a screen, not a dialog, because the first pass over a
// wish list is tens of thousands of rows and no dialog survives that.
//
// It is built like every other large list here: filters that are a `WHERE` on the server, counts
// that come back with the page, and endless scroll. The bucket chips carry their counts as facets —
// each says what it holds under the *other* filters, so ticking one does not make the rest lie.
//
// **The header says which export the Colnect side came from and when Colnect made it**, because a
// report read against a three-week-old file is a different thing from one read against this
// morning's, and nothing on the rows themselves would say so. A list with no import yet gets the
// import offered rather than a report drawn: comparing against an empty snapshot would announce
// that the whole collection is missing from Colnect.

const NOTHING: ColnectReportRow[] = [];

const PANEL: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  overflow: "hidden",
};

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

/** `2026-08-22T10:06:42Z` → `2026-08-22`. The day is the answer to *how stale is this*; the minute
 *  is noise on a file that is compared against weeks of work. */
function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

export function ColnectReportPanel({
  collectionId,
  collectionSlug,
  areas,
}: {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateColnectReport();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<File | null>(null);
  const [ignoring, setIgnoring] = useState<ColnectReportRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const { data: lists = [], isPending: loadingLists } = useColnectReportLists(collectionId);
  // Which list this collector was last looking at. A view preference and not a filter, so it is
  // remembered per collection like every other one here rather than living in the address bar.
  const [storedLt, setStoredLt] = usePersistedCollectionValue("colnect:list", collectionId);
  const selected =
    lists.find((list) => String(list.lt) === storedLt) ?? lists[0] ?? null;

  const [buckets, setBuckets] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [includeHidden, setIncludeHidden] = useState(false);
  const filters: ColnectReportFilterState = useMemo(
    () => ({ buckets, countries, includeHidden }),
    [buckets, countries, includeHidden]
  );

  const { data, isPending: loadingRows, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useColnectReport(collectionId, selected?.snapshot ? selected.lt : null, filters);

  const rows = useMemo(() => data?.pages.flatMap((page) => page.rows) ?? NOTHING, [data]);
  // The facets ride on the first page — every later one carries the same answer, since neither
  // depends on the offset.
  const counts = data?.pages[0]?.counts ?? null;
  const countryFacets = data?.pages[0]?.countries ?? [];

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const conditionsById = useMemo(
    () => new Map(conditions.map((condition) => [condition.id, condition])),
    [conditions]
  );

  const toggleBucket = useCallback((value: string) => {
    setBuckets((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    );
  }, []);

  const markDone = useCallback(
    (row: ColnectReportRow, done: boolean) => {
      if (!selected || !row.colnectId) return;
      startTransition(async () => {
        const result = await setColnectReportDoneAction(
          collectionId,
          selected.lt,
          row.colnectId as string,
          row.bucket,
          done
        );
        if (result.status === "error") {
          toast({ message: result.message, tone: "error" });
          return;
        }
        invalidate(collectionId);
        toast({ message: done ? "Marked done on Colnect" : "Back on the report" });
      });
    },
    [collectionId, invalidate, selected, toast]
  );

  const saveIgnore = useCallback(
    (row: ColnectReportRow, note: string, ignored: boolean) => {
      if (!selected || !row.colnectId) return;
      startTransition(async () => {
        const result = await setColnectReportIgnoredAction(
          collectionId,
          selected.lt,
          row.colnectId as string,
          row.bucket,
          ignored,
          note
        );
        setIgnoring(null);
        if (result.status === "error") {
          toast({ message: result.message, tone: "error" });
          return;
        }
        invalidate(collectionId);
        toast({ message: ignored ? "Difference accepted" : "Back on the report" });
      });
    },
    [collectionId, invalidate, selected, toast]
  );

  if (loadingLists) return <div style={MUTED}>Loading…</div>;

  if (lists.length === 0) {
    return (
      <div style={{ ...PANEL, padding: "1.5rem", display: "grid", gap: "0.5rem" }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>No Colnect list is synced yet</div>
        <div style={MUTED}>
          Settings → Colnect → Colnect list sync is where you say which of Colnect&apos;s lists this
          collection keeps in step, and what each one mirrors. Switch one on and its export can be
          loaded here.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", flex: 1, minHeight: 0 }}>
      {/* Which list, and which export its Colnect side is. */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <select
          style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
          value={selected ? String(selected.lt) : ""}
          onChange={(e) => setStoredLt(e.target.value)}
          aria-label="Colnect list"
        >
          {lists.map((list) => (
            <option key={list.lt} value={String(list.lt)}>
              {list.label}
            </option>
          ))}
        </select>

        {selected?.snapshot ? (
          <span style={MUTED}>
            {selected.snapshot.rowCount} rows from {selected.snapshot.fileName}
            {day(selected.snapshot.exportedAt)
              ? `, exported ${day(selected.snapshot.exportedAt)}`
              : ""}{" "}
            · loaded {day(selected.snapshot.importedAt)}
          </span>
        ) : (
          <span style={MUTED}>No export loaded yet.</span>
        )}

        <div style={{ marginLeft: "auto" }}>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              // Clearing lets the same file be picked twice in a row, which is exactly what
              // re-exporting and re-loading looks like.
              e.target.value = "";
              if (picked) setImporting(picked);
            }}
          />
          <button
            type="button"
            style={{
              ...FILTER_CONTROL_STYLE,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              fontWeight: 600,
            }}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="import" /> Load an export
          </button>
        </div>
      </div>

      {!selected?.snapshot ? (
        <div style={{ ...PANEL, padding: "1.5rem", display: "grid", gap: "0.5rem" }}>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
            Nothing to compare {selected?.label} against yet
          </div>
          <div style={MUTED}>
            Open the list on Colnect, press <strong>Export list</strong>, and load the file here.
            Until then there is no Colnect side — and a report against an empty one would claim the
            whole collection is missing from the list.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {COLNECT_LIST_BUCKETS.map((bucket) => (
              <Tooltip key={bucket.value} content={bucket.description}>
                <FilterChip
                  label={bucket.label}
                  count={counts ? counts[bucket.value] : undefined}
                  active={buckets.includes(bucket.value)}
                  onClick={() => toggleBucket(bucket.value)}
                />
              </Tooltip>
            ))}

            <MultiSelectFilter
              options={countryFacets.map((facet) => ({
                id: facet.country,
                label: `${facet.country} (${facet.rows})`,
              }))}
              selected={countries}
              onChange={setCountries}
              allLabel="All countries"
              itemNoun="countries"
              ariaLabel="Filter by country"
            />

            <Tooltip content="Rows marked done on Colnect, and differences accepted for good.">
              <FilterChip
                label="Include put away"
                active={includeHidden}
                onClick={() => setIncludeHidden((v) => !v)}
              />
            </Tooltip>
          </div>

          <div style={{ ...PANEL, flex: 1, minHeight: 0, overflowY: "auto" }}>
            {loadingRows ? (
              <div style={{ ...MUTED, padding: "1.5rem" }}>Comparing…</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: "1.5rem", display: "grid", gap: "0.375rem" }}>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>Nothing to fix</div>
                <div style={MUTED}>
                  {buckets.length || countries.length
                    ? "No row matches these filters."
                    : `${selected.label} and this collection agree, as far as the stamps carrying a Colnect ID go.`}
                </div>
              </div>
            ) : (
              <>
                {rows.map((row, index) => (
                  <ColnectReportRowView
                    key={`${row.bucket}:${row.key}`}
                    row={row}
                    collectionId={collectionId}
                    collectionSlug={collectionSlug}
                    sourceOfTruth={selected.sourceOfTruth}
                    vendorMap={vendorMapFor(row.areaId, null)}
                    primaryVendorId={
                      row.areaId ? (primaryVendorByArea.get(row.areaId) ?? null) : null
                    }
                    conditionsById={conditionsById}
                    isLast={index === rows.length - 1}
                    onMarkDone={markDone}
                    onIgnore={(target) => {
                      if (target.ignored) saveIgnore(target, "", false);
                      else setIgnoring(target);
                    }}
                  />
                ))}
                <InfiniteScrollSentinel
                  onLoadMore={() => void fetchNextPage()}
                  hasMore={!!hasNextPage}
                  isLoading={isFetchingNextPage}
                />
              </>
            )}
          </div>
        </>
      )}

      {importing && (
        <ColnectImportDialog
          collectionId={collectionId}
          file={importing}
          onClose={() => setImporting(null)}
          onImported={() => invalidate(collectionId)}
        />
      )}

      {ignoring && (
        <IgnoreDialog
          row={ignoring}
          isPending={isPending}
          onClose={() => setIgnoring(null)}
          onConfirm={(note) => saveIgnore(ignoring, note, true)}
        />
      )}
    </div>
  );
}

/**
 * Accepting one difference for good.
 *
 * The note is **optional**: most acceptances are obvious to the person making them, and demanding a
 * sentence would make the quick ones slow. It is offered because the ones that are not obvious are
 * exactly the ones a collector will meet again in six months and wonder about.
 */
function IgnoreDialog({
  row,
  isPending,
  onClose,
  onConfirm,
}: {
  row: ColnectReportRow;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const subject = row.stampName || row.colnectName || row.colnectId || "this item";
  return (
    <DialogShell title="Ignore this difference" onClose={onClose}>
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
          <strong>{colnectListBucketLabel(row.bucket)}</strong> for {subject} stays off the report
          from now on, through every future import. Unlike marking a row done, this is a judgement
          about your collection rather than a claim about Colnect — so nothing expires it.
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-secondary)" }}>
            Why (optional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{
              padding: "0.5rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontFamily: "inherit",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              resize: "vertical",
            }}
          />
        </label>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Saving…" : "Ignore"}
        disabled={isPending}
        onCancel={onClose}
        onAction={() => onConfirm(note)}
      />
    </DialogShell>
  );
}
