"use client";

import { useState } from "react";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { StampConditionData } from "@/lib/conditions";
import type { ColnectReportRow } from "@/lib/colnect-list-report";
import {
  colnectListBucketLabel,
  colnectLocalFixesFor,
  colnectLocalFixHint,
  colnectLocalFixLabel,
  type ColnectListSource,
  type ColnectListSourceOfTruth,
  type ColnectLocalFix,
} from "@/lib/colnect-list-sync-rules";
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { ColnectChip } from "@/app/c/[collectionSlug]/shared/colnect-chip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

// One difference on the report (#686).
//
// **Both sides are always printed**, whatever bucket the row is in. A row is filed under exactly
// one — quantity before grade — because that word is what an *ignore* and a *done* are keyed by,
// but a stamp can differ in both, and a row that showed only its own bucket's number would hide the
// other. So the line reads *Here: 1 × MNH · Colnect: 3 × MNH* either way and the chip says which of
// the two put it on the report.
//
// **The way out is a link to Colnect**, #441's rule holding here: the item's own page where an id
// is known, a search on the first catalog number where it is not. The local half of the row is the
// app's own `StampIdentity`, which already draws that chip; a row only Colnect has draws it
// directly, since there is no stamp for the identity to be about.

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  fontSize: "0.75rem",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

const MUTED: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

const SIDE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

/** One side's holding, as the row prints it: `2 × MNH`, `2` where no grade is stated, `—` where the
 *  side holds nothing at all. The grade blank is the honest one — the local side states none when
 *  its copies disagree, and Colnect's cell is simply empty on some rows. */
function holding(quantity: number | null, grade: string | null): string {
  if (quantity === null) return "—";
  return grade ? `${quantity} × ${grade}` : String(quantity);
}

/** What the collector is expected to do about a row only Colnect has, which is the mapping's
 *  `sourceOfTruth` said out loud. The report still proposes rather than performs — the fixes below
 *  act on **this** side, and applying the other one is the extension's run (#689). */
function proposal(bucket: string, sourceOfTruth: ColnectListSourceOfTruth): string | null {
  if (bucket !== "only-colnect") return null;
  return sourceOfTruth === "local" ? "Remove it on Colnect" : "Adopt it here";
}

/** The icon a fix is drawn with, from the app's own vocabulary (ADR-0030). Clearing takes something
 *  away, setting puts it back, and narrowing a want is an edit of what it accepts. */
const FIX_ICON: Record<ColnectLocalFix, "hidden" | "check" | "edit"> = {
  clear: "hidden",
  set: "check",
  grade: "edit",
};

