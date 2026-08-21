"use client";

import type { PackingListData } from "@/lib/packing-list";
import {
  PACKING_COLUMN,
  PackingSheet,
  type PackingColumnSpec,
} from "@/app/c/[collectionSlug]/shared/packing-sheet";

// **The parcel enclosure** (#643): the paper that goes in the envelope.
//
// The same sheet as the packing checklist with a different column set, because it is the same list —
// what differs is who reads it. **Every internal identifier comes off**: no storage location, no
// in-location ref, no copy number. They are this collection's own handles on its own material and
// mean nothing on the other side of the post, so printing them would be printing noise on the one
// piece of paper the partner actually keeps.
//
// **Divided by the trade's own sections**, not by shelf. The checklist is a walk along cabinets the
// partner has never seen; the sections are the divisions they already know from the shared page and
// from the agreement, and their order here is the trade's own rather than a collation. Rows inside a
// section read by catalogue number for the same reason: a sheet that prints no refs must not be
// ordered by them.
//
// **The boxes print empty.** They are for the partner to tick as they unpack — the sender's own ticks
// would tell the reader nothing they need, and a sheet arriving pre-ticked invites them to trust it
// instead of the envelope.
//
// **The figures are the agreed ones and stay the agreed ones**, struck-off lines included (the
// partner page's rule, #642): what was agreed is what was agreed, and the neutral word on the row is
// what is recorded against it. A line that did not go still prints, so the reader knows what not to
// look for rather than counting the envelope against a list two lines short.

const PREF_KEY = "stamporama:tradeEnclosure:columns:v1";

/** Money as the rest of the app prints it for a partner: a 2-dp figure with its currency code beside
 *  it, because a bare number on a sheet crossing a border is a number nobody can read. */
function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

/** What was agreed for this line, in the sheet's one unit. The marks beside it are the ones a printed
 *  figure cannot be honest without: an unknown-variant rollup (#238) is an estimate, and a typed
 *  figure is not a published price. */
const VALUE: PackingColumnSpec = {
  key: "value",
  label: "Value",
  header: "Value",
  defaultOn: true,
  align: "right",
  nowrap: true,
  numeric: true,
  render: (row) => {
    const value = row.line?.value;
    if (!value) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
    return (
      <span>
        {money(value.amount * row.quantity, value.currency)}
        {(value.uncertain || value.manual || value.attribution) && (
          <span
            style={{
              display: "block",
              fontSize: "0.6875rem",
              fontWeight: 400,
              color: "var(--color-text-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {[
              value.attribution,
              value.uncertain ? "estimate" : null,
              value.manual ? "agreed figure" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
    );
  },
};

/** What became of the line, in the **neutral** wording (#642): *Withdrawn*, *Never arrived*. The
 *  collector's own phrasing inverts across the table, and this sheet is read from the far end. */
const REALISATION: PackingColumnSpec = {
  key: "realisation",
  label: "What happened",
  header: "",
  defaultOn: true,
  nowrap: true,
  render: (row) =>
    row.line?.verdictLabel ? (
      // The mark keeps its border in print: on paper it is the one thing saying a piece is not coming.
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          padding: "0.0625rem 0.375rem",
          borderRadius: "0.25rem",
          border: "1px solid var(--color-warning-border)",
          color: "var(--color-warning)",
        }}
      >
        {row.line.verdictLabel}
      </span>
    ) : null,
};

// No `Ref`, no `Copy no.`, no `Location`, no `Qty` (a give line is one copy) and no `Offer no.` (a
// trade has no listing). What is left is what identifies a stamp to somebody who does not own it.
const COLUMNS: PackingColumnSpec[] = [
  PACKING_COLUMN.photo,
  PACKING_COLUMN.catalog,
  PACKING_COLUMN.area,
  PACKING_COLUMN.issue,
  PACKING_COLUMN.stamp,
  PACKING_COLUMN.condition,
  PACKING_COLUMN.certificate,
  REALISATION,
  VALUE,
];

export function TradeEnclosureSheet({
  collectionId,
  itemNoPad,
  list,
}: {
  collectionId: string;
  itemNoPad: number;
  list: PackingListData;
}) {
  return (
    <PackingSheet
      collectionId={collectionId}
      itemNoPad={itemNoPad}
      list={list}
      columns={COLUMNS}
      prefKey={PREF_KEY}
      empty="This trade promises no copies yet, so there is nothing to enclose."
      groupIcon="group"
      // The sender's own ticks are withheld — see the note at the top of this file.
      ticks="blank"
      tickTitle={() => "Tick it as you unpack"}
      groupNote={(group) => {
        if (list.currency === null) return null;
        const missing =
          group.valueMissing > 0
            ? `${group.valueMissing} without a figure`
            : null;
        return [money(group.value, list.currency), missing].filter(Boolean).join(" · ");
      }}
    />
  );
}
