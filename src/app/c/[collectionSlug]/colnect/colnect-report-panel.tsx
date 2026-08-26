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
import type { ColnectLocalFixPreview } from "@/lib/colnect-list-fix";
import type { ColnectAdoptPass } from "@/lib/colnect-list-adopt";
import type { ColnectApplyWorklist } from "@/lib/colnect-list-apply";
import {
  COLNECT_LIST_BUCKETS,
  colnectListAdmitsAdoption,
  colnectListBucketLabel,
  colnectLocalFixHint,
  colnectLocalFixLabel,
  type ColnectListSource,
  type ColnectLocalFix,
} from "@/lib/colnect-list-sync-rules";
import {
  adoptColnectRowAction,
  getColnectApplyWorklistAction,
  applyColnectAdoptionAction,
  applyColnectLocalFixAction,
  previewColnectAdoptionAction,
  previewColnectLocalFixAction,
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
import {
  MATCH_ELEMENT_ID,
  useAssistantMatch,
  useAssistantMatchSignal,
} from "@/app/c/[collectionSlug]/offers/assistant-match-handoff";
import {
  APPLY_ELEMENT_ID,
  useAssistantApply,
  useAssistantPresent,
} from "./assistant-apply-handoff";
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
//
// **It drives two Assistant handoffs, and they are different jobs.** The apply run (#689) writes
// list membership on Colnect; the *match* handoff (#423) is the offer card's, reused verbatim here
// — a stamp with no item-ID is the whole `not-comparable` bucket, and matching one from the row
// closes the gap that put it there. They are separate elements because an answer to one must not
// overwrite the answer to the other, and the match one rings a doorbell rather than reporting: a
// match may well be written for a stamp this screen never handed over, and the report is re-read
// either way.

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
  // The fix the collector picked, and what the server says it would touch. Two states rather than
  // one, because the dialog opens on the *asking* — resolving the copies is a round trip, and a
  // menu entry that does nothing for half a second reads as a dead one.
  const [fixing, setFixing] = useState<{ row: ColnectReportRow; fix: ColnectLocalFix } | null>(null);
  const [fixPreview, setFixPreview] = useState<ColnectLocalFixPreview | null>(null);
  // The bulk adopt (#688): open, then the pass it would run, then the pass it ran. One state for
  // the dialog and one for the last answer, because after a pass the dialog stays open saying what
  // happened and offering the next — twenty-five thousand rows is fifty passes, not one click.
  const [adopting, setAdopting] = useState(false);
  const [adoptPass, setAdoptPass] = useState<ColnectAdoptPass | null>(null);
  const [adoptRan, setAdoptRan] = useState(false);
  // Applying the difference **on Colnect** (#689) — the confirmation, and the run it hands over.
  const [applying, setApplying] = useState(false);
  const [worklist, setWorklist] = useState<ColnectApplyWorklist | null>(null);
  const assistantPresent = useAssistantPresent();
  const {
    handoff: applyHandoff,
    nodeRef: applyNodeRef,
    start: startApplyRun,
    dismiss: dismissApplyRun,
  } = useAssistantApply();
  // Matching a stamp from a row (#423). The same handoff the offer card drives, on its own element.
  const {
    handoff: matchHandoff,
    nodeRef: matchNodeRef,
    start: startMatch,
    dismiss: dismissMatch,
  } = useAssistantMatch();
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

  // A match was written — by this screen's own Link or by the collector matching a Colnect page
  // from the toolbar icon. Either way a stamp that had no item-ID may now have one, which moves it
  // out of `not-comparable` and into the comparison: the report is the thing that has gone stale.
  useAssistantMatchSignal(
    useCallback(() => invalidate(collectionId), [invalidate, collectionId])
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

  const openFix = useCallback(
    (row: ColnectReportRow, fix: ColnectLocalFix) => {
      if (!selected || !row.colnectId) return;
      setFixing({ row, fix });
      setFixPreview(null);
      startTransition(async () => {
        const result = await previewColnectLocalFixAction(
          collectionId,
          selected.lt,
          row.colnectId as string,
          row.bucket,
          fix,
          row.colnectGrade
        );
        if (result.status === "error") {
          setFixing(null);
          toast({ message: result.message, tone: "error" });
          return;
        }
        setFixPreview(result.preview);
      });
    },
    [collectionId, selected, toast]
  );

  const applyFix = useCallback(() => {
    if (!selected || !fixing?.row.colnectId) return;
    const { row, fix } = fixing;
    startTransition(async () => {
      const result = await applyColnectLocalFixAction(
        collectionId,
        selected.lt,
        row.colnectId as string,
        row.bucket,
        fix,
        row.colnectGrade
      );
      setFixing(null);
      setFixPreview(null);
      if (result.status === "error") {
        toast({ message: result.message, tone: "error" });
        return;
      }
      invalidate(collectionId);
      toast({
        message: `${result.changed} ${result.changed === 1 ? "row" : "rows"} corrected here.`,
      });
    });
  }, [collectionId, fixing, invalidate, selected, toast]);

  /** What the report is narrowed by, in the shape the server's own filters take. */
  const serverFilters = useMemo(
    () => ({
      countries: countries.length ? countries : undefined,
      includeHidden,
    }),
    [countries, includeHidden]
  );

  const canAdopt = !!selected?.snapshot && colnectListAdmitsAdoption(selected);

  const loadAdoptPreview = useCallback(() => {
    if (!selected) return;
    setAdoptPass(null);
    setAdoptRan(false);
    startTransition(async () => {
      const result = await previewColnectAdoptionAction(collectionId, selected.lt, serverFilters);
      if (result.status === "error") {
        setAdopting(false);
        toast({ message: result.message, tone: "error" });
        return;
      }
      setAdoptPass(result.pass);
    });
  }, [collectionId, selected, serverFilters, toast]);

  const runAdoptPass = useCallback(() => {
    if (!selected) return;
    startTransition(async () => {
      const result = await applyColnectAdoptionAction(collectionId, selected.lt, serverFilters);
      if (result.status === "error") {
        toast({ message: result.message, tone: "error" });
        return;
      }
      setAdoptPass(result.pass);
      setAdoptRan(true);
      invalidate(collectionId);
    });
  }, [collectionId, invalidate, selected, serverFilters, toast]);

  const adoptRow = useCallback(
    (row: ColnectReportRow) => {
      if (!selected || !row.colnectId) return;
      startTransition(async () => {
        const result = await adoptColnectRowAction(
          collectionId,
          selected.lt,
          row.colnectId as string
        );
        if (result.status === "error") {
          toast({ message: result.message, tone: "error" });
          return;
        }
        invalidate(collectionId);
        toast({
          message: result.pass.created
            ? "Added to the want list"
            : "Already on the want list — nothing written.",
        });
      });
    },
    [collectionId, invalidate, selected, toast]
  );

  const loadWorklist = useCallback(() => {
    if (!selected) return;
    setWorklist(null);
    startTransition(async () => {
      const result = await getColnectApplyWorklistAction(collectionId, selected.lt, serverFilters);
      if (result.status === "error") {
        setApplying(false);
        toast({ message: result.message, tone: "error" });
        return;
      }
      setWorklist(result.worklist);
    });
  }, [collectionId, selected, serverFilters, toast]);

  const handOverRun = useCallback(() => {
    if (!worklist) return;
    startApplyRun({
      collectionId,
      lt: worklist.lt,
      label: worklist.label,
      items: worklist.items,
    });
    setApplying(false);
    setWorklist(null);
  }, [collectionId, startApplyRun, worklist]);

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

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          {selected?.snapshot && assistantPresent && (
            <Tooltip content="Hand the difference to the Assistant, which applies it on Colnect in this browser — slowly, and only list membership.">
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
                onClick={() => {
                  setApplying(true);
                  loadWorklist();
                }}
              >
                <Icon name="assistant" /> Apply on Colnect
              </button>
            </Tooltip>
          )}
          {canAdopt && (
            <Tooltip content="Turn the items only Colnect has into wants here, a pass at a time. Nothing is written until you have seen what would be.">
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
                onClick={() => {
                  setAdopting(true);
                  loadAdoptPreview();
                }}
              >
                <Icon name="wants" /> Adopt into wants
              </button>
            </Tooltip>
          )}
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
                    source={selected.source}
                    sourceOfTruth={selected.sourceOfTruth}
                    vendorMap={vendorMapFor(row.areaId, null)}
                    primaryVendorId={
                      row.areaId ? (primaryVendorByArea.get(row.areaId) ?? null) : null
                    }
                    conditionsById={conditionsById}
                    isLast={index === rows.length - 1}
                    onMarkDone={markDone}
                    onFix={openFix}
                    onAdopt={canAdopt ? adoptRow : null}
                    onLinkColnect={assistantPresent ? startMatch : null}
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

      {/* The node the worklist crosses on, and the progress comes back on (#689). The extension
          reads its text and answers with attributes on it; React owns it either way. */}
      <div id={APPLY_ELEMENT_ID} ref={applyNodeRef} style={{ display: "none" }}>
        {applyHandoff?.payload ?? ""}
      </div>

      {/* The match handoff's own node (#423) — a second element rather than a second task on the
          one above, so an answer to a match never lands where a run's progress is read. */}
      <div id={MATCH_ELEMENT_ID} ref={matchNodeRef} hidden>
        {matchHandoff?.payload ?? ""}
      </div>

      {matchHandoff && (
        <ColnectMatchStrip handoff={matchHandoff} onDismiss={dismissMatch} />
      )}

      {applyHandoff && (
        <ColnectApplyProgress handoff={applyHandoff} onDismiss={dismissApplyRun} />
      )}

      {applying && (
        <ColnectApplyDialog
          worklist={worklist}
          isPending={isPending}
          onClose={() => {
            setApplying(false);
            setWorklist(null);
          }}
          onConfirm={handOverRun}
        />
      )}

      {adopting && (
        <ColnectAdoptDialog
          listLabel={selected?.label ?? "this list"}
          pass={adoptPass}
          ran={adoptRan}
          isPending={isPending}
          onClose={() => {
            setAdopting(false);
            setAdoptPass(null);
            setAdoptRan(false);
          }}
          onRun={runAdoptPass}
        />
      )}

      {fixing && (
        <ColnectFixDialog
          row={fixing.row}
          fix={fixing.fix}
          source={selected?.source ?? "items_for_trade"}
          preview={fixPreview}
          isPending={isPending}
          onClose={() => {
            setFixing(null);
            setFixPreview(null);
          }}
          onConfirm={applyFix}
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
 * The confirmation before the Assistant writes to Colnect (#689, ADR-0042).
 *
 * **The counts in both directions, before anything is sent.** A bulk removal from a public list is
 * visible to every partner reading it, and is not something to start by accident — the numbers are
 * the whole point of this dialog, not decoration on a spinner.
 *
 * It also says the two things a collector cannot see from the report: that this writes list
 * membership and nothing else — no quantity, no grade, no notes — and how long a run of this size
 * will take at the pace Colnect tolerates. Where the export is too old, the removals have already
 * been dropped from the worklist and this says so and names the import as the way through.
 */
function ColnectApplyDialog({
  worklist,
  isPending,
  onClose,
  onConfirm,
}: {
  worklist: ColnectApplyWorklist | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // At one write every 1.6 seconds. Stated in whole minutes, rounded up: a run is measured in
  // "leave it going", not in seconds.
  const minutes = worklist ? Math.max(1, Math.ceil((worklist.items.length * 1.6) / 60)) : 0;
  return (
    <DialogShell title={`Apply on Colnect${worklist ? ` — ${worklist.label}` : ""}`} onClose={onClose}>
      <DialogBody>
        {!worklist ? (
          <p style={{ margin: 0, fontSize: "0.9375rem" }}>Working out what to apply…</p>
        ) : (
          <>
            <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
              The Assistant will <strong>add {worklist.additions}</strong>{" "}
              {worklist.additions === 1 ? "item" : "items"} to {worklist.label} on Colnect and{" "}
              <strong>remove {worklist.removals}</strong>, in this browser, signed in as you.
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.375rem" }}>
              <li style={{ fontSize: "0.875rem" }}>
                <strong>Membership only.</strong>
                <span style={MUTED}> No quantity, no grade, no notes — those stay yours to set.</span>
              </li>
              <li style={{ fontSize: "0.875rem" }}>
                <strong>About {minutes} {minutes === 1 ? "minute" : "minutes"}.</strong>
                <span style={MUTED}>
                  {" "}
                  Paced to roughly one change every other second, which is what Colnect tolerates
                  without complaint. Leave it running; if it is interrupted it carries on from where
                  it stopped, and each item is ticked off here as it lands.
                </span>
              </li>
              <li style={{ fontSize: "0.875rem" }}>
                <strong>From the export of {worklist.snapshot.exportedAt?.slice(0, 10) ?? worklist.snapshot.importedAt.slice(0, 10)}</strong>
                <span style={MUTED}> — {worklist.snapshot.fileName}, {worklist.snapshot.ageDays} days old.</span>
              </li>
            </ul>
            {worklist.removalsRefused && (
              <p
                style={{
                  margin: "1rem 0 0",
                  padding: "0.5rem 0.625rem",
                  borderRadius: "0.375rem",
                  background: "var(--color-bg-muted)",
                  fontSize: "0.875rem",
                  lineHeight: 1.5,
                }}
              >
                {worklist.removalsRefused}
              </p>
            )}
          </>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Working…" : `Apply ${worklist?.items.length ?? 0} on Colnect`}
        disabled={isPending || !worklist || worklist.items.length === 0}
        onCancel={onClose}
        onAction={onConfirm}
      />
    </DialogShell>
  );
}

/**
 * How a Colnect run is going (#689) — a strip, not a dialog.
 *
 * A run is minutes to hours, and the collector is meant to carry on working through the report while
 * it happens: rows tick off behind it as the Assistant marks each applied item done. A modal would
 * hold the screen hostage for an hour to show a number.
 */
function ColnectApplyProgress({
  handoff,
  onDismiss,
}: {
  handoff: { state: string; message: string | null; report: { total: number; applied: number; changed: number; failed: number } | null };
  onDismiss: () => void;
}) {
  const report = handoff.report;
  const settled = report ? report.applied + report.changed + report.failed : 0;
  const share = report && report.total > 0 ? settled / report.total : 0;
  const finished = handoff.state === "done" || handoff.state === "error";
  return (
    <div
      style={{
        ...PANEL,
        padding: "0.625rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <Icon name="assistant" />
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: "0.375rem" }}>
        <div style={{ fontSize: "0.875rem" }}>{handoff.message ?? "Applying on Colnect…"}</div>
        {!finished && (
          <div
            style={{
              height: "0.25rem",
              borderRadius: "0.125rem",
              background: "var(--color-bg-muted)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(share * 100)}%`,
                height: "100%",
                background: "var(--color-accent)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
        onClick={onDismiss}
      >
        {finished ? "Dismiss" : "Hide"}
      </button>
    </div>
  );
}

/**
 * What the Assistant is doing with a **Link** press (#423), while it does it.
 *
 * It says one thing and stops at *opened*: what happens in the match window is the collector's own
 * work, and its answer comes back on the doorbell rather than here — a match may be written for a
 * stamp this handoff never named. The strip is the acknowledgement that the press landed, which a
 * window opening behind the browser would otherwise be the only sign of.
 */
function ColnectMatchStrip({
  handoff,
  onDismiss,
}: {
  handoff: { label: string | null; message: string | null };
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        ...PANEL,
        padding: "0.625rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <Icon name="assistant" />
      <div style={{ flex: 1, minWidth: 0, fontSize: "0.875rem" }}>
        {handoff.message ??
          (handoff.label ? `Opening the search for ${handoff.label}…` : "Opening the search…")}
      </div>
      <button
        type="button"
        style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * Adopting the Colnect side into wants, a pass at a time (#688).
 *
 * The dialog is the **preview**, and it exists because a wish list of twenty-five thousand entries
 * is not something to start blind: most of it will resolve to no stamp here, and saying so before
 * anything is written is the difference between a bulk action and a surprise. The same numbers come
 * back after a run, so the dialog stays open reporting what happened and offering the next pass —
 * fifty of them for a first sweep, and the bucket count on the screen behind falls each time.
 *
 * A row that resolves to no stamp is stated as an **outcome**, not hidden as a failure. On a list
 * this size that number will be the largest one here, and it is the honest one.
 */
function ColnectAdoptDialog({
  listLabel,
  pass,
  ran,
  isPending,
  onClose,
  onRun,
}: {
  listLabel: string;
  pass: ColnectAdoptPass | null;
  ran: boolean;
  isPending: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  const remaining = pass ? Math.max(0, pass.bucketRows - pass.passRows) : 0;
  return (
    <DialogShell title={`Adopt ${listLabel} into wants`} onClose={onClose}>
      <DialogBody>
        {!pass ? (
          <p style={{ margin: 0, fontSize: "0.9375rem" }}>Working out what this pass would adopt…</p>
        ) : (
          <>
            <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
              {ran ? (
                <>
                  <strong>{pass.created}</strong> {pass.created === 1 ? "want" : "wants"} added.
                </>
              ) : (
                <>
                  This pass looks at <strong>{pass.passRows}</strong> of the{" "}
                  <strong>{pass.bucketRows}</strong> {pass.bucketRows === 1 ? "row" : "rows"} only
                  Colnect has.
                </>
              )}
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.375rem" }}>
              <li style={{ fontSize: "0.875rem" }}>
                <strong>{pass.adoptable}</strong> {ran ? "resolved to a stamp here" : "would become wants"}
                {pass.withCondition > 0 && (
                  <span style={MUTED}> — {pass.withCondition} carrying a grade this collection reads</span>
                )}
              </li>
              <li style={{ fontSize: "0.875rem" }}>
                <strong>{pass.unresolved}</strong> match no stamp here
                <span style={MUTED}> — reported, left on the report. Filling those IDs in is the Assistant&apos;s job.</span>
              </li>
              <li style={{ fontSize: "0.875rem" }}>
                <strong>{pass.alreadyWanted}</strong> are already on the want list
              </li>
            </ul>
            {ran && remaining > 0 && (
              <p style={{ ...MUTED, margin: "1rem 0 0" }}>
                {remaining} {remaining === 1 ? "row" : "rows"} still only on Colnect. Run the next
                pass — each one starts where the last stopped.
              </p>
            )}
            {!ran && (
              <p style={{ ...MUTED, margin: "1rem 0 0" }}>
                Nothing here writes a Colnect ID onto a stamp: the matcher runs dry, because learning
                an ID is something you do against a page you are looking at.
              </p>
            )}
          </>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={
          isPending ? "Working…" : ran ? "Run the next pass" : `Adopt ${pass?.adoptable ?? 0}`
        }
        disabled={isPending || !pass || (ran ? remaining === 0 : pass.adoptable === 0)}
        onCancel={onClose}
        onAction={onRun}
      />
    </DialogShell>
  );
}

/**
 * Fixing this side of one difference (#687) — and, before that, **saying what it will touch**.
 *
 * The naming is the whole reason this is a dialog and not a menu entry that just writes. Several
 * copies of one stamp qualify routinely, and *stop offering this for trade* silently meaning *four
 * copies* is how a report stops being believed. So the copies are listed by their own number, with
 * the grade and the place a collector would recognise them by, and the action sits under that list.
 *
 * It opens before the answer arrives, because resolving the copies is a round trip and a menu entry
 * that does nothing for half a second reads as a dead one.
 */
function ColnectFixDialog({
  row,
  fix,
  source,
  preview,
  isPending,
  onClose,
  onConfirm,
}: {
  row: ColnectReportRow;
  fix: ColnectLocalFix;
  source: ColnectListSource;
  preview: ColnectLocalFixPreview | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const title = colnectLocalFixLabel(fix, source, row.colnectGrade);
  const subject = preview?.stampName || row.stampName || row.colnectName || "this stamp";
  const count = (preview?.copies.length ?? 0) + (preview?.wants.length ?? 0);

  return (
    <DialogShell title={title} onClose={onClose}>
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
          {preview ? (
            <>
              <strong>{subject}</strong> — {count} {count === 1 ? "row" : "rows"} here will change.{" "}
              {colnectLocalFixHint(fix, source)}
            </>
          ) : (
            "Working out what this would change…"
          )}
        </p>

        {preview && preview.copies.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.25rem" }}>
            {preview.copies.map((copy) => (
              <li
                key={copy.id}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  fontSize: "0.875rem",
                  padding: "0.375rem 0.5rem",
                  borderRadius: "0.375rem",
                  background: "var(--color-bg-muted)",
                }}
              >
                <span style={{ fontWeight: 600 }}>#{copy.itemNo}</span>
                <span>{copy.conditionAbbreviation}</span>
                {copy.formatName && <span style={MUTED}>{copy.formatName}</span>}
                {copy.locationName && (
                  <span style={MUTED}>
                    {copy.locationName}
                    {copy.locationRef ? ` · ${copy.locationRef}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {preview && preview.wants.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.25rem" }}>
            {preview.wants.map((want) => (
              <li
                key={want.id}
                style={{
                  fontSize: "0.875rem",
                  padding: "0.375rem 0.5rem",
                  borderRadius: "0.375rem",
                  background: "var(--color-bg-muted)",
                }}
              >
                {want.conditionNames.length
                  ? `Accepts ${want.conditionNames.join(", ")}`
                  : "Accepts any condition"}
                {fix === "grade" && preview.conditionName ? ` → ${preview.conditionName}` : ""}
              </li>
            ))}
          </ul>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Working…" : title}
        disabled={isPending || !preview || count === 0}
        onCancel={onClose}
        onAction={onConfirm}
      />
    </DialogShell>
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
