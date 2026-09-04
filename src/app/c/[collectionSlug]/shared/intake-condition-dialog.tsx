"use client";

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { defaultTreeSelectButtonClassName } from "@/app/tree-select";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampConditionData } from "@/lib/conditions";
import type { LocationData } from "@/lib/locations";
import {
  catalogValueEntry,
  EMPTY_INTAKE_CATALOG_VALUE,
  type IntakeCatalogValue,
} from "@/lib/intake-catalog-value";
import { PhotoEditor, type PhotoEditorValue } from "@/app/c/[collectionSlug]/inventory/photo-editor";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { IntakeHoldingsLine } from "@/app/c/[collectionSlug]/purchases/[purchaseId]/intake-holdings-line";
import { IntakeCatalogValueField } from "@/app/c/[collectionSlug]/purchases/[purchaseId]/intake-catalog-value";
import { IdentifiedPieceAside, type IdentifiedPiece } from "./tile-zoom-view";
import { NO_AUTOFILL } from "./no-autofill";
import {
  readLast,
  writeLast,
  LS_LAST_CONDITION,
  LS_LAST_CERT,
  LS_LAST_LOCATION,
  LS_LAST_DISPOSITION,
  LS_LAST_SCAN_LOT,
} from "./add-copy-defaults";

/**
 * The **condition step** of every intake in the app (#121): what a copy is, beside what it is of.
 *
 * It lived in `purchase-detail-panel.tsx` until #725, which is where it was first needed and where
 * it stopped being able to stay: the same chain — picker, then this — now runs from the collection's
 * own card scans, with no order anywhere in it. Nothing about the dialog changed in the move; what
 * changed is that `lotChoice` being absent is now an ordinary case rather than the stockbook
 * exception, since a card scanned outside a purchase has no lot to ask about at all.
 *
 * The remembered answers are `add-copy-defaults`', deliberately shared with every other add-copy
 * surface: one set of "the same as last time", so a sitting that moves between screens does not
 * start over.
 */

/** The chip shape the disposition toggles are drawn as, shared with the screens that draw the
 * same flags on a row. */
export const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

export const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

// The tree-select trigger defaults to a compact toolbar height (min-h-8). In the intake dialog
// it sits beside an INPUT_STYLE ref field, so bump its min-height + vertical padding to line the
// two controls up (mirrors the inventory copy form).
const LOCATION_SELECT_BUTTON_CLASS = defaultTreeSelectButtonClassName
  .replace("min-h-8", "min-h-9")
  .replace("py-1", "py-2");

export /** The disposition flags a lot copy can carry, in display order. */
const DISPOSITION_FLAGS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

export /** A stamp or a whole checklist chosen in the picker (#531), awaiting a condition/certificate
 * before its copies are created. */
type PendingSelection =
  | { kind: "stamp"; stampId: string; label: string }
  | { kind: "checklist"; checklistId: string; label: string; requiredCount: number };

export /** The three disposition flags rendered as instant-toggle chips (#160). Shared by the per-copy
 * inline editor and the intake dialog: `values` holds the current on/off of each flag and
 * `onToggle` flips one. Purely presentational — the caller decides whether a toggle persists
 * immediately (per-copy) or updates form state (intake). */
function DispositionChips({
  values,
  onToggle,
  disabled,
}: {
  values: { inCollection: boolean; forSale: boolean; forTrade: boolean };
  onToggle: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      {DISPOSITION_FLAGS.map((d) => {
        const on = values[d.key];
        return (
          <button
            key={d.key}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(d.key, !on)}
            style={{
              ...CHIP,
              cursor: disabled ? "default" : "pointer",
              fontWeight: on ? 600 : 500,
              color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
              borderColor: on ? "var(--color-accent)" : "var(--color-border)",
              background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
            }}
          >
            <Icon name={on ? "check" : "add"} size="xs" /> {d.label}
          </button>
        );
      })}
    </span>
  );
}

