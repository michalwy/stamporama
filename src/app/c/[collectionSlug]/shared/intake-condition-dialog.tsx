"use client";

import type { ScanningSetup } from "@/lib/scanning-profile";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DIALOG_MAX_HEIGHT,
  DIALOG_MAX_WIDTH,
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
import {
  PhotoEditor,
  type PhotoEditorPreview,
  type PhotoEditorValue,
} from "@/app/c/[collectionSlug]/inventory/photo-editor";
import { HeldCopiesCompareDialog } from "@/app/c/[collectionSlug]/purchases/[purchaseId]/held-copies-compare-dialog";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { IntakeHoldingsLine } from "@/app/c/[collectionSlug]/purchases/[purchaseId]/intake-holdings-line";
import { HeldCopyThumbs } from "@/app/c/[collectionSlug]/purchases/[purchaseId]/held-copy-thumbs";
import { IntakeCatalogValueField } from "@/app/c/[collectionSlug]/purchases/[purchaseId]/intake-catalog-value";
import { IdentifiedPieceAside, type IdentifiedPiece } from "./tile-zoom-view";
import { TileStampPhotoField, pieceFrontPhotoId } from "./tile-stamp-photo-field";
import { useStampPhotos } from "@/app/c/[collectionSlug]/stamps/use-stamps-query";
import {
  effectiveStampPhotoChoice,
  stampPhotoFormValue,
  type StampPhotoChoice,
} from "@/lib/tile-stamp-photo";
import { NO_AUTOFILL } from "./no-autofill";
import { CatalogNumberChips } from "./catalog-number-chips";
import {
  pickedChipLabels,
  pickedStampText,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import type { CatalogChipLabel } from "@/lib/area-vendor";
import {
  readLast,
  writeLast,
  LS_LAST_CONDITION,
  LS_LAST_CERT,
  LS_LAST_LOCATION,
  LS_LAST_DISPOSITION,
  LS_LAST_SCAN_LOT,
} from "./add-copy-defaults";
import { TextInput } from "./text-input";
import {
  SEED_ORIGIN_LABEL,
  keeperAnswers,
  keeperGroups,
  markFaultIds,
  markTagIds,
  sameFaults,
  seedFaults,
  seedField,
  seedTags,
  type FaultSeed,
  type SeedOrigin,
  type TagSeed,
} from "@/lib/tile-marks";
import type { FaultEntry } from "@/lib/fault-entry";
import { tagEntryKey, type TagEntry } from "@/lib/tag-entry";
import { FaultEntryField } from "./fault-entry-field";
import { TagEntryField } from "./tag-entry-field";
import { useCollectionFaults } from "./use-faults";
import { useCollectionTags } from "./use-tags";
import { dispositionToggleColors } from "./disposition-colors";
import { ConditionCertificateChips } from "./dictionary-chip";
import { formControl } from "@/app/control-style";

/**
 * The **condition step** of every intake in the app (#121): what a copy is, beside what it is of.
 *
 * It lived in `purchase-detail-panel.tsx` until #725 moved it out, and it stays a module of its own:
 * `lotChoice` absent is the stockbook case, where the one lot is not in question.
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
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
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
  | {
      kind: "stamp";
      stampId: string;
      /** The pick in one line — what the box falls back to, and what the photo uploader names. */
      label: string;
      /** The pick's numbers as chips (#1525), the main catalogue's highlighted and first, with its
       * name beside them. Absent on a route that only knows the line, which the box then prints. */
      chips?: CatalogChipLabel[];
      name?: string | null;
    }
  | { kind: "checklist"; checklistId: string; label: string; requiredCount: number };

/** A stamp off the picker as the selection the condition step names it by — its one-line label,
 * and its numbers as chips (#1525). */
export function pickedSelection(picked: PickedStamp): PendingSelection {
  return {
    kind: "stamp",
    stampId: picked.stampId,
    label: pickedStampText(picked),
    chips: pickedChipLabels(picked),
    name: picked.name,
  };
}

/** One stamp on a piece carrying several (#750), as the summary box lists it — its numbers as chips
 * (#1525), its name, and what else the line says (the quantity, the component's format). */
export interface CarriedStampLine {
  chips: CatalogChipLabel[];
  name: string | null;
  detail: string | null;
}

