"use client";

import { Fragment } from "react";
import { useParams } from "next/navigation";
import type { StampWantSummary, StampWantSummaryEntry } from "@/lib/wants";
import {
  acceptanceAxisView,
  wantMatchesCopy,
  WANT_PRIORITY_CHIP,
  WANT_PRIORITY_LABEL,
  type WantCandidateCopy,
} from "@/lib/want-rules";
import { ROW_CHIP, STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  CertificateStatusChip,
  ConditionChip,
} from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import {
  WantCopyCountsLine,
  hasIncomingCopies,
  wantCopyCountsText,
} from "./want-copy-counts";
import { Icon } from "@/app/icons";

/**
 * The row's *you are looking for this* marker (#532), on the stamps list, in every issue's stamp
 * tree, and on copy, auction-lot and trade lines.
 *
 * **Absent when nothing is wanted**, which is the whole point: a chip on a handful of rows out of a
 * catalogue is a signal, and one on every row saying "0" is a column. Open wants only — a settled
 * one would keep the marker lit for ever, and what this answers is what is still being chased.
 *
 * **Hover previews the wants, click opens the want list** narrowed to the stamp (#1244) — the shape
 * the copy count chip beside it has had since #721. It used to open on click, as a popover, on the
 * grounds that up to a dozen wants with three axes and a priority each were too rich for a bubble;
 * what made them unreadable was the layout — a run of loose chips, certificates spelled out in full,
 * nothing lining up — not the hover. Laid out as a **table**, one row per open want and a column per
 * axis, they read at a glance, and the collector no longer hovers one chip and clicks the other to
 * ask the same kind of question. The panel is the shared `Tooltip`, so placement, viewport clamping
 * and the nesting rule are the ones every other hover panel has, and the portal, outside-click and
 * stopped Escape the popover carried are gone with it.
 *
 * The click opens the list **in a new tab**, everywhere. The chip is drawn inside the purchase intake
 * dialog and on auction and trade lines being worked through, and a navigation in place would throw
 * that work away; one behaviour on every screen beats a chip whose click means two things.
 *
 * In the table **an axis that accepts anything reads *any***, never blank and never every value
 * spelled out, and *no certificate* is a member of its own (ADR-0032 §1/§3, `acceptanceAxisView`).
 * Conditions and certificates are the dictionary's own chips with their abbreviations and colours
 * (#728), formats their abbreviations — the names the catalogue value grid uses — and members follow
 * the settings' order.
 *
 * `copy` is what turns "this stamp is wanted" into "**this** would satisfy a want". A catalogue row
 * names a stamp and nothing more, so it passes none; an auction lot line names a concrete
 * `(condition, certificate, format)` and passes it, and the chip then marks itself and the matching
 * rows in the panel. The decision runs through `wantMatchesCopy` — the same predicate the intake
 * review uses — so a lot marked as matching and the review that greets the copy when it arrives
 * cannot disagree.
 */

/** A table cell's chips, a size down from a list row's: the panel is read as columns. The tint is
 *  the dictionary chip's own and is not touched here. */
const CELL_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  padding: "0 0.3rem",
  borderRadius: "0.25rem",
};

const HEADING: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--color-text-muted)",
};

const TH: React.CSSProperties = {
  ...HEADING,
  fontSize: "0.625rem",
  textAlign: "left",
  padding: "0 0.5rem 0.25rem 0",
  whiteSpace: "nowrap",
};

const TD: React.CSSProperties = {
  padding: "0.3rem 0.5rem 0.3rem 0",
  verticalAlign: "top",
};

export function WantChip({
  collectionId,
  wants,
  copy,
}: {
  /** Resolves the panel's chips against the collection's dictionaries. */
  collectionId: string;
  wants: StampWantSummary | null;
  /** The concrete thing in front of the collector, where the surface has one. */
  copy?: WantCandidateCopy;
}) {
  if (!wants || wants.openCount === 0) return null;
  // Below the zero rule, so only a row with wants reads the dictionaries — and reads them when it
  // renders, not on the first hover, which would open a table of blank chips.
  return <WantsMarker collectionId={collectionId} wants={wants} copy={copy} />;
}

