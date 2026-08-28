"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { AreaTreeSelect, buildAreaTree } from "@/app/area-tree-select";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  commitCatalogImportAction,
  previewCatalogImportAction,
} from "@/app/actions/catalog-import";
import {
  readCatalogImportFile,
  type CatalogImportColumn,
  type CatalogImportFile,
  type CatalogImportMapping,
  type CatalogImportRow,
} from "@/lib/catalog-import-rules";
import type { CatalogImportPlanResult, CatalogImportRunResult } from "@/lib/catalog-import";
import type { CollectionAreaData } from "@/lib/areas";
import { useInvalidateIssues } from "./use-issues-query";

// **The import dialog** (#718) — the collector's end of the CSV catalog import track whose rules
// are `catalog-import-rules.ts` (#716) and whose writes are `catalog-import.ts` (#717).
//
// Four steps, each answering one question: *what is the file*, *where does it land*, *which column
// is which*, *what would this do*. They are steps rather than one long form because each answer is
// what makes the next question askable — there are no columns to map before a file is read, and no
// verdicts to preview before the columns are named.
//
// **The paste box is a second door, not a second flow.** A file picked from disk and text pasted
// into the textarea both end up as the same raw CSV string in {@link source}, and everything below
// that — the column detection, the mapping, the preview, the commit — cannot tell which door it
// came through. That is the whole reason the paste box is cheap enough to have: a collector who
// keeps their catalogue in a spreadsheet copies a block of it, and one who exported a file picks
// the file.
//
// **The preview is the server's answer, never the client's.** Reading the file into columns happens
// here (`readCatalogImportFile` is pure) because the mapping step needs the column names before any
// question can be asked of the collection. Classifying the rows does not: it is measured against
// the collection, so `previewCatalogImportAction` computes it and `commitCatalogImportAction`
// computes it *again* from the same text and mapping (#717). The screen therefore promises what the
// writer is about to do, and a row that became a duplicate while the preview sat open is refused
// rather than written.

// ── Styles ──────────────────────────────────────────────────────────────────

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };

const CELL: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderTop: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
  verticalAlign: "top",
};

const HEAD_CELL: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  textAlign: "left",
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const SELECT: React.CSSProperties = {
  padding: "0.3rem 0.4rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  width: "100%",
};

const TEXTAREA: React.CSSProperties = {
  width: "100%",
  minHeight: "9rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  resize: "vertical",
};

const NOTE: React.CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.8125rem",
  ...MUTED,
};

/**
 * How many preview rows are drawn.
 *
 * A file is one row per issue and a whole country's catalogue is thousands of them; a table that
 * long makes the dialog crawl for a reading nobody scrolls to the end of. The summary counts every
 * row regardless, and every row the plan *refused* is listed however far down the file it sits —
 * see {@link errorsBeyondCap} — so the cap only ever hides rows that are going to work.
 */
const PREVIEW_ROW_CAP = 1000;

// ── Guessing the mapping ────────────────────────────────────────────────────

/**
 * Words a column's header suggests a role by, lowercased.
 *
 * This is a **starting point for the collector to check**, not a header contract: the mapping is
 * shown on screen with each column's own sample values beside it, and a guess that got it wrong is
 * one select away from being right. The file is one the collector typed, so its headers are
 * whatever they call things — Polish included, this being a Polish collector's app.
 */
const ROLE_WORDS: Record<keyof CatalogImportMapping, string[]> = {
  spec: ["number", "numbers", "no", "nr", "catalog", "catalogue", "katalog", "numer", "numery", "mi"],
  year: ["year", "rok"],
  name: ["name", "title", "issue", "nazwa", "tytuł", "tytul", "opis", "emisja"],
};

/** The first column whose header is one of `words`, or null. Exact matches only: a header called
 *  `Number of stamps` is not the numbers column, and a wrong guess is worse than no guess when the
 *  collector is about to skim past it. */
