"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import {
  StampPickerBrowser,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { type PickedStamp } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import type { CollectionAreaData } from "@/lib/areas";
import type {
  ColnectImportEntry,
  ColnectImportNumber,
  ColnectImportPreview,
  ColnectImportRef,
  ColnectImportRow,
  ColnectImportShortfall,
} from "@/lib/colnect-list-import";
import { describeGiveResolution } from "@/lib/trade-give-resolution-rules";
import type { GiveRequirementReport } from "@/lib/trade-give-resolution";
import { TRADE_SIDE_LABEL, type TradeSide } from "@/lib/trade-rules";
import { addTradeColnectListAction, importColnectListAction } from "@/app/actions/trades";
import { useInvalidateTradeDetail } from "./use-trade-detail-query";

// **Importing a Colnect list into one side of a section** (#645).
//
// The whole dialog exists for the part that is *not* automatic. Matching eighty-five rows takes a
// second; what takes the collector's attention is the handful that could not be matched, the ones
// whose grade nobody stated, and — on the give side — the ones they cannot actually serve. So the
// screen is a table of every row with its verdict on it, and the Import button stays out of reach
// until each of those has been answered: fixed in place, or skipped on purpose.
//
// **A gap is worked through here, not afterwards.** A stamp is picked with the app's own
// `StampPickerBrowser` — the same picker the receive side uses, which can create the issue and the
// stamp in flight — and a grade from the collection's own list. Where the matcher offered candidates
// they are one click each, because *which of these two* is a question with an answer on screen.
//
// **The give side re-resolves as it is edited.** The copy pool is finite and shared between rows, so
// settling one row can turn another into a shortfall or out of one; the count beside a row is
// therefore refreshed from the server after every change rather than computed once when the file
// landed.
//
// **The file's own list link is offered** (#645). Line 5 of a Colnect export carries the address of
// the list it came from, which is exactly the link the trade wants beside its lines and the partner
// wants on their page — so it is offered, ticked, rather than typed in again afterwards.

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
  padding: "0.2rem 0.3rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  maxWidth: "11rem",
};

const LINK_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--color-action-primary)",
  fontSize: "0.8125rem",
  cursor: "pointer",
  textDecoration: "underline",
};

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };

/** What the collector changed about one row. Absent members mean *as the file was read*. */
interface RowEdit {
  stampId?: string;
  stampLabel?: string;
  conditionId?: string;
  quantity?: number;
  /** Left out of the import on purpose — the explicit acceptance of a gap. */
  skipped?: boolean;
}