/** A stamp named the way the summary box names one (#1525): its catalogue-number chips, then its
 * name — or the name alone, or the placeholder, for a stamp with no number. */
function StampChipsLine({
  chips,
  name,
  detail,
}: {
  chips: CatalogChipLabel[];
  name: string | null;
  detail?: string | null;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.3rem",
        verticalAlign: "middle",
      }}
    >
      <CatalogNumberChips chips={chips} />
      {(name || chips.length === 0) && (
        <span style={{ color: "var(--color-text-primary)" }}>{name || "(unnamed stamp)"}</span>
      )}
      {detail && <span>{detail}</span>}
    </span>
  );
}

export /** The three disposition flags rendered as instant-toggle chips (#160). Shared by the per-copy
 * inline editor and the intake dialog: `values` holds the current on/off of each flag and
 * `onToggle` flips one. Purely presentational — the caller decides whether a toggle persists
 * immediately (per-copy) or updates form state (intake). */
function DispositionChips({
  values,
  onToggle,
  disabled,
  tabIndex,
}: {
  values: { inCollection: boolean; forSale: boolean; forTrade: boolean };
  onToggle: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
  disabled?: boolean;
  /** -1 on a run row (#1583), where nothing sits in Tab between two catalogue values (#1223). */
  tabIndex?: number;
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
            tabIndex={tabIndex}
            onClick={() => onToggle(d.key, !on)}
            style={{
              ...CHIP,
              cursor: disabled ? "default" : "pointer",
              fontWeight: on ? 600 : 500,
              ...dispositionToggleColors(d.key, on),
            }}
          >
            <Icon name={on ? "check" : "add"} size="xs" /> {d.label}
          </button>
        );
      })}
    </span>
  );
}

/** Where a seeded field's value came from (#1550), beside its label: *marked on the tile* or *last
 * used* — the collector must be able to tell the two apart. Nothing once the field has been changed. */