function guessColumn(columns: CatalogImportColumn[], role: keyof CatalogImportMapping): number | null {
  const words = ROLE_WORDS[role];
  const found = columns.find((column) => words.includes(column.name.trim().toLowerCase()));
  return found ? found.index : null;
}

// ── The dialog ──────────────────────────────────────────────────────────────

/** What the collector has answered so far. `spec` is `null` until answered — the file cannot be
 *  classified without it — where `year` and `name` are legitimately left unmapped. */
interface DraftMapping {
  spec: number | null;
  year: number | null;
  name: number | null;
}

type Step = "source" | "mapping" | "preview" | "report";

export function CatalogImportDialog({
  collectionId,
  areas,
  defaultAreaId,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  /** The area the list is filtered to, if any — the one the collector is looking at is the one they
   *  are most likely importing into. Never a grouping-only area's id, which cannot hold issues. */
  defaultAreaId?: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { invalidateList } = useInvalidateIssues();
  const areaTree = useMemo(() => buildAreaTree(areas), [areas]);
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas, collectionId);

  const [step, setStep] = useState<Step>("source");
  const [areaId, setAreaId] = useState(() => {
    const preset = areas.find((a) => a.id === defaultAreaId);
    return preset?.assignable ? preset.id : "";
  });
  /** The CSV itself — whichever door it came through. */
  const [source, setSource] = useState("");
  /** What the file was called, where it was a file. Shown so the collector can see which one they
   *  picked; pasted text has no name and says so. */
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [file, setFile] = useState<CatalogImportFile | null>(null);
  const [mapping, setMapping] = useState<DraftMapping>({ spec: null, year: null, name: null });
  const [plan, setPlan] = useState<CatalogImportPlanResult | null>(null);
  const [report, setReport] = useState<CatalogImportRunResult | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  /** The catalog every number in the file will be filed under — the chosen area's leading vendor
   *  (#675). Named on screen at the moment the area is chosen, because that is the one thing the
   *  file does not say and cannot be corrected afterwards. */
  const targetVendor = useMemo(() => {
    if (!areaId) return null;
    const vendorId = primaryVendorByArea.get(areaId) ?? null;
    if (!vendorId) return null;
    return vendorMapByArea.get(areaId)?.get(vendorId) ?? null;
  }, [areaId, primaryVendorByArea, vendorMapByArea]);

  function chooseFile(picked: File) {
    setError(undefined);
    picked
      .text()
      .then((text) => {
        setSource(text);
        setSourceName(picked.name);
      })
      .catch(() => setError("That file could not be read."));
  }

  /** Read the columns and move on. The reading is pure and instant, so it is an event on the button
   *  rather than an effect watching {@link source} — text pasted a character at a time must not
   *  re-detect columns on every keystroke. */
  function readSource() {
    const read = readCatalogImportFile(source);
    if (!read.ok) {
      setError(read.message);
      return;
    }
    setError(undefined);
    setFile(read.file);
    setMapping({
      spec: guessColumn(read.file.columns, "spec"),
      year: guessColumn(read.file.columns, "year"),
      name: guessColumn(read.file.columns, "name"),
    });
    setStep("mapping");
  }

  function requestPreview() {
    if (mapping.spec === null) return;
    const answered: CatalogImportMapping = {
      spec: mapping.spec,
      year: mapping.year,
      name: mapping.name,
    };
    setError(undefined);
    startTransition(async () => {
      const result = await previewCatalogImportAction(collectionId, areaId, source, answered);
      setPlan(result);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setStep("preview");
    });
  }

  function commit() {
    if (mapping.spec === null) return;
    const answered: CatalogImportMapping = {
      spec: mapping.spec,
      year: mapping.year,
      name: mapping.name,
    };
    setError(undefined);
    startTransition(async () => {
      const result = await commitCatalogImportAction(collectionId, areaId, source, answered);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setReport(result);
      setStep("report");
      // The list behind the dialog is now stale — and so are its year facets, which live under
      // the same key prefix.
      invalidateList(collectionId);
      toast({
        message: `Imported ${result.report.issuesCreated} new ${
          result.report.issuesCreated === 1 ? "issue" : "issues"
        }, filled ${result.report.issuesFilled}`,
        tone: result.report.rowsFailed > 0 ? "error" : "success",
      });
    });
  }

  const planned = plan?.ok ? plan : null;
  const rows = planned?.plan.rows ?? [];
  const drawnRows = rows.slice(0, PREVIEW_ROW_CAP);
  /** Refusals past the cap. They are the rows worth reading and the only ones the cap must not
   *  swallow, so they are listed on their own below the table. */
  const errorsBeyondCap = rows
    .slice(PREVIEW_ROW_CAP)
    .filter((row): row is Extract<CatalogImportRow, { kind: "error" }> => row.kind === "error");

  return (
    <DialogShell
      title="Import a catalog CSV"
      onClose={onClose}
      dismissable={!isPending}
      // Wide enough for a preview table of five columns whose last one is a sentence; the mapping
      // and source steps simply do not fill it.
      maxWidth={step === "preview" || step === "report" ? "min(94vw, 76rem)" : "min(94vw, 46rem)"}
    >
      <DialogBody>
        {step === "source" && (
          <SourceStep
            areas={areas}
            areaTree={areaTree}
            areaId={areaId}
            onAreaChange={setAreaId}
            source={source}
            sourceName={sourceName}
            onSourceChange={(text) => {
              setSource(text);
              setSourceName(null);
            }}
            targetVendor={targetVendor}
            fileInput={fileInput}
            onPickFile={chooseFile}
            disabled={isPending}
          />
        )}

        {step === "mapping" && file && (
          <MappingStep
            file={file}
            mapping={mapping}
            onMappingChange={setMapping}
            disabled={isPending}
          />
        )}

        {step === "preview" && planned && (
          <PreviewStep
            areaName={planned.target.areaName}
            vendorAbbreviation={planned.target.vendorAbbreviation}
            areaPrefix={planned.target.areaPrefix}
            summary={planned.plan.summary}
            rows={drawnRows}
            hiddenRows={rows.length - drawnRows.length}
            errorsBeyondCap={errorsBeyondCap}
          />
        )}

        {step === "report" && report?.ok && (
          <ReportStep areaName={report.target.areaName} report={report.report} />
        )}
      </DialogBody>

      {step === "source" && (
        <DialogActions
          actionLabel="Read the file"
          disabled={isPending || !areaId || !source.trim() || !targetVendor}
          error={error}
          onCancel={onClose}
          onAction={readSource}
        />
      )}
      {step === "mapping" && (
        <DialogActions
          actionLabel={isPending ? "Reading…" : "Preview"}
          disabled={isPending || mapping.spec === null}
          error={error}
          onCancel={onClose}
          onAction={requestPreview}
          leading={
            <DialogSecondaryButton
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(undefined);
                setStep("source");
              }}
            >
              Back
            </DialogSecondaryButton>
          }
        />
      )}
      {step === "preview" && (
        <DialogActions
          actionLabel={isPending ? "Importing…" : "Import"}
          // A file with nothing writable in it — every row refused, or no rows at all — has
          // nothing to import. A plan of only *no-change* rows is not that: running it is how the
          // collector confirms the file is already in, and it writes nothing either way.
          disabled={isPending || rows.every((row) => row.kind === "error")}
          error={error}
          onCancel={onClose}
          onAction={commit}
          leading={
            <DialogSecondaryButton
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(undefined);
                setPlan(null);
                setStep("mapping");
              }}
            >
              Back
            </DialogSecondaryButton>
          }
        />
      )}
      {step === "report" && (
        <DialogActions actionLabel="Done" cancelLabel="Close" onAction={onClose} onCancel={onClose} />
      )}
    </DialogShell>
  );
}