export function TradeColnectImportDialog({
  collectionId,
  tradeId,
  sectionId,
  sectionName,
  side,
  file,
  areas,
  onClose,
}: {
  collectionId: string;
  tradeId: string;
  sectionId: string;
  sectionName: string;
  side: TradeSide;
  /** The export the collector already chose — the affordance that opened this dialog *was* the file
   *  chooser, so it opens on the reading rather than on a second button asking for the same file. */
  file: File;
  areas: CollectionAreaData[];
  onClose: () => void;
}) {
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { invalidateTrade } = useInvalidateTradeDetail();

  /** The file being read. It arrives already chosen; *Choose another file* replaces it, which is an
   *  event and not an effect — the reading itself is a query keyed on which file this is. */
  const [source, setSource] = useState<File>(file);
  /** Which of the file's lists is being imported, once the collector has said. Null means *the one
   *  the file suggests*, which is what the screen opens on — a Colnect export carries every list its
   *  stamps are on, so this is a real question. See the dialog note. */
  const [pickedList, setPickedList] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  /** The give side's answer for the rows as they now stand, once one has come back. Null falls back
   *  to the reading's own, which is the same answer for the rows as the file had them. */
  const [liveShortfalls, setLiveShortfalls] = useState<ColnectImportShortfall[] | null>(null);
  const [keepLink, setKeepLink] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [report, setReport] = useState<{ added: number; give: GiveRequirementReport | null } | null>(
    null
  );
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // The reading is a **query**, keyed on which file this is: opening the dialog is asking the
  // question, and a second button asking for a file the collector already handed over would be a
  // click that says nothing. TanStack Query rather than an effect for the app's usual reason, and
  // for one specific to this dialog — an effect that set the preview into state would be setting
  // state from an effect on every open.
  const {
    data: preview,
    isPending: reading,
    error: readFailure,
  } = useQuery<ColnectImportPreview>({
    queryKey: [
      "colnect-import",
      tradeId,
      sectionId,
      side,
      source.name,
      source.size,
      source.lastModified,
    ],
    queryFn: async () => {
      const form = new FormData();
      form.append("file", source);
      form.append("sectionId", sectionId);
      form.append("side", side);
      const res = await fetch(`/api/collections/${collectionId}/trades/${tradeId}/colnect-import`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => undefined)) as
        | (ColnectImportPreview & { error?: string })
        | undefined;
      if (!res.ok || !body) throw new Error(body?.error ?? "Failed to read that list.");
      return body;
    },
    // One file, one reading: nothing about it changes while the dialog is open, and re-reading it
    // would throw away every gap the collector has settled.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  /** The list being imported: the collector's choice, else the one the file suggests. */
  const listName = pickedList ?? preview?.suggestedList ?? "";
  const shortfalls = useMemo(
    () => liveShortfalls ?? preview?.shortfalls ?? [],
    [liveShortfalls, preview]
  );

  // Its own memo: a fresh `[]` every render would make every memo below it change every render.
  const rows: ColnectImportRow[] = useMemo(() => preview?.rows ?? [], [preview]);

  /**
   * One row as it now stands: the file's reading **of the chosen list**, with the collector's
   * changes over it.
   *
   * `onList` false means the row is not on the list being imported at all — it is in the file
   * because the stamp also sits on one of the collector's other lists. That is not a gap and it does
   * not block the import; the row is drawn greyed and stays out.
   */
  const settledOf = useCallback(
    (row: ColnectImportRow) => {
      const entry = row.entries.find((candidate) => candidate.listName === listName);
      const edit = edits[row.line] ?? {};
      const stampId = edit.stampId ?? row.stampId;
      const conditionId = edit.conditionId ?? entry?.conditionId ?? null;
      const onList = entry !== undefined;
      return {
        entry,
        onList,
        stampId,
        stampLabel: edit.stampLabel ?? row.stampLabel,
        conditionId,
        quantity: edit.quantity ?? entry?.quantity ?? 1,
        skipped: edit.skipped === true,
        ready: onList && !edit.skipped && !!stampId && !!conditionId,
      };
    },
    [edits, listName]
  );

  const ready = useMemo(
    () =>
      rows
        .map((row) => ({ row, state: settledOf(row) }))
        .filter((entry) => entry.state.ready)
        .map((entry) => ({
          line: entry.row.line,
          stampId: entry.state.stampId as string,
          conditionId: entry.state.conditionId as string,
          quantity: entry.state.quantity,
        })),
    [rows, settledOf]
  );

  const unsettled = rows.filter((row) => {
    const state = settledOf(row);
    return state.onList && !state.skipped && !state.ready;
  });

  // The give side's shortfalls are the server's answer over the rows as they stand now, so they are
  // asked for again whenever those change. Out-of-order replies are dropped by sequence rather than
  // by aborting: the request is cheap and the last answer is the true one.
  const resolveSeq = useRef(0);
  useEffect(() => {
    if (side !== "give" || !preview) return;
    const seq = (resolveSeq.current += 1);
    void (async () => {
      try {
        const res = await fetch(
          `/api/collections/${collectionId}/trades/${tradeId}/colnect-import`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: ready }),
          }
        );
        if (!res.ok) return;
        const body = (await res.json()) as { shortfalls: ColnectImportShortfall[] };
        if (seq === resolveSeq.current) setLiveShortfalls(body.shortfalls);
      } catch {
        // A failed refresh leaves the previous counts on screen; the import itself re-resolves.
      }
    })();
  }, [collectionId, tradeId, side, preview, ready]);

  const shortfallAt = useMemo(
    () => new Map(shortfalls.map((entry) => [entry.line, entry])),
    [shortfalls]
  );

  /** Start again from a different file — the way back from one that would not read. */
  function chooseAnother(picked: File) {
    setError(undefined);
    setEdits({});
    setPickedList(null);
    setLiveShortfalls(null);
    setSource(picked);
  }

  function edit(line: number, patch: RowEdit) {
    setEdits((current) => ({ ...current, [line]: { ...current[line], ...patch } }));
  }

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const result = await importColnectListAction(sectionId, side, ready);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      // The list's own address, kept beside the lines it produced — under the side it was imported
      // into, which is the heading it belongs under on the partner's page.
      if (keepLink && preview?.listUrl) {
        await addTradeColnectListAction(tradeId, {
          url: preview.listUrl,
          label: listName,
          side,
        });
      }
      invalidateTrade(collectionId);
      setReport({ added: result.added, give: result.give });
    });
  }

  if (pickingFor !== null) {
    return (
      <StampPickerBrowser
        collectionId={collectionId}
        areas={areas}
        onPick={(picked: PickedStamp) => {
          edit(pickingFor, { stampId: picked.stampId, stampLabel: pickedLabel(picked) });
          setPickingFor(null);
        }}
        onClose={() => setPickingFor(null)}
      />
    );
  }

  if (report) {
    return (
      <DialogShell title="What was imported" onClose={onClose} maxWidth="34rem">
        <DialogBody>
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            {report.added === 0
              ? "Nothing was added."
              : `${report.added} ${report.added === 1 ? "line" : "lines"} added to ${sectionName}.`}
          </p>
          {report.give && report.give.outcomes.some((outcome) => outcome.missing > 0) && (
            <div style={{ marginTop: "0.75rem" }}>
              <p style={{ margin: "0 0 0.35rem", fontSize: "0.8125rem", ...MUTED }}>
                What you cannot serve — this is the part to send back to your partner.
              </p>
              {report.give.outcomes
                .filter((outcome) => outcome.missing > 0)
                .map((outcome) => (
                  <div
                    key={outcome.index}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      padding: "0.3rem 0",
                      borderTop: "1px solid var(--color-border)",
                      fontSize: "0.8125rem",
                    }}
                  >
                    <span>{outcome.stampLabel}</span>
                    <span style={{ flexShrink: 0, color: "var(--color-warning)" }}>
                      {describeGiveResolution(outcome)}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {report.give && report.give.refused.length > 0 && (
            <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-warning)" }}>
              {report.give.refused.length} copies were refused as they were being promised:{" "}
              {report.give.refused.map((refusal) => refusal.reason).join("; ")}
            </p>
          )}
        </DialogBody>
        <DialogActions actionLabel="Done" cancelLabel="Close" onAction={onClose} onCancel={onClose} />
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title={`Import a Colnect list — ${sectionName}, ${TRADE_SIDE_LABEL[side].toLowerCase()}`}
      onClose={onClose}
      // The widest dialog the app has (the copy picker's own width). This one is a table of eighty
      // rows over seven columns, and a narrow one turns every catalog-code cell into three lines.
      maxWidth="min(96vw, 100rem)"
    >
      <DialogBody>
        {!preview ? (
          <div>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
              {reading
                ? `Reading ${source.name}…`
                : side === "give"
                  ? "Your partner's list — what they want out of this collection. Every row has to find a copy here."
                  : "Your own list — what you want from your partner. Nothing has to be found: these are their stamps."}
            </p>
            {!reading && (
              <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", ...MUTED }}>
                On Colnect, open the list and use <strong>Export list</strong> → CSV. Rows with no
                grade of their own take this section&rsquo;s default condition.
              </p>
            )}
            {/* Only ever the way back from a file that would not read — the ordinary way in is the
                button on the section heading, which is itself the chooser. */}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: "none" }}
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) chooseAnother(picked);
              }}
            />
            {!reading && (
              <DialogSecondaryButton type="button" onClick={() => fileInput.current?.click()}>
                Choose another file
              </DialogSecondaryButton>
            )}
          </div>
        ) : (
          <>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", ...MUTED }}>
              {rows.length} rows read
              {preview.declaredCount !== null && preview.declaredCount !== rows.length
                ? ` — the file says it holds ${preview.declaredCount}`
                : ""}
              {preview.exportedAt ? ` · exported ${preview.exportedAt}` : ""}
            </p>

            {preview.lists.length > 1 && (
              <div style={{ margin: "0 0 0.75rem" }}>
                <label
                  htmlFor="colnect-import-list"
                  style={{ display: "block", fontSize: "0.8125rem", marginBottom: "0.2rem" }}
                >
                  Which list is this?
                </label>
                <select
                  id="colnect-import-list"
                  value={listName}
                  style={{ ...SELECT, maxWidth: "22rem" }}
                  onChange={(event) => {
                    setPickedList(event.target.value);
                    // The counts belong to the rows of the list that was showing; a refresh is on
                    // its way, and until it lands nothing is better than the previous list's answer.
                    setLiveShortfalls(null);
                    // A grade picked for one list is an answer about *that* list, and so is a skip;
                    // carrying either over would mask what the new list actually states. A picked
                    // **stamp** is kept, because which stamp a row is about is the same question on
                    // every list.
                    setEdits((current) =>
                      Object.fromEntries(
                        Object.entries(current)
                          .map(([line, edit]) => [
                            line,
                            { stampId: edit.stampId, stampLabel: edit.stampLabel },
                          ])
                          .filter(([, edit]) => (edit as RowEdit).stampId !== undefined)
                      )
                    );
                  }}
                >
                  {preview.lists.map((list) => (
                    <option key={list.name} value={list.name}>
                      {list.name || "(unnamed)"} — {list.rows}{" "}
                      {list.rows === 1 ? "row" : "rows"}
                    </option>
                  ))}
                </select>
                {/* Why there is a question here at all. A stamp sits on every list the collector put
                    it on, and the grade is stated per list — mint on the wish list, used on the swap
                    list — so which list is being imported decides what is promised. */}
                <p style={{ margin: "0.3rem 0 0", fontSize: "0.75rem", ...MUTED }}>
                  These stamps are on more than one of your Colnect lists, and each list states its
                  own grade and quantity. The one exported is normally the one every row carries.
                </p>
              </div>
            )}

            {preview.listUrl && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  margin: "0 0 0.75rem",
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={keepLink}
                  onChange={(event) => setKeepLink(event.target.checked)}
                />
                Keep this list&rsquo;s link on the trade
                <span style={MUTED}>({listName || preview.listUrl})</span>
              </label>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={HEAD_CELL}>Line</th>
                    <th style={HEAD_CELL}>From the file</th>
                    <th style={HEAD_CELL} />
                    <th style={HEAD_CELL}>Stamp</th>
                    <th style={HEAD_CELL}>Condition</th>
                    <th style={HEAD_CELL}>Qty</th>
                    {side === "give" && <th style={HEAD_CELL}>Can give</th>}
                    <th style={HEAD_CELL} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const state = settledOf(row);
                    const shortfall = shortfallAt.get(row.line);
                    return (
                      <tr
                        key={row.line}
                        style={{ opacity: state.skipped || !state.onList ? 0.5 : 1 }}
                      >
                        <td style={{ ...CELL, ...MUTED }}>{row.line}</td>
                        <td style={CELL}>
                          {/* The name leads out to Colnect — its own page where the row carries an
                              id, and Colnect's catalog-number search where it does not, which is
                              the page that answers *what is this, then* on an unmatched row. */}
                          {row.colnectUrl ? (
                            <a
                              href={row.colnectUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              style={{ color: "var(--color-action-primary)", textDecoration: "none" }}
                            >
                              {row.name || "(unnamed)"} <Icon name="externalLink" size="sm" />
                            </a>
                          ) : (
                            <div>{row.name || "(unnamed)"}</div>
                          )}
                          <div style={{ ...MUTED, fontSize: "0.75rem" }}>
                            {[row.country, row.issuedOn].filter(Boolean).join(" · ")}
                          </div>
                          {/* **Every** number, with the one that matched picked out. A match is
                              only checkable against the numbers that did *not* match, so hiding
                              them would hide the evidence. */}
                          <div style={{ fontSize: "0.75rem" }}>
                            {row.catalogRefs.map((ref, index) => (
                              <span key={`${ref.catalog}:${ref.number}`}>
                                {index > 0 && <span style={MUTED}>, </span>}
                                <span style={refStyle(ref.status)}>
                                  {ref.catalog}:{ref.number}
                                </span>
                              </span>
                            ))}
                          </div>
                          {row.colnectId && (
                            <div style={{ fontSize: "0.75rem" }}>
                              {/* Highlighted when the **id** is what found the stamp — otherwise the
                                  collector is left guessing which of six numbers did it. */}
                              <span
                                style={
                                  row.colnectIdMatched
                                    ? { color: "var(--color-success)", fontWeight: 600 }
                                    : MUTED
                                }
                              >
                                Colnect {row.colnectId}
                              </span>
                            </div>
                          )}
                        </td>
                        {/* A picture is the fastest way to see that a match is wrong, and on a row
                            with candidates it answers *which of these two* by looking. Empty where
                            nothing matched or the stamp has none; the column is reserved either way
                            so the rows line up. */}
                        <td style={CELL}>
                          <PhotoThumb
                            collectionId={collectionId}
                            photos={state.stampId === row.stampId ? row.photos : []}
                            plain
                            reserveWhenEmpty
                            size="3rem"
                          />
                        </td>
                        <td style={CELL}>
                          {state.stampId ? (
                            <>
                              <div>{state.stampLabel ?? "Picked"}</div>
                              {state.stampId === row.stampId && (
                                <NumberList numbers={row.stampNumbers} />
                              )}
                              {row.matchedBy && !edits[row.line]?.stampId && (
                                <div style={{ ...MUTED, fontSize: "0.75rem" }}>
                                  {row.matchedBy === "colnect-id"
                                    ? "matched on Colnect id"
                                    : "matched on catalog number"}
                                </div>
                              )}
                              <button
                                type="button"
                                style={LINK_BTN}
                                onClick={() => setPickingFor(row.line)}
                              >
                                Change
                              </button>
                            </>
                          ) : (
                            <>
                              <div style={{ color: "var(--color-warning)" }}>
                                {stampGapText(row)}
                              </div>
                              {row.candidates.map((candidate) => (
                                <div
                                  key={candidate.stampId}
                                  style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}
                                >
                                  <PhotoThumb
                                    collectionId={collectionId}
                                    photos={candidate.photos}
                                    plain
                                    size="2rem"
                                  />
                                  <div>
                                    <button
                                      type="button"
                                      style={LINK_BTN}
                                      onClick={() =>
                                        edit(row.line, {
                                          stampId: candidate.stampId,
                                          stampLabel: candidate.label,
                                        })
                                      }
                                    >
                                      {candidate.label}
                                    </button>
                                    <NumberList numbers={candidate.numbers} />
                                  </div>
                                </div>
                              ))}
                              <button
                                type="button"
                                style={LINK_BTN}
                                onClick={() => setPickingFor(row.line)}
                              >
                                Pick a stamp…
                              </button>
                            </>
                          )}
                        </td>
                        <td style={CELL}>
                          {!state.onList ? (
                            <span style={MUTED}>not on this list</span>
                          ) : (
                          <>
                          <select
                            value={state.conditionId ?? ""}
                            style={SELECT}
                            onChange={(event) =>
                              edit(row.line, { conditionId: event.target.value || undefined })
                            }
                          >
                            <option value="">— Pick —</option>
                            {conditions.map((condition) => (
                              <option key={condition.id} value={condition.id}>
                                {condition.name} ({condition.abbreviation})
                              </option>
                            ))}
                          </select>
                          <div style={{ ...MUTED, fontSize: "0.75rem" }}>
                            {conditionNote(state.entry, state.conditionId)}
                          </div>
                          </>
                          )}
                        </td>
                        <td style={CELL}>{state.onList ? state.quantity : ""}</td>
                        {side === "give" && (
                          <td style={CELL}>
                            {!state.ready ? (
                              <span style={MUTED}>—</span>
                            ) : shortfall ? (
                              <span
                                style={{
                                  color:
                                    shortfall.missing > 0
                                      ? "var(--color-warning)"
                                      : "var(--color-text-secondary)",
                                }}
                              >
                                {shortfall.served} of {shortfall.requested}
                              </span>
                            ) : (
                              <span style={MUTED}>…</span>
                            )}
                          </td>
                        )}
                        <td style={CELL}>
                          {state.onList && (
                            <button
                              type="button"
                              style={LINK_BTN}
                              onClick={() => edit(row.line, { skipped: !state.skipped })}
                            >
                              {state.skipped ? "Include" : "Skip"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {unsettled.length > 0 && (
              <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-warning)" }}>
                <Icon name="warning" size="sm" /> {unsettled.length}{" "}
                {unsettled.length === 1 ? "row is" : "rows are"} still unanswered. Fix each one, or
                skip it on purpose — nothing is imported while a row is neither.{" "}
                <button
                  type="button"
                  style={LINK_BTN}
                  onClick={() =>
                    setEdits((current) => {
                      const next = { ...current };
                      for (const row of unsettled) {
                        next[row.line] = { ...next[row.line], skipped: true };
                      }
                      return next;
                    })
                  }
                >
                  Skip them all
                </button>
              </p>
            )}
          </>
        )}
        {(error ?? readFailure) && (
          <ErrorBubble>{error ?? readFailure?.message}</ErrorBubble>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={
          isPending ? "Importing…" : `Import ${ready.length} ${ready.length === 1 ? "row" : "rows"}`
        }
        disabled={!preview || isPending || unsettled.length > 0 || ready.length === 0}
        cancelDisabled={isPending}
        onCancel={onClose}
        onAction={submit}
      />
    </DialogShell>
  );
}

/** What to call a stamp the collector picked, in the picker's own words: the catalog numbers it
 *  shows as chips, then the name. */
function pickedLabel(picked: PickedStamp): string {
  const number = picked.catalogLabels[0];
  if (picked.name && number) return `${number} — ${picked.name}`;
  return picked.name ?? number ?? "Picked";
}

/** How a reference the **file** printed is drawn: the one that matched is the evidence and reads as
 *  such, a conflicting one is a warning, a catalog this collection does not keep is muted. */
function refStyle(status: ColnectImportRef["status"]): React.CSSProperties {
  switch (status) {
    case "matched":
      return { color: "var(--color-success)", fontWeight: 600 };
    case "conflict":
      return { color: "var(--color-warning)" };
    case "unmapped":
      return { color: "var(--color-text-muted)", textDecoration: "line-through" };
    default:
      return { color: "var(--color-text-muted)" };
  }
}

/** A stamp's own numbers, each marked from the file's side. Unmarked where nothing compared them —
 *  a stamp found by its Colnect id whose numbers the matcher never had occasion to look at. */
function NumberList({ numbers }: { numbers: ColnectImportNumber[] }) {
  if (numbers.length === 0) return null;
  return (
    <div style={{ fontSize: "0.75rem" }}>
      {numbers.map((number, index) => (
        <span key={number.label}>
          {index > 0 && <span style={MUTED}>, </span>}
          <span
            style={
              number.status === "matched"
                ? { color: "var(--color-success)", fontWeight: 600 }
                : number.status === "conflict"
                  ? { color: "var(--color-warning)" }
                  : MUTED
            }
          >
            {number.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Why a row has no stamp, in a sentence the collector can act on. */
function stampGapText(row: ColnectImportRow): string {
  if (!row.stampGap) return "No stamp picked.";
  switch (row.stampGap) {
    case "ambiguous":
      return "Several stamps carry these numbers.";
    case "needs-confirm":
      return "One stamp nearly matches — check it.";
    case "not-held":
      return "No stamp here carries these numbers.";
    default:
      return "Nothing here to match this against.";
  }
}

/** Where this row's grade **on the chosen list** came from, or why it has none. */
function conditionNote(
  entry: ColnectImportEntry | undefined,
  conditionId: string | null | undefined
): string {
  if (!entry) return "";
  if (!conditionId) {
    switch (entry.conditionGap) {
      case "unmapped-grade":
        return `${entry.statedGrade ?? "That grade"} is not mapped in Settings → Colnect.`;
      case "unknown-grade":
        return `Colnect has no grade called ${entry.statedGrade ?? "that"}.`;
      case "ambiguous-mapping":
        return `Two of your conditions mean ${entry.statedGrade ?? "that grade"}.`;
      default:
        return "This list states no grade, and this section has no default.";
    }
  }
  if (entry.statedGrade) return `from the file: ${entry.statedGrade}`;
  if (entry.conditionFromSection) return "the section's default";
  return "";
}
