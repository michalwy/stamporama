// The **Colnect export handoff** (#690): how "fetch this list from Colnect and load it" crosses from
// the instance's own report screen into the extension, and how the outcome crosses back.
//
// The apply handoff's contract again (#689), on a fifth element and for the same reasons: the page
// writes a task into a hidden node as JSON, the extension answers with `data-*` attributes on that
// same node, and the page keeps owning it. A **separate** node rather than another task type on the
// apply one, because two answers arriving on one node would overwrite each other — and because a
// refresh is routinely started while an apply run is still going.
//
// What crosses back is deliberately **not the file**. A Wish export is tens of megabytes and the
// page has no use for the bytes: the extension posts them to the instance itself, over the same
// bearer token the run's done-marks already go on, and the instance imports them through the exact
// path a hand-picked file takes (#685). One importer, one snapshot, one set of rules about what an
// export means — the alternative is a second importer that agrees with the first until it doesn't.
//
// Mirrored by hand in `src/app/c/[collectionSlug]/colnect/assistant-export-handoff.ts` — separate
// builds, no import path between them, exactly as the listing, match, registration and apply
// contracts are.

/** Element id the task lives in, and the node whose attributes carry the outcome back. */
export const EXPORT_ELEMENT_ID = "stamporama-assistant-colnect-export";

/** What the page writes into the element when the collector asks for a refresh. */
export interface ExportTask {
  /** Which instance and collection the file is posted to. The origin is the page's own. */
  collectionId: string;
  /** Colnect's list id — 2 Collection, 3 Swap, 4 Wish, 5 Sell, or a custom list's own number. */
  lt: number;
  /** What the list is called here, for the sentences the refresh reports. */
  label: string;
}

export interface ExportHandoff {
  v: 1;
  /** Identifies this refresh, so an answer states which one it answers. Any non-empty string. */
  requestId: string;
  task: ExportTask;
}

/**
 * How far a refresh has got.
 *
 * - `running` — a Colnect page is being found or opened, and the export asked for. This is the long
 *   part: Colnect builds the file, and a Wish list is twenty-five thousand rows.
 * - `importing` — the file is on its way to the instance, which is replacing the snapshot.
 * - `done` — the snapshot is the one Colnect holds now.
 * - `error` — nothing was replaced. **The old snapshot is left exactly as it was**: a refresh that
 *   half-failed must not leave the report comparing against nothing.
 */
export type ExportHandoffState = "running" | "importing" | "done" | "error";

export const EXPORT_STATE_ATTRIBUTE = "data-export-state";
export const EXPORT_REQUEST_ATTRIBUTE = "data-export-request";
export const EXPORT_MESSAGE_ATTRIBUTE = "data-export-message";
export const EXPORT_REPORT_ATTRIBUTE = "data-export-report";

/** What the import made of the file, as JSON in {@link EXPORT_REPORT_ATTRIBUTE} — the instance's own
 *  count, passed straight through, so the two routes into a snapshot report the same numbers. */
export interface ExportHandoffReport {
  /** Rows on this list that carried a Colnect id, and so became the snapshot. */
  rowsWritten: number;
  /** Rows the file carried for this list at all. The difference is {@link rowsWithoutId}. */
  rowsOnList: number;
  /** On the list, but with no `Link` to take an id from — counted rather than silently dropped. */
  rowsWithoutId: number;
}

/**
 * Validate whatever the page wrote into the element, or `null`.
 *
 * The origin is one the collector registered, so this is a boundary between the page's JSON and a
 * typed value rather than a trust boundary — but a half-written node (React renders the element
 * before anything has been asked for) must read as "no handoff" rather than as a broken one.
 */
export function parseExportHandoff(raw: string | null | undefined): ExportHandoff | null {
  if (!raw || !raw.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const h = data as Record<string, unknown>;
  if (h.v !== 1) return null;

  const requestId = typeof h.requestId === "string" ? h.requestId.trim() : "";
  if (!requestId) return null;

  const task = h.task;
  if (typeof task !== "object" || task === null) return null;
  const t = task as Record<string, unknown>;
  const collectionId = typeof t.collectionId === "string" ? t.collectionId.trim() : "";
  if (!collectionId) return null;
  const lt = typeof t.lt === "number" && Number.isFinite(t.lt) ? t.lt : null;
  if (lt === null) return null;

  return {
    v: 1,
    requestId,
    task: { collectionId, lt, label: typeof t.label === "string" ? t.label : `list ${lt}` },
  };
}

/** One sentence for {@link EXPORT_MESSAGE_ATTRIBUTE}. English and complete: the page renders it as
 *  it stands, exactly as it does the apply handoff's. */
export function describeExportProgress(
  state: ExportHandoffState,
  report: ExportHandoffReport | null,
  label: string
): string {
  switch (state) {
    case "running":
      return `Asking Colnect for the ${label} export. A long list takes a minute to build — leave this open.`;
    case "importing":
      return `Loading the ${label} export…`;
    case "done": {
      if (!report) return `${label} is up to date with Colnect.`;
      const missing =
        report.rowsWithoutId > 0
          ? ` ${report.rowsWithoutId} row${report.rowsWithoutId === 1 ? "" : "s"} carried no item link and could not be compared.`
          : "";
      return `${label} is up to date: ${report.rowsWritten} of ${report.rowsOnList} rows loaded from Colnect.${missing}`;
    }
    case "error":
      return `The ${label} export could not be refreshed. The snapshot you had is untouched.`;
  }
}