// ── Step 1: the file, and where it lands ────────────────────────────────────

function SourceStep({
  areas,
  areaTree,
  areaId,
  onAreaChange,
  source,
  sourceName,
  onSourceChange,
  targetVendor,
  fileInput,
  onPickFile,
  disabled,
}: {
  areas: CollectionAreaData[];
  areaTree: ReturnType<typeof buildAreaTree>;
  areaId: string;
  onAreaChange: (id: string) => void;
  source: string;
  sourceName: string | null;
  onSourceChange: (text: string) => void;
  targetVendor: { vendorAbbreviation: string; prefix: string | null } | null;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onPickFile: (file: File) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div>
        <LabelWithError htmlFor="catalog-import-area-button">Import into</LabelWithError>
        <AreaTreeSelect
          areas={areas}
          areaTree={areaTree}
          name="catalog-import-area"
          selectedId={areaId}
          onSelectedIdChange={onAreaChange}
          disabled={disabled}
          onlyAssignableSelectable
          noneOptionLabel="— Select an area"
        />
        {/* The one thing the file does not carry and cannot state: whose numbers these are. It is
            the area's leading catalog, so the area *is* the answer — which is worth saying out
            loud, since picking the wrong area files a whole country under the wrong numbering. */}
        {areaId && targetVendor && (
          <p style={NOTE}>
            The numbers will be filed under <strong>{targetVendor.vendorAbbreviation}</strong>
            {targetVendor.prefix ? (
              <>
                {" "}
                with this area&rsquo;s prefix — <strong>
                  {targetVendor.vendorAbbreviation}·{targetVendor.prefix} 200
                </strong>{" "}
                for a row numbered <code>200</code>.
              </>
            ) : (
              <>, this area&rsquo;s primary catalog.</>
            )}
          </p>
        )}
        {areaId && !targetVendor && (
          <p style={{ ...NOTE, color: "var(--color-warning)" }}>
            This area has no primary catalog, so there is nothing to file the file&rsquo;s numbers
            under. Set one on the area in Settings → Areas first.
          </p>
        )}
        <p style={NOTE}>One import, one area — a file per country.</p>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <LabelWithError htmlFor="catalog-import-text">The file</LabelWithError>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", ...MUTED }}>
          One row per issue: its year, its name, and the catalog numbers it covers — written the way
          the <strong>Add issue</strong> dialog takes them (<code>2820-2822</code>,{" "}
          <code>2895A-2897A, 2895B-2897B</code>, <code>3025-3027, BL48</code>). The first row is
          read as the header. Pick a file, or paste the rows straight in.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          style={{ display: "none" }}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) onPickFile(picked);
            // So picking the same file twice in a row is two events, not one.
            event.target.value = "";
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <DialogSecondaryButton
            type="button"
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
          >
            Choose a file…
          </DialogSecondaryButton>
          <span style={{ fontSize: "0.8125rem", ...MUTED }}>
            {sourceName ?? (source.trim() ? "pasted text" : "no file chosen")}
          </span>
        </div>
        <textarea
          id="catalog-import-text"
          value={source}
          disabled={disabled}
          spellCheck={false}
          placeholder={"Year;Name;Michel\n1918;Provisional issue;1-5\n1919;Sejm;100-103, BL1"}
          style={TEXTAREA}
          onChange={(event) => onSourceChange(event.target.value)}
        />
      </div>
    </>
  );
}

