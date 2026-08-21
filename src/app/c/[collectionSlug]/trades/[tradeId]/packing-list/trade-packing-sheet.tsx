"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PackingListData, PackingListRow } from "@/lib/packing-list";
import {
  PACKING_COLUMN,
  PackingSheet,
  type PackingColumnSpec,
} from "@/app/c/[collectionSlug]/shared/packing-sheet";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { setTradeLineFulfillmentAction } from "@/app/actions/trades";
import { hasTradeVerdict, readTradeFulfillment } from "@/lib/trade-realisation-rules";
import {
  TradeFulfillmentDialog,
  type TradeFulfillmentSubject,
} from "../trade-fulfillment-dialog";

// **The trade's packing checklist** (#643): the give side as paper, and the surface the parcel is
// actually answered for on.
//
// The whole point of writing from here is that this is where the discoveries happen. A collector
// pulling forty stamps off the shelves is the person who finds the toned one and the one that is not
// where the label says — so the box that says *this went in the envelope* writes `fulfilled` (#642),
// and the piece that turns out to be missing or damaged is struck off from the same row. There is no
// second packed flag like the sale's (#192): one fact, one column.
//
// **Two gestures, and they are different kinds of thing.** The box is the fast one — one press per
// line, forty times, no dialog — and it flips between *it went* and *nobody has said yet*. Striking a
// line off is a decision with a reason attached, so it goes through the row's `⋮` into the same
// dialog the trade screen opens, unchanged: a verdict recorded from the printout and a verdict
// recorded from the section card must be the same act.
//
// **The window is `agreed` and nothing else**, read from the server rather than re-derived here, so
// the controls and the refusal behind them cannot come to disagree. Before it the sheet still prints
// — pre-packing a list that is still being negotiated is an ordinary thing to do — with the boxes
// inert and the reason said once above them.

const PREF_KEY = "stamporama:tradePackingList:columns:v1";

/** The trade's own division of the list, as a **column** rather than a division of the paper (#643).
 *  Packing is a walk along the shelves and the shelf order is what governs it; grouped by section,
 *  the same cabinet gets visited three times. */
const SECTION: PackingColumnSpec = {
  key: "section",
  label: "Section",
  header: "Section",
  defaultOn: true,
  render: (row) => row.line?.group ?? "—",
};

/** What became of the line, where anything has. Blank on the ordinary ones: the ticked box already
 *  says *it went*, and a word repeating it on every row is a column nobody reads. */
const VERDICT: PackingColumnSpec = {
  key: "verdict",
  label: "Verdict",
  header: "What happened",
  defaultOn: true,
  render: (row) =>
    row.line?.verdictLabel ? (
      <span style={{ color: "var(--color-warning)", fontWeight: 500 }}>
        {row.line.verdictLabel}
      </span>
    ) : null,
};

// No `Qty`: a give line is one copy by construction (ADR-0039 §1), and a column of ones is a column
// of ones. No `Offer no.` either — a trade has no listing, which is what #643 dropped it for.
const COLUMNS: PackingColumnSpec[] = [
  PACKING_COLUMN.photo,
  PACKING_COLUMN.ref,
  PACKING_COLUMN.itemNo,
  PACKING_COLUMN.catalog,
  PACKING_COLUMN.area,
  PACKING_COLUMN.issue,
  PACKING_COLUMN.stamp,
  PACKING_COLUMN.condition,
  PACKING_COLUMN.certificate,
  SECTION,
  VERDICT,
];

export function TradePackingSheet({
  collectionId,
  itemNoPad,
  list,
  recordable,
}: {
  collectionId: string;
  itemNoPad: number;
  list: PackingListData;
  /** Whether a verdict may be recorded right now. */
  recordable: boolean;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [subject, setSubject] = useState<TradeFulfillmentSubject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** The row's own words, so the dialog names the line the way the sheet just did rather than going
   *  and deriving a second name for it. */
  function labelOf(row: PackingListRow): string {
    return [row.catalog, row.condition].filter(Boolean).join(" ");
  }

  /** The box: *it went in the envelope*, and back to *nobody has said yet*. The two verdicts with a
   *  reason behind them are the dialog's, not a box's. */
  function toggle(row: PackingListRow) {
    const line = row.line;
    if (!line) return;
    const next = readTradeFulfillment(line.verdict) === "fulfilled" ? "pending" : "fulfilled";
    setBusyKey(row.key);
    setError(null);
    startTransition(async () => {
      // Taking the tick back clears the reason with it, the dialog's own rule: an explanation of
      // something nobody is claiming any more reads as a verdict and is none.
      const result = await setTradeLineFulfillmentAction(line.id, next, "");
      setBusyKey(null);
      if (result.status === "success") router.refresh();
      else setError(result.message);
    });
  }

  function actions(row: PackingListRow): RowAction[] {
    const line = row.line;
    if (!line) return [];
    const fulfillment = readTradeFulfillment(line.verdict);
    return [
      {
        key: "verdict",
        // The trade screen's own wording, both halves of it: a row that has been answered for offers
        // to *change* the answer, and the two surfaces recording one act must not name it differently.
        label: hasTradeVerdict(fulfillment) ? "Change what happened…" : "Record what happened…",
        icon: "feedback",
        hint: "Strike the line off, or say why it went as it did.",
        onSelect: () =>
          setSubject({
            lineId: line.id,
            side: "give",
            label: labelOf(row),
            fulfillment,
            note: line.note,
          }),
      },
    ];
  }

  return (
    <>
      {error && (
        <p
          className="no-print"
          style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}
        >
          {error}
        </p>
      )}
      <PackingSheet
        collectionId={collectionId}
        itemNoPad={itemNoPad}
        list={list}
        columns={COLUMNS}
        prefKey={PREF_KEY}
        empty="Nothing to pack — this trade promises no copies yet."
        tickTitle={(row) =>
          row.packed ? "Went in the envelope" : "Not answered for yet — tick it as you pack"
        }
        onTick={recordable ? toggle : undefined}
        rowActions={recordable ? actions : undefined}
        busyKey={busyKey}
        groupNote={(group) => (group.packedCount > 0 ? `${group.packedCount} packed` : null)}
        rowNote={(row) => row.line?.note ?? null}
      />
      {subject && (
        <TradeFulfillmentDialog
          collectionId={collectionId}
          subject={subject}
          onClose={() => {
            setSubject(null);
            // The sheet is a server render, so the row the dialog just answered for is re-read here
            // rather than through the trade screen's query — which the dialog invalidates anyway, for
            // the balance panel waiting behind this tab.
            router.refresh();
          }}
        />
      )}
    </>
  );
}
