"use client";

import { THUMB_OBJECT_FIT, ThumbPreview } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { ConditionChip } from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import { useAreaVendorMaps, type AreaVendorMaps } from "./use-area-vendor-maps";
import type { CollectionAreaData } from "@/lib/areas";
import { catalogChipLabels, catalogLabel } from "@/lib/area-vendor";
import { CatalogNumberChips } from "./catalog-number-chips";
import { formatItemNo } from "@/lib/item-number";
import type { IdentifyHistoryAnswers, IdentifyHistoryEntry } from "@/lib/tile-identify-history";

/**
 * What has just been identified on this screen (#757), beside the piece being identified now — each
 * row a picture, the stamp, the condition, and a press that identifies this tile the same way.
 *
 * It **replaces** #595's *Same as the last*. That action carried one identification in screen state
 * and named it on a button; duplicates on a card arrive in interleaved runs, so one deep is short by
 * a few exactly when a run resumes — and a footer button and a list would have been the same action
 * in two places. The first row is that button, with the piece drawn instead of described.
 *
 * Pressing a row **fills the form and stops at the ordinary confirm**, which is the whole of #595's
 * saving and its whole safeguard: the stamp is the one answer intake does not remember on its own,
 * and a consumed tile has no undo short of deleting the copy.
 */
export function IdentifyHistory({
  collectionId,
  areas,
  entries,
  canIdentify,
  disabled,
  onRepeat,
}: {
  collectionId: string;
  /** The area tree, for the catalogue prefixes — a stamp is named by its primary vendor's number
   * with that vendor's prefix (#377), the way every other list in the app names one. */
  areas: CollectionAreaData[];
  /** The screen's last distinct identifications, newest first (`identifyHistory`). Empty on a
   * screen where nothing has been identified yet, which draws nothing at all. */
  entries: IdentifyHistoryEntry[];
  /** Whether a new copy is possible at all — an order whose every lot is closed takes none, however
   * it is asked for, so the rows are offered disabled rather than absent: the history is still worth
   * reading on a closed order. */
  canIdentify: boolean;
  disabled: boolean;
  onRepeat: (answers: IdentifyHistoryAnswers) => void;
}) {
  // The one dictionary the rows need that the copy does not carry: a format travels as an id, and
  // the abbreviation is what #595's button said. Fetched here rather than passed down, because this
  // is the only surface on the dialog that names one.
  const { data: formats = [] } = useCollectionFormats(collectionId);
  // One derivation for the whole list, not one per row — the same shared query the shortlist beside
  // this one resolves its rows through.
  const maps = useAreaVendorMaps(areas, collectionId);

  // Nothing identified yet on this screen. No panel and no empty state: the first tile of a card is
  // the ordinary case, and a heading over nothing would be furniture in the column the piece is
  // being read in.
  if (entries.length === 0) return null;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginBottom: "0.875rem" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          Just identified
        </strong>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          — press one to identify this the same way
        </span>
      </div>
      {entries.map((entry) => (
        <IdentifyHistoryRow
          key={entry.tileId}
          collectionId={collectionId}
          entry={entry}
          maps={maps}
          formatAbbreviation={
            formats.find((f) => f.id === entry.answers.formatId)?.abbreviation ?? null
          }
          canIdentify={canIdentify}
          disabled={disabled}
          onRepeat={onRepeat}
        />
      ))}
    </div>
  );
}