export function SeedOriginNote({ origin }: { origin: SeedOrigin | null }) {
  if (!origin) return null;
  return (
    <span
      style={{
        marginLeft: "0.375rem",
        fontSize: "0.75rem",
        fontWeight: 400,
        color: origin === "marked" ? "var(--color-accent)" : "var(--color-text-muted)",
      }}
    >
      {SEED_ORIGIN_LABEL[origin]}
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
  scanning: ScanningSetup;
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
  /**
   * The stamps on the piece, worded, when it has been described as carrying several (#750) —
   * absent for a piece that is simply the stamp picked. Drawn in the summary box that names the
   * pick, since they are what the pick now describes.
   */
  carriedStamps?: CarriedStampLine[];
  /** Open the stamp editor over this step (#750). Present only in the scan-tile chain, where the
   * piece is on screen to be read: nowhere else is there a single piece of paper being described. */
  onEditStamps?: () => void;
  /** The copy a re-identified scan tile already became (#1207) — the piece on screen, so left out
   * of the held copies it is compared with. Absent on every intake that creates a copy. */
  correctedCopyId?: string;
  /**
   * Price an **umbrella's** variants in place of its one catalogue value (#1317, #1337) — the
   * scan-tile chain only. The catalogue page open at an umbrella prices each variant rather than the
   * umbrella, so one field for the umbrella's own figure is the wrong question there; the step
   * draws a price field per variant instead, narrowed to its condition, certificate and format
   * (#633) and started at the umbrella (#679), with #618's full grid a press away. A stamp without
   * variants keeps the field either way.
   */
  priceVariantsInGrid?: boolean;
  /**
   * Seed the condition and certificate from the **marks** the pieces carry (#1550) — the scan-tile
   * chain, except a correction, which opens on what the copy is. Each seeded field then says where
   * its value came from (*marked on the tile*, *last used*), and where several tiles are identified
   * as one stamp and their marks do not all agree, the marked ones keep their marks and the step
   * says how many.
   */
  seedFromMarks?: boolean;
  /**
   * Ask for the new copies' **faults** (#1558) — the scan-tile chain's identification, where the
   * piece is in hand. Opened on the faults marked on the tiles (with `seedFromMarks`) and otherwise
   * empty: never the last used, a fault belonging to one piece. Not on a correction, which changes
   * what the copy is identified as; its faults are the copy's own to edit.
   */
  askFaults?: boolean;
  /**
   * Ask for the new copies' **tags** (#1599) — the scan-tile chain's identification, as the faults
   * are. Opened on the tags marked on every tile (with `seedFromMarks`) and otherwise empty: never the
   * last used (settled with the collector). Every copy takes the field's tags; a tile marked with
   * more keeps those as well. Not on a correction, where the copy's tags are the copy's own to edit.
   */
  askTags?: boolean;
  /**
   * Offer to make the tile's front the **stamp's** photo (#1340) — the scan-tile chain only, where a
   * piece is in hand to be compared with the stamp's current picture. On by default when the stamp
   * has no photo (#149's seed, made visible) and off when it has one; the answer is sent as
   * `stampPhotoTileId` (`tile-stamp-photo.ts`).
   */
  offerStampPhoto?: boolean;
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
  scanning,
  copyCount,
  prefill,
  lotChoice,
  carriedStamps,
  onEditStamps,
  correctedCopyId,
  priceVariantsInGrid,
  offerStampPhoto,
  seedFromMarks,
  askFaults,
  askTags,
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
  //
  // Ahead of both, on the scan-tile chain, the tiles' own **marks** (#1550): given with the card in
  // hand, they are the better answer than another tile's or the last one. `seedField` is the rule —
  // every tile marked alike opens on the mark; otherwise the field opens as before and the marked
  // tiles keep theirs. Decided once, as the step opens: a mark only seeds the dialog.
  const [seeds] = useState(() => {
    const fallbackOrigin: SeedOrigin = prefill ? "repeated" : "last-used";
    const lastCondition = prefill ? prefill.conditionId : readLast(LS_LAST_CONDITION, collectionId);
    const lastCert = prefill ? prefill.certificateStatusId : readLast(LS_LAST_CERT, collectionId);
    const fallback = {
      condition: {
        value: conditions.some((c) => c.id === lastCondition) ? lastCondition : "",
        origin: fallbackOrigin,
      },
      certificate: {
        value: certificateStatuses.some((c) => c.id === lastCert) ? lastCert : "",
        origin: fallbackOrigin,
      },
    };
    // Faults have no fallback at all (#1558): the marks, or nothing.
    const noFaults: FaultSeed = { faultIds: [], origin: null, keepers: [] };
    // Nor do tags (#1599): every identification starts with none but what is marked.
    const noTags: TagSeed = { tagIds: [], origin: null, keepers: [] };
    if (!seedFromMarks || !pieces) {
      return {
        condition: { value: fallback.condition.value, origin: null, keepers: [] },
        certificate: { value: fallback.certificate.value, origin: null, keepers: [] },
        faults: noFaults,
        tags: noTags,
      };
    }
    const known = (id: string | null | undefined, list: readonly { id: string }[]) =>
      id && list.some((x) => x.id === id) ? id : null;
    return {
      condition: seedField(
        pieces.map((p) => ({ tileId: p.tileId, marked: known(p.mark?.conditionId, conditions) })),
        fallback.condition
      ),
      certificate: seedField(
        pieces.map((p) => ({
          tileId: p.tileId,
          marked: known(p.mark?.certificateStatusId, certificateStatuses),
        })),
        fallback.certificate
      ),
      faults: askFaults
        ? seedFaults(pieces.map((p) => ({ tileId: p.tileId, faultIds: markFaultIds(p.mark) })))
        : noFaults,
      tags: askTags
        ? seedTags(pieces.map((p) => ({ tileId: p.tileId, tagIds: markTagIds(p.mark) })))
        : noTags,
    };
  });
  const [conditionId, setConditionId] = useState(seeds.condition.value);
  const [certId, setCertId] = useState(seeds.certificate.value);
  /** Where each seeded value came from, said beside its field (#1550) — until the field is changed,
   * when the value is the collector's own answer and the label goes. */
  const [conditionOrigin, setConditionOrigin] = useState(seeds.condition.origin);
  const [certOrigin, setCertOrigin] = useState(seeds.certificate.origin);
  const [faultsOrigin, setFaultsOrigin] = useState(seeds.faults.origin);
  // The dictionary the field names its chips from — the field is drawn once it is here, so the faults
  // it opens on are named rather than blank.
  const { data: faultDictionary } = useCollectionFaults(collectionId);
  const seededFaults: FaultEntry[] = seeds.faults.faultIds.flatMap((id) => {
    const fault = faultDictionary?.find((f) => f.id === id);
    return fault ? [{ id: fault.id, name: fault.name }] : [];
  });
  const [tagsOrigin, setTagsOrigin] = useState(seeds.tags.origin);
  // The tags the field opens on (#1599), named and coloured from the dictionary once it is here.
  const { data: tagDictionary } = useCollectionTags(collectionId);
  const seededTags: TagEntry[] = seeds.tags.tagIds.flatMap((id) => {
    const tag = tagDictionary?.find((t) => t.id === id);
    return tag ? [{ id: tag.id, name: tag.name, color: tag.color }] : [];
  });
  /** The tiles marked with tags beyond the field's (#1599) — they keep them **as well**, so this is
   * said apart from the keepers above, whose answers replace the shared ones. */
  const tagKeepers = seeds.tags.keepers.length;
  /** The tiles keeping their own marks, in words — *3 tiles keep their marked MNG*. */
  const keepersSaid = [
    ...keeperGroups(seeds.condition.keepers).map(({ value, count }) => {
      const abbr = conditions.find((c) => c.id === value)?.abbreviation ?? "condition";
      return `${count} ${count === 1 ? "tile keeps its" : "tiles keep their"} marked ${abbr}`;
    }),
    ...keeperGroups(seeds.certificate.keepers).map(({ value, count }) => {
      const abbr = certificateStatuses.find((c) => c.id === value)?.abbreviation ?? "certificate";
      return `${count} ${count === 1 ? "tile keeps its" : "tiles keep their"} marked ${abbr}`;
    }),
    ...(seeds.faults.keepers.length > 0
      ? [
          `${seeds.faults.keepers.length} ${seeds.faults.keepers.length === 1 ? "tile keeps its" : "tiles keep their"} marked faults`,
        ]
      : []),
  ];
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

  // The stamp's picture (#1340). The answer is held against the stamp it was given for, so picking
  // another stamp — at the stamp editor, or Back and a new pick — asks afresh from its own default.
  const photoStampId =
    offerStampPhoto && selection.kind === "stamp" ? selection.stampId : null;
  const { data: stampPhotos } = useStampPhotos(collectionId, photoStampId);
  const [stampPhotoChoice, setStampPhotoChoice] = useState<StampPhotoChoice | null>(null);
  const firstFrontTileId =
    pieces?.find((p) => pieceFrontPhotoId(p) !== null)?.tileId ?? null;
  const stampPhoto =
    photoStampId && firstFrontTileId
      ? effectiveStampPhotoChoice({
          stampId: photoStampId,
          choice: stampPhotoChoice,
          stampPhotoCount: stampPhotos?.length,
          defaultTileId: firstFrontTileId,
        })
      : null;
  // A single only (#346): a pair's picture misrepresents the stamp.
  const stampPhotoOffered = formatId === "";

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

  // The comparison with the copies already held (#1207), opened from the holdings line. It opens
  // **over** this step rather than replacing it, so every answer here is as it was left on closing.
  // The photos added above are its picture of the piece when there is no tile — state rather than a
  // ref like the change-set, because the comparison draws them.
  // Open with the copy to land on (#1621), `null` for the whole list, `false` closed.
  const [comparing, setComparing] = useState<string | null | false>(false);
  const [photoPreviews, setPhotoPreviews] = useState<PhotoEditorPreview[]>([]);

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
  //
  // Drawn as the condition's and the certificate's own chips (#1657), the colours the collector
  // knows them by on every list (#728); the words are kept for the inputs' accessible names.
  const subjectCondition = conditions.find((c) => c.id === conditionId);
  const subjectCertificate = certificateStatuses.find((c) => c.id === certId);
  const subjectLabel = [subjectCondition?.abbreviation, subjectCertificate?.abbreviation]
    .filter(Boolean)
    .join(" · ");
  const subjectChips = subjectCondition ? (
    <ConditionCertificateChips
      collectionId={collectionId}
      condition={subjectCondition}
      certificate={subjectCertificate}
    />
  ) : null;
  // …and what an umbrella's variant grid is narrowed to (#1317), which **does** carry the format:
  // the grid fixes all three axes of the piece in hand, where the one figure above lands on the
  // single whatever the format. The format has no colour of its own, so it stays a word.
  const subjectFormat = formats.find((f) => f.id === formatId)?.abbreviation;
  const variantGridLabel = [subjectLabel, subjectFormat].filter(Boolean).join(" · ");
  const variantGridSubject = (
    <>
      {subjectChips}
      {subjectFormat && ` · ${subjectFormat}`}
    </>
  );

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
    // The tiles keeping their own marks (#1550) — exactly what the step said, so the write creates
    // what was read here rather than re-reading the marks behind it.
    const own = keeperAnswers(seeds.condition, seeds.certificate, seeds.faults, seeds.tags);
    if (own.length > 0) fd.set("tileAnswers", JSON.stringify(own));
    fd.set("inCollection", String(disposition.inCollection));
    fd.set("forSale", String(disposition.forSale));
    fd.set("forTrade", String(disposition.forTrade));
    if (photos) {
      fd.set("photoChangeSet", JSON.stringify(photoValueRef.current.changeSet));
    }
    if (offerStampPhoto) {
      const value = stampPhoto
        ? stampPhotoFormValue({ offered: stampPhotoOffered, on: stampPhoto.on, tileId: stampPhoto.tileId })
        : // No piece with a front: nothing to give the stamp, and the seed would find nothing either.
          "";
      if (value !== undefined) fd.set("stampPhotoTileId", value);
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
    selection.kind === "checklist" ? (
      `Whole set: ${selection.label} — ${count} stamp${count === 1 ? "" : "s"}`
    ) : selection.chips && selection.chips.length > 0 ? (
      // The numbers are what the piece is checked against, so they are the chips every stamp row
      // draws (#1525) rather than a line of small text — the main catalogue's leading, highlighted.
      <StampChipsLine chips={selection.chips} name={selection.name ?? null} />
    ) : (
      selection.label
    );
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
      <IdentifiedPieceAside collectionId={collectionId} pieces={pieces} scanning={scanning} />
    ) : undefined;

  return (
    <DialogShell
      title="Set condition"
      onClose={onClose}
      // The same size as the tile dialog one step back (#1598), which is where this picture was last
      // seen: the window less the shell's margin, so going from one step to the other does not
      // resize anything (#1613). The form keeps a fixed column — a quarter wider than the 40rem it
      // had, so faults and tags fit side by side (#1640) — and the viewer takes the rest, so *Fit*
      // fills the added room; on a small window the viewer gives way first, down to a floor under
      // which the form starts to give way too.
      maxWidth={pieceAside ? DIALOG_MAX_WIDTH : "36rem"}
      height={pieceAside ? DIALOG_MAX_HEIGHT : undefined}
      aside={pieceAside}
      asideWidth="max(16rem, 100% - 50rem)"
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
            {/* The stamps on the piece (#750), when it carries more than the one picked. The chip
                and its sentence are the Copies list's own (#748): a piece carrying several stamps
                is a copy of none of them, and this is the last place to see that before it is. */}
            {carriedStamps && carriedStamps.length > 0 && (
              <div style={{ marginTop: "0.375rem" }}>
                <div style={{ color: "var(--color-text-primary)" }}>
                  <strong>Several stamps on this piece</strong> — one copy, counted towards none of
                  them:
                </div>
                <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                  {carriedStamps.map((line, i) => (
                    <li key={i} style={{ marginTop: "0.125rem" }}>
                      <StampChipsLine chips={line.chips} name={line.name} detail={line.detail} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {onEditStamps && selection.kind === "stamp" && (
              <div style={{ marginTop: "0.375rem" }}>
                <button
                  type="button"
                  onClick={onEditStamps}
                  disabled={isPending}
                  style={{
                    padding: 0,
                    border: "none",
                    background: "none",
                    font: "inherit",
                    color: "var(--color-accent)",
                    cursor: isPending ? "not-allowed" : "pointer",
                  }}
                >
                  {carriedStamps && carriedStamps.length > 0
                    ? "Change the stamps on this piece…"
                    : "Another stamp on this piece…"}
                </button>
              </div>
            )}
            {/* What is about to exist, before anything is created (#596). It sits inside the box
                that names the pick because it is a fact about *this* answer — one stamp, one
                condition, one certificate, one format, one lot, and this many pieces of paper.
                Silent for the ordinary single tile, which needs no count to read as one copy. */}
            {copyCount != null && copyCount > 1 && (
              <div style={{ marginTop: "0.25rem", color: "var(--color-text-primary)" }}>
                <strong>{copyCount} copies</strong> will be created — one per tile, each keeping its
                own pictures.
                {/* The tiles marked before identifying keep their marks (#1550); the answers below
                    apply to the rest. Said before anything is created, as the count is. */}
                {keepersSaid.length > 0 && (
                  <>
                    {" "}
                    <strong>{keepersSaid.join(", ")}</strong>; the answers below apply to the rest.
                  </>
                )}
                {tagKeepers > 0 && (
                  <>
                    {" "}
                    <strong>
                      {tagKeepers} {tagKeepers === 1 ? "tile keeps the tags" : "tiles keep the tags"}{" "}
                      marked on {tagKeepers === 1 ? "it" : "them"}
                    </strong>{" "}
                    besides the tags below.
                  </>
                )}
              </div>
            )}
            {/* What the collection already holds of this stamp, and what it is still after (#562)
                — inside the box that already names the pick, so the line reads as a fact about it
                rather than as a second heading. Single-stamp intake only: a whole-checklist intake
                fans out across many stamps and has no one stamp to report on, exactly as photos
                below are single-stamp only (#148). */}
            {/* Not for a piece carrying several (#750): it will count towards none of them, so what
                the collection holds of the first is not a fact about this intake. */}
            {selection.kind === "stamp" && !(carriedStamps && carriedStamps.length > 0) && (
              <IntakeHoldingsLine
                collectionId={collectionId}
                stampId={selection.stampId}
                conditions={conditions}
                conditionId={conditionId}
                certificateStatusId={certId}
                formatId={formatId}
                onCompare={() => setComparing(null)}
              />
            )}
            {/* The in-collection copies themselves (#1621), since whether the piece should take one
                of their places is judged by looking. Under the line, on the line's own terms. */}
            {selection.kind === "stamp" && !(carriedStamps && carriedStamps.length > 0) && (
              <HeldCopyThumbs
                collectionId={collectionId}
                stampId={selection.stampId}
                conditions={conditions}
                certificateStatuses={certificateStatuses}
                excludeItemId={correctedCopyId ?? null}
                onOpen={setComparing}
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
              <LabelWithError htmlFor="intake-condition">
                Condition
                <SeedOriginNote origin={conditionOrigin} />
              </LabelWithError>
              <select
                id="intake-condition"
                name="conditionId"
                value={conditionId}
                onChange={(e) => {
                  setConditionId(e.target.value);
                  setConditionOrigin(null);
                }}
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
              <LabelWithError htmlFor="intake-cert">
                Certificate
                <SeedOriginNote origin={certOrigin} />
              </LabelWithError>
              <select
                id="intake-cert"
                name="certificateStatusId"
                value={certId}
                onChange={(e) => {
                  setCertId(e.target.value);
                  setCertOrigin(null);
                }}
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

          {/* The copy's faults (#1558) and tags (#1599), with the piece in hand: straight after
              condition, certificate and format, because they describe the piece and are worked out
              with it, while the catalogue value below is looked up afterwards (#1593). Side by side,
              each half the row (#1640): both are short lists of chips, and one above the other ran
              the step long enough to scroll for *Location* and the buttons. Each grows downwards as
              chips are added, its hint under it. Faults open on the faults marked on the tiles, or
              empty — never the last tile's, since a fault belongs to one piece; tags on the tags
              marked on the tiles, or empty — never the last used. *To check*, *for expertising* are
              often known while identifying, and a new name becomes a tag when the step is saved, as
              on a copy. */}
          {(askFaults || askTags) && (
            <div
              style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", marginTop: "0.75rem" }}
            >
              {askFaults && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <LabelWithError htmlFor="intake-faults">
                    Faults (optional)
                    <SeedOriginNote origin={faultsOrigin} />
                  </LabelWithError>
                  {faultDictionary ? (
                    <FaultEntryField
                      collectionId={collectionId}
                      inputId="intake-faults"
                      initialFaults={seededFaults}
                      disabled={isPending}
                      onChange={(entries) => {
                        const ids = entries.map((e) => e.id ?? `new:${e.name}`);
                        if (!sameFaults(ids, seeds.faults.faultIds)) setFaultsOrigin(null);
                      }}
                    />
                  ) : (
                    <div style={{ ...INPUT_STYLE, color: "var(--color-text-muted)" }}>Loading…</div>
                  )}
                </div>
              )}
              {askTags && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <LabelWithError htmlFor="intake-tags">
                    Tags (optional)
                    <SeedOriginNote origin={tagsOrigin} />
                  </LabelWithError>
                  {tagDictionary ? (
                    <TagEntryField
                      collectionId={collectionId}
                      name="copyTags"
                      inputId="intake-tags"
                      initialTags={seededTags}
                      disabled={isPending}
                      onChange={(entries) => {
                        if (!sameFaults(entries.map(tagEntryKey), seeds.tags.tagIds)) setTagsOrigin(null);
                      }}
                    />
                  ) : (
                    <div style={{ ...INPUT_STYLE, color: "var(--color-text-muted)" }}>Loading…</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* The catalogue value, while the paper catalogue is still open at this stamp (#593).
              Under the row it is keyed on, with only the faults and tags between (#1593, #1640) — a
              catalogue price belongs to a condition × certificate, and its input keeps that row's
              columns so it still lines up under the Condition control it follows. The format picked
              beside it is *not* one of those answers: the figure always lands on the single, with a
              multiple's value derived from it.
              One field, the primary catalogue only: the full quick-price dialog stays for the
              multi-vendor case, and a row of vendor inputs here would bury the step. Single-stamp
              intake only, the rule photos and the format field follow — one figure cannot be the
              catalogue value of a whole set's stamps. */}
          {selection.kind === "stamp" && (
            <IntakeCatalogValueField
              stampId={selection.stampId}
              conditionId={conditionId}
              certificateStatusId={certId}
              subject={subjectChips}
              // The condition row above is two controls, or three once the collection defines
              // formats — the same count the row itself is built from, so the two cannot drift.
              columns={singleStamp && formats.length > 0 ? 3 : 2}
              disabled={isPending || savingPrice}
              onChange={handleCatalogValueChange}
              variantGrid={
                priceVariantsInGrid
                  ? {
                      formatId,
                      subjectLabel: variantGridLabel,
                      subject: variantGridSubject,
                      collectionId,
                    }
                  : undefined
              }
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
                  <TextInput
                    id="intake-locationRef"
                    name="locationRef"
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

          {/* The stamp's photo (#1340): beside the disposition because it is one more thing this
              identification does, and after the copy's own answers because it is about the stamp
              rather than the copy. */}
          {photoStampId && stampPhoto && pieces && (
            <TileStampPhotoField
              collectionId={collectionId}
              pieces={pieces}
              stampPhotos={stampPhotos}
              offered={stampPhotoOffered}
              on={stampPhoto.on}
              tileId={stampPhoto.tileId}
              disabled={isPending}
              onChange={(next) => setStampPhotoChoice({ stampId: photoStampId, ...next })}
            />
          )}

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
                onPreviewsChange={setPhotoPreviews}
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
      {/* Portalled to the body rather than drawn inside the shell: the shell's panel is transformed,
          which would make it the containing block of the comparison's fixed overlay and crop it to
          this dialog — the lightbox's own reason for a portal. */}
      {comparing !== false &&
        selection.kind === "stamp" &&
        createPortal(
          <HeldCopiesCompareDialog
            collectionId={collectionId}
            stampId={selection.stampId}
            stampLabel={selection.label}
            conditions={conditions}
            certificateStatuses={certificateStatuses}
            excludeItemId={correctedCopyId ?? null}
            focusItemId={comparing}
            pieces={pieces}
            previews={photos ? photoPreviews : []}
            scanning={scanning}
            onClose={() => setComparing(false)}
          />,
          document.body
        )}
    </DialogShell>
  );
}