// ── Step 2: which column is which ───────────────────────────────────────────

const ROLE_LABEL: { key: keyof CatalogImportMapping; label: string; hint: string }[] = [
  {
    key: "spec",
    label: "Catalog numbers",
    hint: "Required — the numbers each row's issue covers.",
  },
  { key: "year", label: "Year", hint: "Optional." },
  { key: "name", label: "Issue name", hint: "Optional." },
];

function MappingStep({
  file,
  mapping,
  onMappingChange,
  disabled,
}: {
  file: CatalogImportFile;
  mapping: DraftMapping;
  onMappingChange: (mapping: DraftMapping) => void;
  disabled: boolean;
}) {
  const separatorName =
    file.separator === "\t" ? "tab" : file.separator === ";" ? "semicolon" : "comma";

  return (
    <>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", ...MUTED }}>
        {file.rows.length} {file.rows.length === 1 ? "row" : "rows"} under{" "}
        {file.columns.length} {file.columns.length === 1 ? "column" : "columns"}, separated by{" "}
        {separatorName}s. Say which column is which — the rest are left alone.
      </p>

      {/* The columns as the file has them, each with what is actually under it. A header alone is
          not enough to map by when two of them are called the same thing, or nothing at all. */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1rem" }}>
        <thead>
          <tr>
            <th style={HEAD_CELL}>Column</th>
            <th style={HEAD_CELL}>First values</th>
          </tr>
        </thead>
        <tbody>
          {file.columns.map((column) => (
            <tr key={column.index}>
              <td style={CELL}>
                <span style={MUTED}>{column.index + 1}.</span>{" "}
                {column.name || <span style={MUTED}>(unnamed)</span>}
              </td>
              <td style={{ ...CELL, ...MUTED }}>
                {column.samples.join(" · ") || <span>(empty)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
        {ROLE_LABEL.map(({ key, label, hint }) => (
          <div key={key}>
            <LabelWithError htmlFor={`catalog-import-${key}`}>{label}</LabelWithError>
            <select
              id={`catalog-import-${key}`}
              disabled={disabled}
              style={SELECT}
              value={mapping[key] === null ? "" : String(mapping[key])}
              onChange={(event) =>
                onMappingChange({
                  ...mapping,
                  [key]: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            >
              <option value="">{key === "spec" ? "— Pick a column" : "— Not in this file"}</option>
              {file.columns.map((column) => (
                <option key={column.index} value={column.index}>
                  {column.index + 1}. {column.name || "(unnamed)"}
                </option>
              ))}
            </select>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", ...MUTED }}>{hint}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Step 3: what this would do ──────────────────────────────────────────────

/** How many of a fill row's missing numbers are named before the rest are summarised. A row may
 *  legitimately be appending eighty numbers and the cell is one column of five. */
const NUMBERS_SHOWN = 8;

/** One row's outcome, as the preview prints it. */
function rowOutcome(row: CatalogImportRow): { text: string; color?: string } {
  if (row.kind === "error") return { text: row.reason, color: "var(--color-error)" };
  if (row.kind === "new-issue") {
    return {
      text: `New issue — ${row.numbers.length} ${row.numbers.length === 1 ? "stamp" : "stamps"}.`,
    };
  }
  const label =
    row.issue.name?.trim() ||
    (row.issue.year !== null ? `the ${row.issue.year} issue` : "an unnamed issue");
  if (row.noChange) {
    return {
      text: `${label} already holds all of these — nothing to change.`,
      color: "var(--color-text-muted)",
    };
  }
  // Two clauses, because they are two different things being done to the issue: stamps appended,
  // and empty fields filled. A row doing only one of them says only that.
  const clauses: string[] = [];
  if (row.missingNumbers.length > 0) {
    const shown = row.missingNumbers.slice(0, NUMBERS_SHOWN).join(", ");
    const rest = row.missingNumbers.length - NUMBERS_SHOWN;
    clauses.push(
      `adds ${row.missingNumbers.length} ${row.missingNumbers.length === 1 ? "stamp" : "stamps"} (${shown}${rest > 0 ? `, +${rest} more` : ""})`
    );
  }
  const fields = [row.fillName !== null ? "name" : null, row.fillYear !== null ? "year" : null]
    .filter((f): f is string => f !== null)
    .join(" and ");
  if (fields) clauses.push(`fills in its ${fields}`);
  return { text: `Fill ${label} — ${clauses.join(", ")}.` };
}

function PreviewStep({
  areaName,
  vendorAbbreviation,
  areaPrefix,
  summary,
  rows,
  hiddenRows,
  errorsBeyondCap,
}: {
  areaName: string;
  vendorAbbreviation: string;
  areaPrefix: string | null;
  summary: { newIssues: number; filled: number; noChange: number; errors: number; stampsToCreate: number };
  rows: CatalogImportRow[];
  hiddenRows: number;
  errorsBeyondCap: Extract<CatalogImportRow, { kind: "error" }>[];
}) {
  return (
    <>
      <p style={{ margin: "0 0 0.25rem", fontSize: "0.875rem" }}>
        Into <strong>{areaName}</strong>, numbered under{" "}
        <strong>
          {vendorAbbreviation}
          {areaPrefix ? `·${areaPrefix}` : ""}
        </strong>
        .
      </p>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", ...MUTED }}>
        {summary.newIssues} new {summary.newIssues === 1 ? "issue" : "issues"} · {summary.filled}{" "}
        filled · {summary.noChange} unchanged · {summary.errors}{" "}
        {summary.errors === 1 ? "row skipped" : "rows skipped"} · {summary.stampsToCreate}{" "}
        {summary.stampsToCreate === 1 ? "stamp" : "stamps"} created. Nothing is written until you
        click <strong>Import</strong>.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={HEAD_CELL}>Line</th>
              <th style={HEAD_CELL}>Year</th>
              <th style={HEAD_CELL}>Name</th>
              <th style={HEAD_CELL}>Numbers</th>
              <th style={HEAD_CELL}>What happens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const outcome = rowOutcome(row);
              return (
                <tr key={row.line}>
                  <td style={{ ...CELL, ...MUTED }}>{row.line}</td>
                  <td style={CELL}>{row.source.year}</td>
                  <td style={CELL}>{row.source.name}</td>
                  <td style={CELL}>{row.source.spec}</td>
                  <td style={{ ...CELL, color: outcome.color }}>{outcome.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hiddenRows > 0 && (
        <p style={NOTE}>
          {hiddenRows} further {hiddenRows === 1 ? "row is" : "rows are"} not drawn here — the counts
          above cover the whole file, and every row that would be skipped is listed.
        </p>
      )}
      {errorsBeyondCap.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600 }}>
            Rows further down the file that will be skipped
          </p>
          {errorsBeyondCap.map((row) => (
            <p key={row.line} style={{ margin: 0, fontSize: "0.8125rem" }}>
              <span style={MUTED}>Line {row.line}:</span>{" "}
              <span style={{ color: "var(--color-error)" }}>{row.reason}</span>
            </p>
          ))}
        </div>
      )}
    </>
  );
}

// ── Step 4: what it did ─────────────────────────────────────────────────────

function ReportStep({
  areaName,
  report,
}: {
  areaName: string;
  report: {
    issuesCreated: number;
    issuesFilled: number;
    stampsCreated: number;
    rowsUnchanged: number;
    rowsSkipped: number;
    rowsFailed: number;
    failures: { line: number; message: string }[];
  };
}) {
  const lines: [string, number][] = [
    ["Issues created", report.issuesCreated],
    ["Issues filled in", report.issuesFilled],
    ["Stamps created", report.stampsCreated],
    ["Rows already imported", report.rowsUnchanged],
    ["Rows skipped", report.rowsSkipped],
    ["Rows that failed", report.rowsFailed],
  ];
  return (
    <>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
        Imported into <strong>{areaName}</strong>.
      </p>
      <table style={{ borderCollapse: "collapse", marginBottom: "0.5rem" }}>
        <tbody>
          {lines.map(([label, count]) => (
            <tr key={label}>
              <td style={{ ...CELL, paddingRight: "1.5rem" }}>{label}</td>
              <td style={{ ...CELL, fontWeight: 600 }}>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Skipped and failed are different answers and are counted apart (#717): one was refused
          before anything ran, the other got past every check and then would not write. */}
      {report.failures.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600 }}>
            <Icon name="warning" size="sm" /> These rows could not be written
          </p>
          {report.failures.map((failure) => (
            <p key={failure.line} style={{ margin: 0, fontSize: "0.8125rem" }}>
              <span style={MUTED}>Line {failure.line}:</span>{" "}
              <span style={{ color: "var(--color-error)" }}>{failure.message}</span>
            </p>
          ))}
        </div>
      )}
    </>
  );
}