function WantsMarker({
  collectionId,
  wants,
  copy,
}: {
  collectionId: string;
  wants: StampWantSummary;
  copy?: WantCandidateCopy;
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  const matched = wants.entries.map((e) => !!copy && wantMatchesCopy(e.acceptance, copy));
  const matchCount = matched.filter(Boolean).length;
  // Matching takes the colour of the loudest want it satisfies, not of the loudest want on the
  // stamp: what is being said is "this one is on your list", and it should be as urgent as the want
  // it answers.
  const topShown = matchCount
    ? wants.entries.find((_, i) => matched[i])!.priority
    : wants.topPriority;
  const chip = WANT_PRIORITY_CHIP[topShown];
  // The chip's own hint is about the *wants*, so it asks the per-want figures, not the stamp's.
  const incoming = wants.entries.some((e) => hasIncomingCopies(e.copies));
  const stampId = wants.entries[0].acceptance.stampId;
  const href = `/c/${collectionSlug}/wants?stampId=${encodeURIComponent(stampId)}`;

  const heading = matchCount
    ? `Matches ${matchCount} of ${wants.openCount === 1 ? "1 want" : `${wants.openCount} wants`}`
    : wants.openCount === 1
      ? "Wanted"
      : `${wants.openCount} wants`;

  const dictionaries: AxisDictionaries = {
    conditionOrder: (conditions ?? []).map((c) => c.id),
    certificateOrder: (certificateStatuses ?? []).map((c) => c.id),
    formatOrder: (formats ?? []).map((f) => f.id),
    condition: (id) => {
      const c = conditions?.find((x) => x.id === id);
      return c ? c.abbreviation || c.name : "…";
    },
    certificate: (id) => {
      const c = certificateStatuses?.find((x) => x.id === id);
      return c ? c.abbreviation || c.name : "…";
    },
    format: (id) => {
      const f = formats?.find((x) => x.id === id);
      return f ? f.abbreviation || f.name : "…";
    },
  };

  return (
    <Tooltip
      content={
        <WantsPanel
          collectionId={collectionId}
          wants={wants}
          matched={matched}
          heading={heading}
          dictionaries={dictionaries}
        />
      }
      // Four columns of chips and a sub-line per want: a sentence-width bubble would wrap each row
      // into a block (`Tooltip`'s own `maxWidth` note).
      maxWidth="34rem"
      align="start"
      // The chip's own `flexShrink: 0` (from `STAMP_SECONDARY_CHIP`) has to sit on the wrapper the
      // tooltip inserts, or the chip line squeezes it as the row narrows.
      style={{ flexShrink: 0 }}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={[
          matchCount
            ? `Matches ${matchCount} of ${wants.openCount} wants`
            : wants.openCount === 1
              ? "Wanted"
              : `${wants.openCount} wants`,
          incoming ? "one already on its way" : null,
          "open in the want list",
        ]
          .filter(Boolean)
          .join(" — ")}
        // The row around this may act on a click of its own.
        onClick={(e) => e.stopPropagation()}
        // Built on the **shared chip base** the copy-count badge and the catalog chips beside it use
        // (#459's vocabulary, `chip-styles.ts`), so it sits on their line rather than near it. The two
        // resets undo the monospace and the line-height the base and the link would otherwise bring.
        style={{
          ...STAMP_SECONDARY_CHIP,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.2rem",
          fontFamily: "inherit",
          fontSize: "0.75rem",
          lineHeight: "inherit",
          fontWeight: matchCount || topShown === "high" ? 600 : 500,
          background: chip.background,
          color: chip.color,
          borderColor: chip.border,
          textDecoration: "none",
          cursor: "pointer",
          // A match is the loud case and gets a ring rather than another colour: the colour is
          // already spoken for by priority, and stacking two meanings on it would leave neither
          // readable.
          boxShadow: matchCount ? `0 0 0 2px ${chip.border}` : undefined,
        }}
      >
        <Icon name="wants" size="xs" />
        {/* The count is **always** drawn, one included. Dropping it for a single want was the
            tidier reading and the wrong call: an icon on its own gives the chip no text to set its
            line box from, so it came out shorter than every chip beside it. A number that repeats
            what the icon implies costs a character; a row of chips at three different heights costs
            the line. It also makes the figure scannable down the list without first telling
            "icon alone" apart from "icon and number". */}
        {wants.openCount}
      </a>
    </Tooltip>
  );
}

interface AxisDictionaries {
  conditionOrder: string[];
  certificateOrder: string[];
  formatOrder: string[];
  condition: (id: string) => string;
  certificate: (id: string) => string;
  format: (id: string) => string;
}

function WantsPanel({
  collectionId,
  wants,
  matched,
  heading,
  dictionaries,
}: {
  collectionId: string;
  wants: StampWantSummary;
  matched: boolean[];
  heading: string;
  dictionaries: AxisDictionaries;
}) {
  const copyCounts = wantCopyCountsText(wants.copies);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <span style={HEADING}>{heading}</span>

      {/* What the collection has of **the stamp**, whichever want it answers — context, and
          deliberately making no claim about anything being on its way. That claim belongs to the
          want it is true of, and sits under each row below: a used copy in the post answers a want
          for "anything" and a mint-only want not at all, so one line over a list of wants would
          send you bidding on the wrong thing. */}
      {copyCounts && <WantCopyCountsLine copies={wants.copies} prefix="Of this stamp:" />}

      <table
        style={{
          borderCollapse: "collapse",
          // Ruled off from the stamp's line above: flush against the first want, it read as that
          // want's own figure — the confusion the per-stamp and per-want split exists to prevent.
          borderTop: copyCounts ? "1px solid var(--color-border)" : undefined,
          marginTop: copyCounts ? "0.125rem" : 0,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...TH, paddingTop: copyCounts ? "0.375rem" : 0 }}>Condition</th>
            <th style={{ ...TH, paddingTop: copyCounts ? "0.375rem" : 0 }}>Certificate</th>
            <th style={{ ...TH, paddingTop: copyCounts ? "0.375rem" : 0 }}>Format</th>
            <th style={{ ...TH, paddingTop: copyCounts ? "0.375rem" : 0, paddingRight: 0 }}>
              Priority
            </th>
          </tr>
        </thead>
        <tbody>
          {wants.entries.map((entry, i) => (
            <WantTableRows
              key={i}
              collectionId={collectionId}
              entry={entry}
              matched={matched[i]}
              dictionaries={dictionaries}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One want: its row of axes and priority, then — only when there is something to say — a line
 *  under it spanning the table, with whether this copy would satisfy it, the copies that would, and
 *  the collector's note. */
function WantTableRows({
  collectionId,
  entry,
  matched,
  dictionaries,
}: {
  collectionId: string;
  entry: StampWantSummaryEntry;
  matched: boolean;
  dictionaries: AxisDictionaries;
}) {
  const priority = WANT_PRIORITY_CHIP[entry.priority];
  const hasCopies = !!wantCopyCountsText(entry.copies);
  const hasSubLine = matched || hasCopies || !!entry.notes;
  const rule = "1px solid var(--color-border)";
  return (
    <Fragment>
      <tr style={{ borderTop: rule }}>
        <td style={TD}>
          <AxisCell
            ids={entry.acceptance.conditionIds}
            order={dictionaries.conditionOrder}
            render={(id) => (
              <ConditionChip
                key={id}
                collectionId={collectionId}
                conditionId={id}
                label={dictionaries.condition(id!)}
                style={CELL_CHIP}
              />
            )}
          />
        </td>
        <td style={TD}>
          <AxisCell
            ids={entry.acceptance.certificateStatusIds}
            order={dictionaries.certificateOrder}
            render={(id) => (
              // A null member is *no certificate*: no dictionary row, so the neutral chip, under the
              // name the catalogue value grid gives that column.
              <CertificateStatusChip
                key={id ?? "none"}
                collectionId={collectionId}
                certificateStatusId={id}
                label={id === null ? "No cert." : dictionaries.certificate(id)}
                style={CELL_CHIP}
              />
            )}
          />
        </td>
        <td style={TD}>
          <AxisCell
            ids={entry.acceptance.formatIds}
            order={dictionaries.formatOrder}
            render={(id) => (
              // Formats carry no colour of their own (#728 coloured conditions and certificates).
              <span key={id ?? "single"} style={{ ...ROW_CHIP, ...CELL_CHIP }}>
                {id === null ? "Single" : dictionaries.format(id)}
              </span>
            )}
          />
        </td>
        <td style={{ ...TD, paddingRight: 0 }}>
          <span
            style={{
              ...ROW_CHIP,
              ...CELL_CHIP,
              background: priority.background,
              color: priority.color,
              border: `1px solid ${priority.border}`,
              fontWeight: entry.priority === "high" ? 600 : 500,
            }}
          >
            {WANT_PRIORITY_LABEL[entry.priority]}
          </span>
        </td>
      </tr>
      {hasSubLine && (
        <tr>
          <td colSpan={4} style={{ padding: "0 0 0.3rem" }}>
            <span style={{ display: "flex", flexWrap: "wrap", columnGap: "0.5rem", rowGap: "0.125rem" }}>
              {matched && (
                <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-success)" }}>
                  This one would satisfy it
                </span>
              )}
              {/* The figures alone. They sit under this want's own row, so a sentence restating
                  whose they are is words for what the layout already says — and each bucket is
                  coloured on its own, since only the ones still in the post are news. */}
              <WantCopyCountsLine copies={entry.copies} fontSize="0.6875rem" />
              {entry.notes && (
                <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                  {entry.notes}
                </span>
              )}
            </span>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** One axis of one want: *any*, or its members as chips in the settings' order. */
function AxisCell({
  ids,
  order,
  render,
}: {
  ids: (string | null)[];
  order: string[];
  render: (id: string | null) => React.ReactNode;
}) {
  const view = acceptanceAxisView(ids, order);
  if (view.any) {
    return <span style={{ fontSize: "0.6875rem", fontStyle: "italic", color: "var(--color-text-muted)" }}>any</span>;
  }
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.2rem" }}>
      {view.members.map(render)}
    </span>
  );
}