function IdentifyHistoryRow({
  collectionId,
  entry,
  maps,
  formatAbbreviation,
  canIdentify,
  disabled,
  onRepeat,
}: {
  collectionId: string;
  entry: IdentifyHistoryEntry;
  maps: AreaVendorMaps;
  /** The format's abbreviation, or null for a single and for a collection that defines none — the
   * same field #595's button named only when the piece was not a single. */
  formatAbbreviation: string | null;
  canIdentify: boolean;
  disabled: boolean;
  onRepeat: (answers: IdentifyHistoryAnswers) => void;
}) {
  const photoUrl = (variant: "thumb" | "full") =>
    entry.photoId ? `/api/collections/${collectionId}/photos/${entry.photoId}/${variant}` : null;
  const blocked = disabled || !canIdentify;

  /** The number the stamp is reached for by, **prefixed** — `Mi·DE-BM 68`, not `68` — for the
   * picture's hover label. One rule with the copies list, because the collector is matching this
   * row against a number they read somewhere else in the app. */
  const number = catalogLabel(entry.subject, maps);
  /** Every number, as the chips the stamp rows draw (#1525) — the main catalogue's highlighted and
   * first. The row draws them, and the condition step's box draws the same ones on a press. */
  const chips = catalogChipLabels(
    entry.subject.catalogNumbers,
    maps.vendorMapFor(entry.subject.areaId, entry.subject.issueId),
    entry.subject.areaId ? (maps.primaryVendorByArea.get(entry.subject.areaId) ?? null) : null
  );
  /** …and the whole of it in one line, worded exactly as the picker words a pick — a repeat must
   * not describe its stamp differently from the route through the picker. */
  const label =
    [chips.map((c) => c.label).join(", ") || null, entry.subject.name || null]
      .filter(Boolean)
      .join(" · ") || "(unnamed stamp)";

  return (
    // The picture at a row's height is enough to place a piece already seen minutes ago; the hover
    // preview is what settles a shade or a cancellation, which is the comparison this list exists
    // for. Wrapping the whole row rather than the thumbnail alone, so the preview follows the
    // pointer on its way to the press.
    <ThumbPreview
      src={photoUrl("full")}
      thumbSrc={photoUrl("thumb")}
      label={`${number} — ${formatItemNo(entry.itemNo)}`}
      style={{ display: "block" }}
    >
      <button
        type="button"
        onClick={() => onRepeat({ ...entry.answers, label, chips, name: entry.subject.name })}
        disabled={blocked}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          textAlign: "left",
          padding: "0.3rem 0.5rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          color: "var(--color-text-primary)",
          font: "inherit",
          fontSize: "0.8125rem",
          cursor: blocked ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: "2.5rem",
            height: "2.5rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-page)",
            backgroundImage: photoUrl("thumb") ? `url("${photoUrl("thumb")}")` : undefined,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            // A thumbnail fits, never crops: a stamp with its margin cut off is a different stamp.
            backgroundSize: THUMB_OBJECT_FIT,
          }}
        >
          {/* Presentational only; the row's own words are what a reader is given. */}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.3rem",
              minWidth: 0,
            }}
          >
            {/* Inert: the row is the button, and a press anywhere on it is the repeat. A stamp with
                no number at all is named by its name, as the copies list names one. */}
            {chips.length > 0 ? (
              <CatalogNumberChips chips={chips} />
            ) : (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {number}
              </span>
            )}
            {/* The condition in the colour the collector recognises it by on every list (#728),
                rather than as a word in a sentence — this row is read at a glance, beside a piece,
                and the colour is half of how it is read. */}
            <ConditionChip
              collectionId={collectionId}
              conditionId={entry.answers.conditionId}
              label={entry.conditionAbbreviation}
            />
            {formatAbbreviation && (
              <span style={{ color: "var(--color-text-muted)" }}>{formatAbbreviation}</span>
            )}
            {/* A piece carrying more than its first stamp (#750) — said on the row, because
                pressing it identifies the next tile as that piece and not as the stamp named. */}
            {entry.answers.stamps.length > 0 && (
              <span style={{ color: "var(--color-accent)", whiteSpace: "nowrap" }}>
                several stamps
              </span>
            )}
          </span>
          {/* The copy it became, in the number the copies list is searched by (#268) — said quietly,
              because it identifies the row rather than describing the piece. */}
          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {formatItemNo(entry.itemNo)}
          </span>
        </span>
      </button>
    </ThumbPreview>
  );
}