export function ColnectReportRowView({
  row,
  collectionId,
  collectionSlug,
  source,
  sourceOfTruth,
  vendorMap,
  primaryVendorId,
  conditionsById,
  isLast,
  onMarkDone,
  onIgnore,
  onFix,
  onAdopt,
}: {
  row: ColnectReportRow;
  collectionId: string;
  collectionSlug: string;
  source: ColnectListSource;
  sourceOfTruth: ColnectListSourceOfTruth;
  vendorMap: Map<string, AreaCatalogEntry>;
  primaryVendorId: string | null;
  conditionsById: Map<string, StampConditionData>;
  isLast: boolean;
  onMarkDone: (row: ColnectReportRow, done: boolean) => void;
  onIgnore: (row: ColnectReportRow) => void;
  /** Fixing this side from the row (#687) — the panel opens the dialog that names what it touches. */
  onFix: (row: ColnectReportRow, fix: ColnectLocalFix) => void;
  /** Adopting a Colnect-only wish into a want (#688), where the list is one that admits it. */
  onAdopt: ((row: ColnectReportRow) => void) | null;
}) {
  const [hovered, setHovered] = useState(false);

  const localGrade = row.localConditionId
    ? (conditionsById.get(row.localConditionId)?.abbreviation ?? null)
    : null;
  const hidden = row.done || row.ignored;

  const actions: RowAction[] = [];
  const stampHref = row.stampId ?? row.candidateStampId;
  if (stampHref) {
    actions.push({
      key: "stamp",
      label: "Go to stamp",
      icon: "stamps",
      href: `/c/${collectionSlug}/stamps/${stampHref}`,
    });
  }

  // Fixing **this** side (#687). Absent rather than disabled where a row admits none: a menu that
  // lists every fix greyed out on every row is noise, and the one disabled entry this menu already
  // has is about a row with no identity at all, which is a different thing to say.
  const fixes = colnectLocalFixesFor({
    bucket: row.bucket,
    source,
    sourceOfTruth,
    candidateCopies: row.candidateCopies,
  });
  for (const fix of fixes) {
    actions.push({
      key: `fix-${fix}`,
      label: colnectLocalFixLabel(fix, source, row.colnectGrade),
      icon: FIX_ICON[fix],
      hint: colnectLocalFixHint(fix, source),
      separatorBefore: actions.length > 0,
      onSelect: () => onFix(row, fix),
    });
  }
  if (onAdopt && row.bucket === "only-colnect" && row.colnectId) {
    actions.push({
      key: "adopt",
      label: "Add it to the want list",
      icon: "wants",
      hint: row.candidateStampId
        ? undefined
        : "Only if it resolves to a stamp here — the Assistant's own matcher decides, and writes nothing.",
      separatorBefore: actions.length > 0,
      onSelect: () => onAdopt(row),
    });
  }

  if (row.colnectId) {
    actions.push({
      key: "done",
      label: row.done ? "Not done after all" : "Mark done on Colnect",
      icon: "check",
      hint: row.done
        ? undefined
        : "Hides it until the next import — that is how long the claim can be trusted.",
      separatorBefore: actions.length > 0,
      onSelect: () => onMarkDone(row, !row.done),
    });
    actions.push({
      key: "ignore",
      label: row.ignored ? "Stop ignoring" : "Ignore",
      icon: row.ignored ? "restore" : "hidden",
      hint: row.ignored ? undefined : "An accepted difference — stays hidden across imports.",
      onSelect: () => onIgnore(row),
    });
  } else {
    actions.push({
      key: "unlinked",
      label: "Nothing to mark",
      icon: "warning",
      disabled: true,
      hint: "Without a Colnect ID there is no difference to accept — nothing was checked.",
      separatorBefore: actions.length > 0,
    });
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.625rem 1rem",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
      }}
    >
      {/* The stamp's own picture where there is a stamp; a reserved column where there is not, so
          the text of every row still lines up down a list that mixes the two. */}
      <PhotoThumb collectionId={collectionId} photos={row.photos} reserveWhenEmpty />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.3125rem",
          // A row put away is faded on its content, never on the row: `opacity` on the container
          // would take the background with it.
          opacity: hidden ? 0.6 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ ...CHIP, fontWeight: 600 }}>{colnectListBucketLabel(row.bucket)}</span>
          {row.stampId ? (
            <StampIdentity
              stamp={{
                name: row.stampName,
                catalogNumbers: row.catalogNumbers,
                colnectId: row.colnectId,
              }}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
              size="small"
            />
          ) : (
            <>
              <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                {row.colnectName || "(unnamed on Colnect)"}
              </span>
              <ColnectChip colnectId={row.colnectId} />
            </>
          )}
          {row.done && <span style={CHIP}>Done on Colnect</span>}
          {row.ignored && <span style={CHIP}>Ignored</span>}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "baseline" }}>
          <span style={SIDE}>
            <span style={MUTED}>Here </span>
            {holding(row.localQuantity, localGrade)}
          </span>
          <span style={SIDE}>
            <span style={MUTED}>Colnect </span>
            {holding(row.colnectQuantity, row.colnectGrade)}
          </span>
          {row.country && <span style={MUTED}>{row.country}</span>}
          {/* Colnect's own numbers, where the row came from the file — the way to recognise an item
              the collection has never heard of, since there is no stamp to draw chips off. */}
          {!row.stampId && row.colnectCatalogCodes && (
            <span style={MUTED}>{row.colnectCatalogCodes}</span>
          )}
          {row.ignoredNote && <span style={MUTED}>“{row.ignoredNote}”</span>}
        </div>

        {proposal(row.bucket, sourceOfTruth) && (
          <div style={MUTED}>{proposal(row.bucket, sourceOfTruth)}</div>
        )}
      </div>

      <RowActionsMenu actions={actions} />
    </div>
  );
}