export interface IntakeConditionDialogProps {
  selection: PendingSelection;
  collectionId: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  /** Overrides the confirm-button label. Used by the "add lot with stamps" flow where this
   * dialog only captures the choice and advances to the price step (so "Continue", not
   * "Add copy"). Defaults to the copy-count label. */
  submitLabel?: string;
  /** Identifying a **scan tile** (#567): the tile's own crops become this copy's front and back,
   * so the uploader is left out. Not cosmetic — front and back are singleton slots per copy, and
   * an upload arriving beside the tile's crop would be a second front for the same copy. */
  hidePhotos?: boolean;
  /**
   * The pieces this dialog is asking about, drawn beside the form (#592) — present only where there
   * is a picture of **this** piece, which today is the scan-tile flow alone.
   *
   * Condition is *read off the piece*: the cancel decides used against mint, the gum and the hinge
   * marks are on the back, the centring and the margins are on the front. Until #592 the picture
   * was on the tile dialog and nowhere after it, so the collector answered from memory or went back
   * — forty times per card.
   *
   * The stamp's **catalogue photo is deliberately not a fallback**. It is a picture of *a*
   * specimen; beside a condition field it would invite reading a condition off the wrong stamp, and
   * an intake with no scan behind it is better with nothing there.
   *
   * **Several** pieces (#596) are all drawn, small, rather than one of them standing for the rest —
   * ticking them was the collector asserting they are one stamp in one condition, and this is the
   * last place a mistake in that assertion costs a click instead of N copies.
   */
  pieces?: IdentifiedPiece[];
  /** The collection's stated scan resolution (#598), for the measuring tools inside that viewer. */
  scanDpi: number;
  /**
   * How many copies this submit is about to create (#596), when that is more than the selection
   * itself says — a run of tiles identified as one stamp. Stated in the summary box and on the
   * confirm button, before anything exists, as every other bulk action on this screen states it.
   */
  copyCount?: number;
  /**
   * An earlier tile's answers, filled into every field this dialog holds (#595, #757) — present
   * only on a repeat off the identification history, which is why the fields below still read the
   * remembered collection-wide defaults on every other route in.
   *
   * It leads those defaults wherever both have something to say, because the two differ exactly when
   * it matters: after the collector has changed something for this card. And it fills the three the
   * defaults have nothing to say about at all — the stamp (chosen one step back, so it arrives as
   * the `selection`), the format and the in-location ref.
   *
   * The **format** being among them is not a reversal of #573. That decision is about what happens
   * behind the collector's back: a value usually right may be remembered, one usually wrong must not
   * be, because a wrong value nobody chose is invisible. Here the collector pressed a button that
   * named the format it would apply, so nothing is inherited — it was asked for.
   */
  prefill?: {
    conditionId: string;
    certificateStatusId: string;
    formatId: string;
    locationId: string;
    locationRef: string;
    disposition: { inCollection: boolean; forSale: boolean; forTrade: boolean };
    lotId: string;
  };
  /**
   * Which lot the created copy belongs to (#586) — asked only when identifying a scan tile, since
   * every other entry into this dialog was reached *through* a lot and already knows.
   *
   * A copy takes its cost basis from a lot, and a card of a settled auction holds pieces belonging
   * to a dozen of them, so the answer cannot come from the scan. It is asked **here**, beside the
   * condition and the location, because this is the step that asks everything else about the copy —
   * and it is remembered here for the same reason those are: a card, or a run of them, is worked
   * through before the next is started, so the answer is stable across a long stretch of tiles.
   *
   * With **one** open lot nothing is asked: that is the stockbook case, which had no such question
   * before the re-parenting and must not gain one.
   */
  lotChoice?: {
    /** Scopes the remembered answer. A lot id means nothing on the next parcel, so remembering it
     * per collection — as the condition and location are — would restore an id that is refused. */
    purchaseId: string;
    /** The order's **open** lots, in the order the cards are drawn in. A closed lot takes no new
     * copy at all, so offering it would be offering a refusal. */
    lots: { id: string; label: string; status: string }[];
  };
  onBack: () => void;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

export /** After a stamp or whole issue is picked, capture the condition (required) and certificate
 * (optional) that every created copy will share, then confirm the intake (#121). The last
 * choice is remembered and preselected for the next stamp. */
function IntakeConditionDialog({
  selection,
  collectionId,
  conditions,
  certificateStatuses,
  locations,
  isPending,
  error,
  submitLabel,
  hidePhotos,
  pieces,
  scanDpi,
  copyCount,
  prefill,
  lotChoice,
  onBack,
  onClose,
  onSubmit,
}: IntakeConditionDialogProps) {
  // Preselect the last-used values, ignoring any that no longer exist in this collection. A repeat
  // (#595) leads them with the previous tile's own answers — validated the same way, since a
  // condition deleted mid-sitting is the same missing id whichever of the two named it.
  //
  // Each field asks whether there *is* a prefill, never whether it has something in it: a previous
  // tile with no certificate is an answer, and reading an empty one as "nothing to say" would let
  // the remembered default put a certificate on a copy the collector asked to be the same as one
  // without.
  const [conditionId, setConditionId] = useState(() => {
    const last = prefill ? prefill.conditionId : readLast(LS_LAST_CONDITION, collectionId);
    return conditions.some((c) => c.id === last) ? last : "";
  });
  const [certId, setCertId] = useState(() => {
    const last = prefill ? prefill.certificateStatusId : readLast(LS_LAST_CERT, collectionId);
    return certificateStatuses.some((c) => c.id === last) ? last : "";
  });
  // The physical format of the piece being identified (#573) — a pair, a block, a strip — blank
  // meaning *single*, which is a value and not a missing answer (`StampFormat`, ADR-0020).
  //
  // It is deliberately **not** remembered, unlike the condition, certificate, location and
  // disposition around it, and that asymmetry is the point rather than an oversight to tidy up.
  // Condition repeats down a stockbook page — a card is often all mint or all used — so restoring it
  // saves hundreds of clicks. Format does not repeat: single is the default state of the world and a
  // multiple is the exception, so a sticky format would mark every later single as a block of four
  // until the collector noticed. That is this field's own reason for existing, inverted — and worse
  // than what it replaces, because a format nobody chose is invisible where a missing one at least
  // reads as *single*. The cost is one extra pick on a run of multiples; the gain is that a
  // multiple is always something that was chosen.
  //
  // That guarantee is enforced **here**, and deliberately not left to the component tree. Both
  // callers render this dialog conditionally today, so it unmounts on every return to the picker
  // and `useState("")` would start fresh on its own — but that is a fact about how the dialog is
  // mounted, not about formats, and someone keeping it mounted across a transition months from now
  // would silently make the field sticky: the very behaviour this field rejected, reintroduced by a
  // change that has nothing to do with it, and invisible to any test, since it is client state.
  // So the reset rides on `selection`, which both callers rebuild at **every** pick — including a
  // second pick of the same stamp, the block-of-four-then-singles run a key derived from the stamp
  // id would sit right through.
  //
  // A repeat (#595) is the one thing that fills it, and it is not an exception to any of that: the
  // collector pressed a button naming the format, which is a format that was chosen. The reset below
  // still holds — a different pick clears it, including the pick that follows a repeat.
  const [formatId, setFormatId] = useState(prefill?.formatId ?? "");
  const [formatSelection, setFormatSelection] = useState(selection);
  if (formatSelection !== selection) {
    setFormatSelection(selection);
    setFormatId("");
  }
  // Fetched here rather than threaded through the purchase screen, the reason the copy dialog
  // fetches it: it is one more dictionary and the screens that need it are not the ones that have it.
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const [locationId, setLocationId] = useState(() => {
    const last = prefill ? prefill.locationId : readLast(LS_LAST_LOCATION, collectionId);
    // Only restore an assignable location that still exists (grouping-only nodes and
    // deleted ones fall back to none).
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  // Disposition preset for the copies this intake creates (#160): toggled instantly as chips,
  // carried into the created copies on submit. Remembered per collection like the other
  // choices, to speed up bulk intake.
  const [disposition, setDisposition] = useState(() => {
    if (prefill) return prefill.disposition;
    const active = new Set(readLast(LS_LAST_DISPOSITION, collectionId).split(",").filter(Boolean));
    return {
      inCollection: active.has("inCollection"),
      forSale: active.has("forSale"),
      forTrade: active.has("forTrade"),
    };
  });
  // The lot a tile's copy goes onto (#586), pre-filled with the last one answered for this order.
  // A single open lot is used without being drawn at all — see `lotChoice`. A remembered lot that
  // has since been closed or deleted falls back to the first one offered, which is the same call
  // the condition and location above make about an id that no longer exists.
  const lotOptions = lotChoice?.lots ?? [];
  const [lotId, setLotId] = useState(() => {
    if (!lotChoice || lotOptions.length === 0) return "";
    const last = prefill
      ? prefill.lotId
      : readLast(LS_LAST_SCAN_LOT, `${collectionId}:${lotChoice.purchaseId}`);
    return lotOptions.some((l) => l.id === last) ? last : lotOptions[0].id;
  });
  const asksForLot = lotChoice != null && lotOptions.length > 1;

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  // Photos are captured only for a single-stamp intake (#148): a whole-issue intake fans out
  // into several distinct copies, so shared photos would be meaningless. The pending change-set
  // is held in a ref (the derive-on-change loop in PhotoEditor never depends on it) and written
  // onto the FormData on submit; Save waits while any staged upload is still in flight.
  const singleStamp = selection.kind === "stamp";
  // …and never when the images are already in hand (#567): a tile hands the copy its own crops.
  const photos = singleStamp && !hidePhotos;
  const photoValueRef = useRef<PhotoEditorValue>({
    changeSet: { add: [], update: [], remove: [] },
    uploading: false,
  });
  const [photosUploading, setPhotosUploading] = useState(false);
  const handlePhotoChange = useCallback((value: PhotoEditorValue) => {
    photoValueRef.current = value;
    setPhotosUploading(value.uploading);
  }, []);

  // The catalogue value typed while the paper catalogue is still open at this stamp (#593). Held in
  // a ref for the reason the photo change-set is: the field re-reads on every change of condition,
  // certificate or format, and nothing in this form depends on what is currently in it. Single-stamp
  // intake only — a whole-checklist intake fans out across many stamps, and one figure could not be
  // the catalogue value of all of them, which is the rule photos and the format field follow.
  const catalogValueRef = useRef<IntakeCatalogValue>(EMPTY_INTAKE_CATALOG_VALUE);
  const handleCatalogValueChange = useCallback((value: IntakeCatalogValue) => {
    catalogValueRef.current = value;
  }, []);
  /** A failed price write, reported in the dialog's own footer beside the caller's errors. */
  const [priceError, setPriceError] = useState<string | undefined>();
  const [savingPrice, setSavingPrice] = useState(false);

  // How the chosen condition × certificate reads, which is what the catalogue value is recorded
  // against. Built here because this is where the dictionaries are; worded like the quick-price
  // dialog's own badge, so the two surfaces name the same key the same way.
  //
  // The **format is not in it**, because the figure does not land on the chosen format: it is always
  // the single's price, the way the quick-CV dialog on a copy row records it, with a multiple's value
  // derived from it by the format's factor. Naming a format here would promise a row this never
  // writes.
  const subjectLabel = [
    conditions.find((c) => c.id === conditionId)?.abbreviation,
    certificateStatuses.find((c) => c.id === certId)?.abbreviation,
  ]
    .filter(Boolean)
    .join(" · ");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    writeLast(LS_LAST_CONDITION, collectionId, conditionId);
    writeLast(LS_LAST_CERT, collectionId, certId);
    writeLast(LS_LAST_LOCATION, collectionId, locationId);
    writeLast(
      LS_LAST_DISPOSITION,
      collectionId,
      DISPOSITION_FLAGS.filter((d) => disposition[d.key]).map((d) => d.key).join(",")
    );
    if (lotChoice && lotId) {
      writeLast(LS_LAST_SCAN_LOT, `${collectionId}:${lotChoice.purchaseId}`, lotId);
    }
    const fd = new FormData(e.currentTarget);
    if (lotChoice && lotId) fd.set("lotId", lotId);
    fd.set("inCollection", String(disposition.inCollection));
    fd.set("forSale", String(disposition.forSale));
    fd.set("forTrade", String(disposition.forTrade));
    if (photos) {
      fd.set("photoChangeSet", JSON.stringify(photoValueRef.current.changeSet));
    }

    // The catalogue value goes **before** the intake and on its own (#593). It is a fact about the
    // *stamp* — it needs no copy to exist — so it is written here rather than folded into each of
    // the three actions this dialog's submit reaches, two of which are server actions and the third
    // of which does not create anything until a later step.
    //
    // Before, and blocking on failure, because a figure the collector read off the paper catalogue
    // must not be dropped in silence; and safely retried, because the field prefills from what is
    // now recorded, so a second attempt at a failed intake writes nothing a second time.
    if (selection.kind === "stamp") {
      const entry = catalogValueEntry(catalogValueRef.current);
      if (entry) {
        setSavingPrice(true);
        setPriceError(undefined);
        const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
        // At the **single**, whatever the format field says — which is what the action does for
        // every quick price now, the intake field included: the figure comes off a paper catalogue,
        // which quotes singles, and a multiple's value is that figure times the format's factor.
        const r = await quickSetCatalogPricesAction(selection.stampId, conditionId, certId || null, [
          entry,
        ]);
        setSavingPrice(false);
        if (r.status === "error") {
          setPriceError(r.message);
          return;
        }
      }
    }
    onSubmit(fd);
  }
  const count = selection.kind === "checklist" ? selection.requiredCount : 1;
  const summary =
    selection.kind === "checklist"
      ? `Whole set: ${selection.label} — ${count} stamp${count === 1 ? "" : "s"}`
      : selection.label;
  const actionLabel = isPending
    ? submitLabel
      ? "Working…"
      : "Adding…"
    : savingPrice
      ? "Saving the catalog value…"
      : photosUploading
      ? "Uploading photos…"
      : (submitLabel ??
        (selection.kind === "checklist"
          ? `Add ${count} cop${count === 1 ? "y" : "ies"}`
          : "Add copy"));

  // The picture beside the form rather than above it (#592): a thumbnail over a form this long
  // pushes the fields it exists to serve off the screen. The form column keeps the width it was
  // designed at, so the dialog reads identically with and without a piece — the picture is added
  // beside it, and nothing about the questions moves.
  const pieceAside =
    pieces && pieces.some((p) => p.sides.length > 0) ? (
      <IdentifiedPieceAside collectionId={collectionId} pieces={pieces} scanDpi={scanDpi} />
    ) : undefined;

  return (
    <DialogShell
      title="Set condition"
      onClose={onClose}
      // The same shape as the tile dialog one step back, which is where this picture was last seen:
      // two surfaces showing the same scan at the same size is one habit rather than two.
      maxWidth={pieceAside ? "min(96vw, 78rem)" : "36rem"}
      height={pieceAside ? "min(90vh, 54rem)" : undefined}
      aside={pieceAside}
      asideWidth="min(46vw, 38rem)"
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.625rem 0.75rem",
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            {summary}
            {/* What is about to exist, before anything is created (#596). It sits inside the box
                that names the pick because it is a fact about *this* answer — one stamp, one
                condition, one certificate, one format, one lot, and this many pieces of paper.
                Silent for the ordinary single tile, which needs no count to read as one copy. */}
            {copyCount != null && copyCount > 1 && (
              <div style={{ marginTop: "0.25rem", color: "var(--color-text-primary)" }}>
                <strong>{copyCount} copies</strong> will be created — one per tile, each keeping its
                own pictures.
              </div>
            )}
            {/* What the collection already holds of this stamp, and what it is still after (#562)
                — inside the box that already names the pick, so the line reads as a fact about it
                rather than as a second heading. Single-stamp intake only: a whole-checklist intake
                fans out across many stamps and has no one stamp to report on, exactly as photos
                below are single-stamp only (#148). */}
            {selection.kind === "stamp" && (
              <IntakeHoldingsLine
                collectionId={collectionId}
                stampId={selection.stampId}
                conditions={conditions}
                conditionId={conditionId}
                certificateStatusId={certId}
                formatId={formatId}
              />
            )}
          </div>

          {/* Which lot the copy belongs to (#586) — drawn only when the order has more than one
              open, and **above** the condition because it is the question about *this* order that
              the rest of the form is answered under. It is not a `name`d field: the submit writes
              it explicitly alongside remembering it, so the two cannot fall out of step. */}
          {asksForLot && (
            <div style={{ marginBottom: "0.75rem" }}>
              <LabelWithError htmlFor="intake-lot">Lot</LabelWithError>
              <select
                id="intake-lot"
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                {lotOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p
                style={{
                  margin: "0.25rem 0 0",
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                }}
              >
                One card can hold pieces from several lots, so this is asked per copy — and the last
                answer leads, since a card is usually worked through before the next is started.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="intake-condition">Condition</LabelWithError>
              <select
                id="intake-condition"
                name="conditionId"
                value={conditionId}
                onChange={(e) => setConditionId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">— Select —</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="intake-cert">Certificate</LabelWithError>
              <select
                id="intake-cert"
                name="certificateStatusId"
                value={certId}
                onChange={(e) => setCertId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">— None —</option>
                {certificateStatuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
            {/* Format (#573): the piece in the tweezers is a pair or a block as often as it is a
                single, and this is the moment that is known — afterwards it is one copy edit per
                piece, from memory, after the sorting pass. Single-stamp intake only, the rule
                photos follow and for a stronger reason: a whole-checklist intake fans out across
                many stamps and "block of four" could not be true of all of them. Absent entirely
                until the collection defines formats, as the inventory list's own format controls
                are — most collections never define any. */}
            {singleStamp && formats.length > 0 && (
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="intake-format">Format</LabelWithError>
                <select
                  id="intake-format"
                  name="formatId"
                  value={formatId}
                  onChange={(e) => setFormatId(e.target.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  {/* No "single" row exists in the dictionary — a copy with no format *is* the
                      single, exactly as no certificate means none. */}
                  <option value="">— Single —</option>
                  {formats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.abbreviation})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* The catalogue value, while the paper catalogue is still open at this stamp (#593).
              Directly under the row it is keyed on — a catalogue price belongs to a condition ×
              certificate, and putting it anywhere else would leave the collector to work out which
              of the answers above it follows. The format picked beside it is *not* one of those
              answers: the figure always lands on the single, with a multiple's value derived from it.
              One field, the primary catalogue only: the full quick-price dialog stays for the
              multi-vendor case, and a row of vendor inputs here would bury the step. Single-stamp
              intake only, the rule photos and the format field follow — one figure cannot be the
              catalogue value of a whole set's stamps. */}
          {selection.kind === "stamp" && (
            <IntakeCatalogValueField
              stampId={selection.stampId}
              conditionId={conditionId}
              certificateStatusId={certId}
              subjectLabel={subjectLabel}
              // The condition row above is two controls, or three once the collection defines
              // formats — the same count the row itself is built from, so the two cannot drift.
              columns={singleStamp && formats.length > 0 ? 3 : 2}
              disabled={isPending || savingPrice}
              onChange={handleCatalogValueChange}
            />
          )}

          {/* Storage location (#56/#121): optional at intake, shared by every created copy.
              An in-location ref (#148) sits beside it, disabled until a location is chosen. */}
          <div style={{ marginTop: "0.75rem" }}>
            <LabelWithError htmlFor="intake-locationId-button">Location (optional)</LabelWithError>
            {locations.length === 0 ? (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                No locations defined yet. Add some on the Locations screen to file copies away.
              </p>
            ) : (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <div style={{ flex: 3 }}>
                  <LocationTreeSelect
                    locations={locations}
                    locationTree={locationTree}
                    name="locationId"
                    selectedId={locationId}
                    onSelectedIdChange={setLocationId}
                    onlyAssignableSelectable
                    disabled={isPending}
                    noneOptionLabel="— None"
                    buttonClassName={LOCATION_SELECT_BUTTON_CLASS}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    id="intake-locationRef"
                    name="locationRef"
                    type="text"
                    placeholder="Ref, e.g. A234"
                    // The one field here that is never remembered between intakes, and is filled by
                    // a repeat all the same (#595): two duplicates worked through in a run go into
                    // the same place in the same box, and the collector asked for the same again.
                    // Uncontrolled, so this is the value the field opens with and nothing more.
                    defaultValue={prefill?.locationRef}
                    disabled={isPending || !locationId}
                    {...NO_AUTOFILL}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Disposition (#160): preset where the copies land once sorted. Instant-toggle chips
              — no separate save; the choice rides along on the intake submit. */}
          <div style={{ marginTop: "0.75rem" }}>
            <LabelWithError htmlFor="">Disposition (optional)</LabelWithError>
            <div style={{ marginTop: "0.25rem" }}>
              <DispositionChips
                values={disposition}
                disabled={isPending}
                onToggle={(flag, value) => setDisposition((d) => ({ ...d, [flag]: value }))}
              />
            </div>
          </div>

          {/* Photos (#148): only for a single-stamp intake — a whole-issue intake creates several
              distinct copies, so shared photos would be ambiguous. Eager staged uploads; the
              pending change-set applies to the created copy on submit. Absent entirely when the
              copy is being identified from a scan tile (#567), whose crops it already gets. */}
          {photos && (
            <div style={{ marginTop: "0.75rem" }}>
              <LabelWithError htmlFor="">Photos (optional)</LabelWithError>
              <PhotoEditor
                collectionId={collectionId}
                initialPhotos={[]}
                disabled={isPending}
                onChange={handlePhotoChange}
              />
            </div>
          )}

          <p style={{ margin: "0.75rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            Copies are added <strong>not yet in your collection</strong> (
            <strong>to sort</strong> once the order has arrived, otherwise <strong>ordered</strong>).
            Cost-basis stays pending until the lot is closed.
          </p>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          cancelLabel="Back"
          onCancel={onBack}
          disabled={isPending || !conditionId || photosUploading || savingPrice}
          // The caller's error and this dialog's own read the same way, and only one can be
          // standing: a failed catalogue write returns before the intake is attempted at all.
          error={priceError ?? error}
        />
      </form>
    </DialogShell>
  );
}
