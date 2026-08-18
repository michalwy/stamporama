"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/app/icons";
import {
  DialogActions,
  DialogFooter,
  DialogLinkButton,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import {
  addTileCandidateAction,
  assignTileAction,
  discardTilesAction,
  noteTileAction,
  parkTilesAction,
  removeTileCandidateAction,
  returnTilesToQueueAction,
} from "@/app/actions/scans";
import type { CollectionAreaData } from "@/lib/areas";
import { formatItemNo } from "@/lib/item-number";
import type { ItemListItem } from "@/lib/items";
import type { ScanTileData } from "@/lib/scan-sheets";
import type { TileSideView } from "@/lib/scan-tile-view";
import {
  candidateLabel,
  candidateShortLabel,
  mergeTileCandidates,
  sharedVariantParent,
  type MergedTileCandidate,
  type TileCandidate,
} from "@/lib/tile-candidates";
import { tilePhotoRoles, describeFreeSlots, type TilePhotoRole } from "@/lib/tile-photo-roles";
import { StampPickerBrowser } from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { useIssueMembers } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import {
  StampDetailLine,
  StampTitle,
  type VendorMap,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { IdentifiedPieceAside, type IdentifiedPiece } from "./tile-zoom-view";
import { usePurchaseCopiesInfinite, type LotCopiesParams } from "./use-lot-copies-query";

/**
 * A tile — or a **run of them** — and what can become of it (#567) — three ends, and since #597 one
 * waiting room.
 *
 * **One dialog for one piece and for fifteen**, which is the correction #596 needed. Ticking tiles
 * on the strip offered exactly one thing, *identify them as one stamp*, and led straight into the
 * picker; so a run could be identified together but never discarded or set aside together, although
 * a card of junk and a run of one doubtful variant are precisely the cases a selection is made for.
 * Adding a button per outcome to the bar would have been a second, poorer statement of the vocabulary
 * this dialog already is — and the bar cannot show the pictures, which are what the answer is read
 * off. So the selection opens **here**, where the outcomes live, with the pieces beside them
 * (#592's aside, one piece being #585's viewer and several a grid with a loupe).
 *
 * What a run cannot do is what is genuinely about one piece: **assigning** to an existing copy —
 * front and back are singleton slots, so one copy takes one tile — and the panels of a **settled**
 * tile, which cannot be ticked in the first place. Everything else is the same control with a count
 * on it.
 *
 * **The tile is the dialog** (#585), not a thumbnail above the controls: a picture large enough to
 * be zoomed and panned, with the outcome beside it. That is the dialog's entire reason for
 * existing — the intake step that follows never shows the images, and a crop that took half a stamp
 * or a piece nobody could identify is only visible at this size. Since #585 it answers the harder
 * question too: at 1200 dpi the perforations, the watermark and the plate flaw are already in the
 * tile's own photo, so telling two variants apart is a pass at the keyboard rather than one under a
 * loupe. `tile-zoom-view.tsx` is the picture and `scan-viewport.ts` all of its arithmetic — this
 * file only decides what is *asked* about the tile.
 *
 * So the dialog **opens on an outcome, never on a menu of them**, and which one is *derived from
 * whether there is anything **this tile** can be assigned to* — not from where the order came from.
 * The candidate list is copies holding none of the roles the tile carries, so a non-empty one means
 * assigning is genuinely available: every line of a freshly settled auction sale, the handful of
 * hand-entered copies on a stockbook order, and nothing at all once they have been photographed.
 * That is right in both places the `fromAuction` flag was wrong — an auction order whose lines are
 * already photographed goes straight to identify, and a stockbook order with two hand-entered
 * copies offers them. The list is empty more often than a looser one would be, and lands on
 * identify more often as a result; that is the correct answer, not a reason to loosen it.
 *
 * Since #586 the list is the whole **order's** copies rather than one lot's, which is the point of
 * that move rather than a side effect: at a settlement the copies waiting for photographs are every
 * line of every won lot, they arrive in one envelope, and they are scanned on one card. Assigning
 * therefore asks nothing about lots — the copy already has one. Only *identify as a new copy* does,
 * and that question is asked one screen on, where every other intake answer is.
 *
 * The other two answers sit in the footer, one click from wherever it opened. A chooser standing in
 * front of them would be a screen whose whole content is three buttons, and a card of forty would
 * mean forty of them showing nothing.
 *
 * The candidate query is keyed by the order **and the slots asked for**, so a card of like tiles —
 * the ordinary case — is one fetch, served from cache for every tile after the first. The dialog
 * therefore **settles once and never jumps**: on the first tile it waits for the answer rather than
 * opening on identify and switching under the collector's hand when the list arrives.
 *
 * **Discard acts immediately**, with no note asked for. On a parcel full of junk it is the frequent
 * answer, and it is safe to make it cheap precisely because it is reversible — *Put back in the
 * queue* is right there, and the note can be written afterwards on the rare tile that earns one.
 *
 * **Set aside to check** (#597) sits beside it and says the opposite — a discard became nothing, a
 * parked piece is still going to become a copy — so a parked tile keeps every outcome this dialog
 * offers a waiting one, and what it gains is a note saying what to look for and a way back. It is
 * the one action here that **asks a question first**, and the reason is that its note is the
 * ordinary case rather than the rare one: the field opens in the footer where the button was, under
 * the cursor that just pressed it. Enter sets the tile aside, Escape abandons the question and not
 * the tile, and an empty field is a complete answer.
 *
 * A parked tile also carries a **shortlist** (#607) — what the piece could be — added from the very
 * picker the identification uses, offered on the way back as one-press choices, and never standing
 * in front of that picker: a narrowing can be wrong, so *Identify as a new copy* stays exactly where
 * it is for every tile. See {@link CandidateShortlist}, and `tile-candidates.ts` for the one case in
 * which a shortlist is the wrong answer altogether.
 *
 * **A consumed tile can be identified again from here**, which is the one thing #584 left out.
 * Settling a tile here rather than navigating to its copy was right, but it left the *wrong* answer
 * with nowhere to go: the mis-identification is discovered on this card — the piece two squares over
 * settles the shade, the gauge says 14 rather than 14½ — and acting on it meant leaving the pass,
 * finding that one copy among a parcel's hundreds in the copies list, and editing it there. On a
 * card of forty that costs as much as the mistake did.
 *
 * So *Identify again* hands upward exactly as *Identify as a new copy* does, and the order panel
 * runs **the whole chain** over it — picker, the issue and stamp dialogs it can open, then the
 * condition step, with the piece on screen throughout (#592). Not a stamp-only re-point, which was
 * the tempting shortcut and the wrong one: being wrong about which stamp this is usually means being
 * wrong about what was read *off* it, so a correction that could not touch the condition would send
 * the collector to the copies list for the other half of the same mistake — the trip this exists to
 * remove. What the chain does differently is only its ending: `reidentifyTileCopy` re-answers the
 * copy that exists instead of creating one, so the number, the lot and the images stay put and a
 * changed stamp lands in the copy's refinement history as it does from anywhere else.
 *
 * **Every state opens this dialog, and none of them navigates on the click itself** (#584). A
 * consumed tile used to be an `<a>` straight to its copy, which left the tile itself impossible to
 * inspect — which batch, which position, what it became — and threw the collector out of the
 * purchase mid-pass, when a card of forty is being worked in one sitting and getting back is most
 * expensive. So it settles here like a discard does, showing the copy it became, and *Open copy* is
 * a deliberate action in the footer: leaving is a choice, never a side effect of looking at a tile.
 */

/** A stamp this dialog hands upward to be identified as, without the picker having been opened for
 * it — a candidate pressed, or the parent offered in its place (#607). The two labels are what the
 * chain downstream would otherwise have taken from `PickedStamp`: the long one names the pick in the
 * condition step, the short one is what *Same as the last* has a button's width to say. */
export interface TileStampPick {
  stampId: string;
  label: string;
  shortLabel: string;
}

/**
 * A tile this dialog is about, with **the sides already worked out** (#592).
 *
 * `tileSideViews` is answered in `purchase-scans-card.tsx`, where the batch a tile came from — and
 * therefore whether its scan has been swept (#578) — is in hand. That matters more for a selection
 * than for one tile: a run can cross two cards of a parcel, so the sides cannot be derived here from
 * one pair of sheets at all.
 */
export interface SelectedTile {
  tile: ScanTileData;
  sides: TileSideView[];
}

interface Props {
  collectionId: string;
  /** The area tree the stamp picker needs (#607) — the shortlist is built from the **same** picker
   * the identification uses, opened over this dialog rather than in place of it, so a candidate and
   * an identification are one act of choosing a stamp and not two vocabularies. */
  areas: CollectionAreaData[];
  /** What this collection scans at (#598) — the scale the viewer's ruler and perforation gauge
   * convert with, prefilled into the measuring bar and correctable there for this sitting. */
  scanDpi: number;
  purchaseId: string;
  /** The tiles this dialog is about, in card order: one opened from the strip, or the run ticked on
   * it. Never empty. A run holds only tiles that are still to be identified, since those are the
   * only ones that get a tick box (`scan-tile-selection.ts`). */
  tiles: SelectedTile[];
  /** Whether **any** lot of this order is still open (#586). A closed lot takes no new copies (its
   * pool has been split across the copies it had), but a photograph is not money — assigning and
   * discarding stay. Which lot the new copy goes onto is asked at the condition step, so all this
   * decides is whether creating one is possible at all. */
  canIdentify: boolean;
  /** Whether this order was settled from a won auction sale. Used **only to word** the assign
   * list's explanation — that those copies are the lines that were described in order to bid.
   * It decides nothing, which was always its real job. */
  fromAuction: boolean;
  /** Where the copy a consumed tile became lives (#584). Null for every other state, and for a
   * consumed tile whose copy has since been deleted — there is nothing to open. */
  copyHref: string | null;
  /**
   * *Identify as a new copy*, carrying **the sides this dialog is already showing** (#592). The
   * chain that follows — picker, sometimes a create-issue and a create-stamp dialog, then the
   * condition step — keeps the piece on screen throughout, and `tileSideViews` has already answered
   * which sides there are and which still have a retained card behind them. Handing that answer on
   * rather than a tile id keeps it computed once, where the batch's sheets are in hand.
   */
  onIdentifyNew: (pieces: IdentifiedPiece[]) => void;
  /**
   * *Same as the last* (#595): identify this tile the way the previous one of this sitting was
   * identified. Null until something has been, so the action is never offered with nothing to
   * repeat — and it carries `summary`, the stamp and condition it will apply, because a button that
   * does not name what it repeats is a blind one.
   *
   * It **skips the picker and stops at the condition step's ordinary confirm**, which is the whole
   * of its saving: the stamp is the one answer the intake step does not remember, and everything
   * around it already comes back on its own. One extra press buys sight of what is about to be
   * created, and a consumed tile has no undo short of deleting the copy.
   */
  repeatLast?: { summary: string; onRepeat: (pieces: IdentifiedPiece[]) => void } | null;
  /**
   * *Identify as this stamp* with the picker skipped (#607) — a candidate off the shortlist, or the
   * parent offered in place of a shortlist that is all variants of one node.
   *
   * The same handover `onIdentifyNew` makes, with the picker's answer already given: picking a
   * candidate identifies the tile **exactly as picking that stamp from the picker would**, stopping
   * at the condition step's ordinary confirm like every other route into it. Nothing here creates a
   * copy in one press — a consumed tile has no undo short of deleting the copy.
   */
  onIdentifyAs: (pick: TileStampPick, pieces: IdentifiedPiece[]) => void;
  /**
   * *Identify again* — the same handover `onIdentifyNew` makes, for a tile that has **already**
   * become a copy.
   *
   * One piece, never a run: a settled tile takes no tick box, so a correction is always about the
   * single tile this dialog is showing. It carries the copy as well as the piece, because the chain
   * it opens has to start from **what the copy is now** — the condition step prefills from it, and a
   * correction that opened on the collection's remembered defaults would quietly re-answer every
   * field that was never wrong.
   */
  onReidentify: (piece: IdentifiedPiece, copy: NonNullable<ScanTileData["item"]>) => void;
  /**
   * An outcome was written. `touchedCopy` says whether a **copy** changed, which decides what has to
   * be re-read: assigning gives a copy the tile's photos, so the copies list is stale; discarding
   * touches no copy at all, so invalidating them would be re-fetching a lot's whole copy list to
   * learn that nothing about it moved.
   */
  onDone: (touchedCopy: boolean) => void;
  /**
   * A write landed and the dialog **stays open** (#597) — editing the note on a tile that is already
   * parked.
   *
   * That note is not an outcome: the tile is still to be identified and this dialog is still where
   * it would be, so closing on a saved sentence would put the collector back where they started for
   * nothing. Parking itself does close, its question having been answered at the button.
   */
  onChanged: (touchedCopy: boolean) => void;
  onClose: () => void;
}

/** The outcome the dialog is *showing*. Discard is not one of them — it is a button that acts. */
type Mode = "identify" | "assign";

/**
 * How long the candidate list stays fresh, so tile after tile opens from cache instead of pausing
 * on a refetch the latch below would wait for.
 *
 * Short on purpose. Every write **on this screen** invalidates the namespace and so beats this
 * outright (`isInvalidated` short-circuits ahead of `staleTime`) — intake, attach, assign, removing
 * a copy. What does not reach it is a photo added to one of these copies from the *Copies* screen,
 * since nothing there invalidates `lot-copies`. Half a minute keeps a card's tiles instant while
 * bounding that window to something shorter than walking between two screens; the cost of being
 * wrong is one candidate offered that the write then refuses by name, or one missing that a reopen
 * brings back.
 */
const ASSIGN_LIST_STALE_MS = 30 * 1000;

/**
 * The copies a tile could be assigned to: this **order's**, holding **none of the roles this tile
 * carries**.
 *
 * Derived from the tile rather than restated, and it is the same question `assignTileToCopy` asks
 * before it refuses (`tile-photo-roles.ts` owns the comparison). A list that offers what the write
 * refuses is the defect: asking the weaker *"has any free slot"* offered a front-only tile copies
 * that merely lacked a back, and picking one failed.
 *
 * Not `no-photos` either, which is a different and wrong set — a copy with a back and no front can
 * take a front-only tile, and `no-photos` would hide it.
 *
 * The params object is what the query is keyed by, so tiles needing the same slots — a whole card of
 * front-only tiles, the ordinary case — share one fetch, and a tile needing different slots gets its
 * own list rather than a wrongly cached one.
 */
function assignParams(tile: ScanTileData | null): LotCopiesParams {
  return {
    sort: "catalog",
    sortDir: "asc",
    // A run has no answer to this — one copy takes one tile — so the query is disabled and the slots
    // are a stable placeholder rather than a key that would vary per selection.
    freePhotoSlots: tile ? tilePhotoRoles(tile) : ["front"],
  };
}

export function TileIdentifyDialog({
  collectionId,
  areas,
  scanDpi,
  purchaseId,
  tiles,
  canIdentify,
  fromAuction,
  copyHref,
  onIdentifyNew,
  repeatLast,
  onIdentifyAs,
  onReidentify,
  onDone,
  onChanged,
  onClose,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** The one tile this dialog is about, or null when it is about a run. Everything that is genuinely
   * about a single piece — the assign list, the settled panels, the note editor — reads this and is
   * simply absent for a selection, rather than being generalised into something that would have to
   * pick one piece to stand for the rest. */
  const tile = tiles.length === 1 ? tiles[0].tile : null;
  const ids = tiles.map((t) => t.tile.id);
  const count = tiles.length;
  /** What the identification chain carries (#592/#596): the pieces themselves, so every dialog after
   * this one shows the very pictures the outcome was chosen from. */
  const pieces: IdentifiedPiece[] = tiles.map((t) => ({
    tileId: t.tile.id,
    sides: t.sides,
    position: t.tile.position,
  }));

  /** What these pieces could be (#607) — one shortlist over the run, as a **union** with how many
   * tiles carry each possibility. The tiles arrive with lists of their own (one narrowed yesterday,
   * another parked with nothing listed), and an intersection would drop exactly the narrowing the
   * collector came back to read. `tile-candidates.ts` owns the merge. */
  const merged = mergeTileCandidates(tiles.map((t) => t.tile));
  /** Whether anything is drawn beside the outcomes at all — a swept batch's back-only tile can have
   * no picture left, and the column then takes the whole dialog rather than sitting beside a gap. */
  const hasPictures = pieces.some((p) => p.sides.length > 0);

  /** Reached an end. A **parked** tile (#597) has not: it is a waiting tile whose answer is not at
   * this desk, so this dialog stays the working surface it is for a waiting one — identify, assign,
   * discard — with the note and the way back added. Only a single tile can be settled at all: the
   * strip gives a tick box to the two outstanding states alone. */
  const settled = tile != null && (tile.state === "consumed" || tile.state === "discarded");
  /** The copy a consumed tile became, when there still is one — what a correction re-points, and the
   * only thing that decides whether correcting is offered at all. Null on a tile whose copy was
   * deleted afterwards: there is nothing to re-identify, which is what that panel already says. */
  const consumedItem = tile?.state === "consumed" ? tile.item : null;
  /** Every piece in hand is parked, which is what decides between *set aside* and *put back*. A
   * **mixed** run is not put back on one press — some of it was never set aside — so it keeps
   * offering the park, which is the move that makes the run uniform. */
  const parked = tiles.every((t) => t.tile.state === "parked");

  /** Whether *Set aside to check* has been pressed and is asking what to check (#597) — the note
   * being the ordinary case, not the exception, so it is asked for at the button rather than left
   * to be found afterwards on a surface the collector would have to cross the screen to reach. */
  const [parking, setParking] = useState(false);
  const [parkNote, setParkNote] = useState("");

  /** Whether the picker is open **over** this dialog to add a candidate (#607). The same
   * `StampPickerBrowser` the identification opens one screen on, stacked rather than navigated to:
   * the tile, its note and the rest of the shortlist are what the collector is choosing against, and
   * a shortlist built on a screen that had put the piece away would be built from memory. */
  const [addingCandidate, setAddingCandidate] = useState(false);

  /**
   * Whether *Discard* has been pressed on a **run** and is asking to be confirmed.
   *
   * One tile keeps its single press, which #567 made cheap on purpose: on a parcel of junk it is the
   * frequent answer and it is reversible one click later. A run is the same act at a scale where the
   * way back is not: putting fifteen pieces back is fifteen presses on fifteen squares, because a
   * discarded tile takes no tick box. So the count is confirmed once, and the sentence says the
   * pictures are kept — which is the part that makes a mis-press survivable.
   */
  const [discarding, setDiscarding] = useState(false);

  // Lifted out of the assign list, because *whether the list holds anything* is what chooses the
  // opening mode. TanStack hashes the key structurally, so rebuilding the params per render is
  // free: two tiles needing the same slots hash to the same key and share one fetch.
  //
  // The `staleTime` is what keeps that true now the latch below waits for a fetch to finish: at the
  // screen's default of 0 the cached answer is stale the instant it arrives, so every tile of a card
  // would re-ask and wait on it.
  //
  // **A run does not ask it at all.** Front and back are singleton slots per copy, so a copy takes
  // one tile and "assign these fifteen" names no move; the query is disabled and the mode is
  // identify without waiting for anything.
  const roles = tile ? tilePhotoRoles(tile) : [];
  const copies = usePurchaseCopiesInfinite(
    collectionId,
    purchaseId,
    assignParams(tile),
    !settled && tile != null,
    ASSIGN_LIST_STALE_MS
  );
  const candidates = copies.data?.pages.flatMap((p) => p.items) ?? [];

  // Latched, never re-derived: the query could refetch and answer differently, and a dialog that
  // changed mode under the collector's hand mid-tile is exactly what waiting for the first answer
  // exists to avoid. A query error latches as "nothing to assign to", which is the safe reading.
  //
  // **`isFetching`, not just `isPending`.** A closed dialog leaves an *inactive* query, and
  // invalidating one only marks it stale — nothing refetches until an observer mounts again. So
  // reopening the dialog after copies were added elsewhere ("Add stamps") hands this render the old
  // answer with `isPending` already false, and latching there pinned the mode to the state of the
  // lot before those copies existed: the list stayed empty until a full page reload. Waiting for the
  // refetch that the mount itself kicks off is what makes the answer current.
  //
  // Race-free rather than hopefully-ordered: the observer computes its optimistic result with
  // `fetchState` applied whenever it will fetch on mount, so `isFetching` is already true on the
  // first render after an invalidation — never briefly false with stale data in hand.
  const [mode, setMode] = useState<Mode | null>(null);
  if (mode === null && (tile == null || (!copies.isPending && !copies.isFetching))) {
    setMode(tile != null && candidates.length > 0 ? "assign" : "identify");
  }

  /** `touchedCopy` rides with each call rather than being inferred afterwards: the action itself is
   *  the only thing that knows whether a copy changed hands. `keepOpen` is the parking path (#597),
   *  where the write is not the end of what the collector is doing with this tile. */
  const run = (
    fn: () => Promise<{ status: string; message?: string }>,
    touchedCopy: boolean,
    keepOpen = false
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "error") setError(result.message ?? "That did not work.");
      else if (keepOpen) onChanged(touchedCopy);
      else onDone(touchedCopy);
    });
  };

  const discard = (
    <DialogSecondaryButton
      // A discard changes the tiles and nothing else — their images stay where they are. One tile
      // acts on the press; a run asks once, for the reason `discarding` states.
      onClick={() => (count === 1 ? run(() => discardTilesAction(ids, ""), false) : setDiscarding(true))}
      disabled={pending}
    >
      <Icon name="delete" size="sm" />{" "}
      {pending ? "Working…" : count === 1 ? "Discard" : `Discard ${count} pieces`}
    </DialogSecondaryButton>
  );

  /** The one question a bulk discard stops to ask. It replaces the other actions for the reason the
   *  park prompt does: a confirmation standing beside the outcomes it is confirming is a row of
   *  buttons where one is expected. */
  const discardPrompt = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        Discard all {count} pieces? They keep their pictures and stay on the card as the record of
        what the parcel held — but putting them back is one press each.
      </span>
      <DialogSecondaryButton
        onClick={() => run(() => discardTilesAction(ids, ""), false)}
        disabled={pending}
      >
        <Icon name="delete" size="sm" /> {pending ? "Working…" : `Discard ${count} pieces`}
      </DialogSecondaryButton>
      <DialogSecondaryButton onClick={() => setDiscarding(false)} disabled={pending}>
        Cancel
      </DialogSecondaryButton>
    </div>
  );

  /**
   * *Set aside to check* (#597) — the piece whose variant a picture cannot settle.
   *
   * Beside *Discard*, and it is the one outcome here that is **two presses rather than one**,
   * because a parked piece nearly always comes with a doubt to name: *watermark?*, *dark or light
   * blue?*, *check perf against Mi 200*. That sentence is the whole value of the state — it is what
   * the collector reads when they come back with the lamp instead of deriving the doubt again from
   * the picture that could not settle it — so the field opens **where the button was**, under the
   * cursor that just pressed it, and not somewhere else on a screen this wide.
   *
   * A discard is the opposite bargain and keeps its one press: it is the frequent answer on a parcel
   * of junk and its note is the rare one, so it acts and the note is written afterwards. Here the
   * note is the ordinary case, so it is asked for — but never *required*: Enter on an empty field
   * parks the tile, because *something is off here* is a complete thought.
   *
   * The prompt **replaces the other actions** while it is open rather than sitting among them. It is
   * a question with two answers, and leaving *Discard* next to a focused field would put the one
   * irreversible-ish outcome one stray click from a piece being set aside.
   */
  const park = !parked ? (
    <DialogSecondaryButton onClick={() => setParking(true)} disabled={pending}>
      <Icon name="pause" size="sm" />{" "}
      {count === 1 ? "Set aside to check" : `Set aside ${count} pieces to check`}
    </DialogSecondaryButton>
  ) : null;

  // One note for the whole run, written onto each of its tiles: thirty pieces of one definitive in
  // two shades pose *one* question, and *dark or light blue?* is as true of the thirtieth as of the
  // first. It is written to every tile rather than held anywhere shared because it is read months
  // later off whichever square the collector opens.
  const commitPark = () => run(() => parkTilesAction(ids, parkNote), false);

  /** The parent the shortlist has turned out to be variants of, if it has (#607). Read here as well
   * as inside the shortlist because **this is the moment the issue asked for**: a collector reaching
   * for *park* with two watermark variants listed does not need to park at all, and the sentence is
   * worth more before the piece goes into the tray than after. */
  const parkShortcut = sharedVariantParent(merged.map((m) => m.candidate));

  const parkPrompt = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
      {parkShortcut && (
        <ParentInsteadNotice
          parent={parkShortcut}
          disabled={pending || !canIdentify}
          onIdentifyAs={(pick) => onIdentifyAs(pick, pieces)}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
      <label style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        {/* One question for the run, since that is what a run of one definitive poses — and the
            count says how many pieces the sentence is about to be written on. */}
        {count === 1 ? "What to check?" : `What to check on all ${count}?`}
        <input
          autoFocus
          value={parkNote}
          onChange={(e) => setParkNote(e.target.value)}
          disabled={pending}
          placeholder="watermark? · dark or light blue? · perf vs Mi 200"
          // Enter sets it aside and Escape abandons the whole thing: the collector's hands are on
          // the keyboard the moment this opens, and a note this short should never need the mouse
          // to be picked up again.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitPark();
            } else if (e.key === "Escape") {
              // Reaches here because the dialog steps out of the escape layer while this is open
              // (see `dismissable` below) — otherwise the shared document-level listener would have
              // closed the whole dialog before this ran.
              e.preventDefault();
              setParking(false);
              setParkNote("");
            }
          }}
          style={{
            marginLeft: "0.5rem",
            width: "22rem",
            padding: "0.3125rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-page)",
            color: "var(--color-text-primary)",
            font: "inherit",
            fontSize: "0.8125rem",
          }}
        />
      </label>
      <DialogSecondaryButton onClick={commitPark} disabled={pending}>
        <Icon name="pause" size="sm" />{" "}
        {pending ? "Working…" : count === 1 ? "Set aside" : `Set aside ${count} pieces`}
      </DialogSecondaryButton>
      <DialogSecondaryButton
        onClick={() => {
          setParking(false);
          setParkNote("");
        }}
        disabled={pending}
      >
        Cancel
      </DialogSecondaryButton>
      </div>
    </div>
  );

  /** The way back out of both waiting-room states — a mis-clicked discard, or a parked piece whose
   * answer is now known. On a parked tile it is the *ordinary* end of the wait rather than an undo,
   * which is why it says what it says rather than *Un-park*. */
  const putBack = (
    <DialogSecondaryButton
      onClick={() => run(() => returnTilesToQueueAction(ids), false)}
      disabled={pending}
    >
      <Icon name="restore" size="sm" />{" "}
      {count === 1 ? "Put back in the queue" : `Put ${count} pieces back in the queue`}
    </DialogSecondaryButton>
  );

  /** *Same as the last* (#595), beside *Identify as a new copy* in both footers, because it is that
   * answer with its first question already answered — and offered under the same `canIdentify`, since
   * an order whose every lot is closed takes no new copy however it is asked for. It names the stamp
   * and the condition it will apply: this is the one control on the screen that acts on a decision
   * taken minutes ago, so what it will do has to be readable before it is pressed. */
  const repeat = repeatLast ? (
    <DialogSecondaryButton
      onClick={() => repeatLast.onRepeat(pieces)}
      disabled={pending || !canIdentify}
    >
      <Icon name="duplicate" size="sm" /> Same as the last: {repeatLast.summary}
    </DialogSecondaryButton>
  ) : null;

  return (
    <>
    <DialogShell
      // One piece is named by where it lies on the card, which is how it is found in the tray; a run
      // is named by its size, there being no one position to name it after.
      title={tile ? `Tile ${tile.position + 1}` : `${count} tiles selected`}
      onClose={onClose}
      // Sized for the picture rather than for the text beside it, and the same shape as the cut
      // editor: the two surfaces that show a scan large are the two that are worth a whole screen.
      maxWidth="min(96vw, 82rem)"
      height="90vh"
      // While the *what to check* field is open, Escape belongs to **it** (#597): abandoning the
      // note is not abandoning the tile, and a collector three words into a doubt who presses
      // Escape means "not like that", not "close everything". The shared layer stack listens on the
      // document in the capture phase, so a handler on the input cannot stop it — stepping this
      // dialog out of the stack is the documented way to hand the key over. It also stops a stray
      // backdrop click from taking the sentence with it.
      // …and while the picker is stacked over this dialog (#607), for the reason `StampSelect` hands
      // the key over the same way: one Escape must close the picker and leave the tile where it is.
      // The bulk-discard confirmation deliberately does **not** take the key: it holds nothing the
      // collector typed, so Escape closing the whole dialog abandons it at no cost — where the note
      // field is three words someone meant.
      dismissable={!parking && !addingCandidate}
    >
      {/* The picture takes the room and the outcome sits beside it in a column of its own, which
          scrolls on its own so a lot's whole copy list can never push the tile off screen. */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          gap: "1.25rem",
          padding: "1.25rem 1.5rem",
        }}
      >
        {/* One piece is #585's viewer, exactly as before; a run is the grid of them with a loupe
            one click away and ‹ / › between neighbours (#596's aside, which is already the shape
            this needs — it is drawn beside the condition step for the same selection). Answering
            *show the first one* would be one photograph standing in for fifteen pieces of paper. */}
        <IdentifiedPieceAside collectionId={collectionId} pieces={pieces} scanDpi={scanDpi} />

        <div
          style={{
            width: hasPictures ? "24rem" : "100%",
            flexShrink: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* A parked tile's note sits **above** the outcomes, not instead of them (#597): it is
              what the collector wrote to themselves about this piece, so it is the first thing to
              read on coming back — and the identification it was waiting for is right underneath,
              which is the whole point of the tile staying workable while parked. */}
          {parked && tile && (
            <ParkedNote
              note={tile.note}
              disabled={pending}
              onSave={(n) => run(() => noteTileAction(tile.id, n), false, true)}
            />
          )}
          {/* A run's notes are **read here and edited on the piece**. Each parked tile carries its
              own sentence, and one field over fifteen of them would either overwrite fourteen or
              have to invent a merge; what the return sitting needs from this surface is to see the
              doubts that were written, which is what this says. */}
          {parked && !tile && <ParkedRunNotes tiles={tiles.map((t) => t.tile)} />}
          {/* What the piece could be (#607) — under the note, because the note says what to check and
              the shortlist says what to check it *against*. Both above the outcomes, since coming
              back to a parked tile is reading those two and then answering.
              **On every tile still to be identified, not only a parked one**: the narrowing happens
              while the piece is on screen and *before* the collector concludes it cannot be settled
              here, so a list that only appeared after parking meant setting the tile aside, closing
              the dialog and opening it again to write down what was already in mind. On a waiting
              tile with nothing listed it is one quiet line and no panel. */}
          {!settled && (
            <CandidateShortlist
              collectionId={collectionId}
              areas={areas}
              candidates={merged}
              tileCount={count}
              parked={parked}
              canIdentify={canIdentify}
              disabled={pending}
              onAdd={() => setAddingCandidate(true)}
              onRemove={(stampId) =>
                run(() => removeTileCandidateAction(ids, stampId), false, true)
              }
              onIdentifyAs={(pick) => onIdentifyAs(pick, pieces)}
            />
          )}
          {settled && tile ? (
            <SettledTile tile={tile} disabled={pending} onSaveNote={(n) => run(() => noteTileAction(tile.id, n), false)} />
          ) : mode === null ? (
            // The first tile of a card, waiting on the one lot-wide query. Deliberately not opening
            // on identify meanwhile: a mode that arrives a moment later is a dialog that moves under
            // the hand of someone already reading it.
            <Muted>Checking what this lot already holds…</Muted>
          ) : mode === "assign" ? (
            <AssignList
              copies={candidates}
              roles={roles}
              fromAuction={fromAuction}
              disabled={pending}
              hasMore={copies.hasNextPage ?? false}
              loadingMore={copies.isFetchingNextPage}
              onLoadMore={() => void copies.fetchNextPage()}
              onPick={(itemId) => tile && run(() => assignTileAction(tile.id, itemId), true)}
            />
          ) : (
            <IdentifyIntro canIdentify={canIdentify} count={count} />
          )}

          {error && (
            <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
              {error}
            </p>
          )}
        </div>
      </div>

      {settled && tile ? (
        <DialogFooter>
          {/* The settled states' one way onward, each on the left where the other outcomes sit:
              a discard goes back into the queue, and a consumed tile leads to what it became
              (#584) — the click that used to happen by itself, now asked for. */}
          {tile.state === "discarded" && <div style={{ marginRight: "auto" }}>{putBack}</div>}
          {tile.state === "consumed" && (consumedItem || copyHref) && (
            <div
              style={{ marginRight: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              {/* The identification corrected where it is found to be wrong, beside the way to the
                  copy rather than instead of it: one leaves this pass, the other is this pass. */}
              {consumedItem && (
                <DialogSecondaryButton
                  // Never gated on `canIdentify`: that flag is about a **new** copy on a closed
                  // lot, and this creates none. The pool a closed lot was split across is the same
                  // set of copies after a correction as before it.
                  onClick={() => onReidentify(pieces[0], consumedItem)}
                  disabled={pending}
                >
                  <Icon name="edit" size="sm" /> Identify again
                </DialogSecondaryButton>
              )}
              {copyHref && (
                <DialogLinkButton href={copyHref}>
                  <Icon name="open" size="sm" /> Open copy
                </DialogLinkButton>
              )}
            </div>
          )}
          <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
        </DialogFooter>
      ) : discarding ? (
        // The same treatment the park prompt gets, and for the same reason: a confirmation with the
        // other outcomes still standing beside it is a row of buttons where one answer is expected.
        <DialogFooter>{discardPrompt}</DialogFooter>
      ) : parking ? (
        // The whole footer while the question is open (#597): it is a question, and a question with
        // the other outcomes still standing beside it is a row of buttons one stray click from
        // discarding the piece that was about to be set aside.
        <DialogFooter>{parkPrompt}</DialogFooter>
      ) : mode === null ? (
        // Nothing to offer until the mode is known — offering an action that might be the wrong one
        // is what waiting is for.
        <DialogFooter>
          <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        </DialogFooter>
      ) : mode === "assign" ? (
        // Assign is the *showing* outcome, so picking a copy row is the action and the footer
        // carries only the two ways out of it — each one click, not a round trip through a menu.
        <DialogFooter>
          <div
            style={{ marginRight: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <DialogSecondaryButton
              onClick={() => onIdentifyNew(pieces)}
              disabled={pending || !canIdentify}
            >
              <Icon name="add" size="sm" /> Identify as new copy
            </DialogSecondaryButton>
            {repeat}
            {parked ? putBack : park}
            {discard}
          </div>
          <DialogSecondaryButton onClick={onClose} disabled={pending}>
            Cancel
          </DialogSecondaryButton>
        </DialogFooter>
      ) : (
        <DialogActions
          // The count is stated before anything is created, as every bulk action on this screen
          // does — and it says *one stamp*, which is the assertion ticking the tiles made.
          actionLabel={
            count === 1 ? "Identify as a new copy" : `Identify ${count} tiles as one stamp`
          }
          cancelLabel="Cancel"
          disabled={pending || !canIdentify}
          cancelDisabled={pending}
          onCancel={onClose}
          onAction={() => onIdentifyNew(pieces)}
          leading={
            <>
              {repeat}
              {parked ? putBack : park}
              {discard}
              {/* Only when there is something to assign to — which is the very condition that chose
                  identify over assign, so this is one expression rather than a second rule. Without
                  it the button is always here and always opens an empty list. */}
              {tile && candidates.length > 0 && (
                <DialogSecondaryButton onClick={() => setMode("assign")} disabled={pending}>
                  <Icon name="link" size="sm" /> Assign to a copy on this order
                </DialogSecondaryButton>
              )}
            </>
          }
        />
      )}
    </DialogShell>

    {/* Adding a candidate is **the identification's own picker**, opened over this dialog (#607).
        Not a second, lighter chooser: a shortlist entry and an identification name the same kind of
        thing, and two ways of naming a stamp would drift in what they can reach — a variant deep in
        a tree, a stamp that has to be created on the spot, the copies-held badge that says the
        collector already owns one. The piece stays on screen through it (#592's slot), because the
        shortlist is being built *from* the picture. */}
    {addingCandidate && (
      <StampPickerBrowser
        collectionId={collectionId}
        areas={areas}
        aside={
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              gap: "0.625rem",
            }}
          >
            <IdentifiedPieceAside collectionId={collectionId} pieces={pieces} scanDpi={scanDpi} />
            {/* The shortlist as it stands, beside the piece — which is what lets the picker stay
                open across several picks: a stamp added is visibly added, so a second pick reads as
                *and this one* rather than as a press that may not have registered. */}
            <ShortlistSoFar candidates={merged.map((m) => m.candidate)} />
          </div>
        }
        asideWidth="26rem"
        // **What is already on the list is marked on its own row.** A picker that closes on the pick
        // never has to answer *which of these have I taken*; this one stays open, so without the mark
        // the collector is reading the tree against a list on the other side of the screen and
        // pressing a stamp twice to be sure. It names the list rather than showing a bare tick,
        // because a catalogue row already carries badges for *held* and *wanted*.
        // Marked when **any** piece in hand carries it, not only when every one does: the question the
        // mark answers is *have I already picked this*, and the answer is yes. Pressing it again is
        // still meaningful on a mixed run — it writes the stamp to the pieces missing it — which is
        // why the hint says that rather than promising nothing happens.
        marked={{
          stampIds: new Set(merged.map((m) => m.candidate.stampId)),
          label: "shortlisted",
          hint:
            count === 1
              ? "Already on this piece's shortlist"
              : "Already shortlisted — pressing it again adds it to any ticked piece still missing it",
        }}
        // **It stays open.** The case this exists for is *watermark A or B*, which is two picks, and
        // a chooser that closes on the first turns listing three stamps into three trips through
        // the area tree. Nothing is lost by staying: each pick is written on its own, the shortlist
        // beside the piece says so, and closing is the ordinary Escape.
        // Written to **every** ticked tile: a shortlist built through a selection is a statement
        // about the run, which is the saving — five pieces narrowed to the same pair is one trip to
        // the colour key rather than five.
        onPick={(picked) => run(() => addTileCandidateAction(ids, picked.stampId), false, true)}
        onClose={() => setAddingCandidate(false)}
      />
    )}

    </>
  );
}

// ── The identify outcome, as it arrives ──────────────────────────────────────────────────────

/** What the dialog says when it opens on *identify*: one line, because the images above it are the
 * thing being read and the action is in the footer. */
function IdentifyIntro({ canIdentify, count }: { canIdentify: boolean; count: number }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: "0.8125rem",
        color: canIdentify ? "var(--color-text-secondary)" : "var(--color-error)",
      }}
    >
      {canIdentify
        ? count === 1
          ? "Identify the piece from the catalogue — the lot it belongs to, condition, certificate and location follow, and these images move onto the copy it creates."
          : // What the run's own answer creates, said before anything is created: one stamp, one
            // condition, one lot — and one copy per piece, each keeping its own pictures.
            `Identify these ${count} pieces as one stamp — the lot, condition, certificate and location are answered once, and each piece becomes its own copy with its own images.`
        : count === 1
          ? "Every lot on this order is closed, so none of them takes a new copy. Reopen one to identify this tile, or assign the images to a copy the order already holds."
          : "Every lot on this order is closed, so none of them takes a new copy. Reopen one to identify these pieces — setting them aside and discarding them still work."}
    </p>
  );
}

// ── Assigning to a copy already on the lot ───────────────────────────────────────────────────

function AssignList({
  copies,
  roles,
  fromAuction,
  disabled,
  hasMore,
  loadingMore,
  onLoadMore,
  onPick,
}: {
  /** Already narrowed to copies holding none of `roles` — the dialog above owns the query, because
   * whether this list holds anything is what chose to show it. */
  copies: ItemListItem[];
  /** The slots this tile needs, for the sentence that explains who is missing and why. */
  roles: TilePhotoRole[];
  fromAuction: boolean;
  disabled: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onPick: (itemId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        {fromAuction
          ? "This order was settled from an auction sale, so its copies are the lines that were described in order to bid — across every lot won. Pick the one this tile shows."
          : "Pick the copy this tile shows. Its images move onto that copy."}
      </p>
      {/* Why a copy the collector knows is on this order may not be here — and it is about *this*
          tile, not about free slots in general. Said up front, because the alternative is
          concluding the list is broken and going looking for a bug. */}
      <Muted>{listScope(roles)}</Muted>
      {copies.length === 0 && (
        <Muted>
          No copy on this order can take it. Identify the tile as a new copy instead.
        </Muted>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {copies.map((copy) => (
          <CopyRow key={copy.id} copy={copy} disabled={disabled} onPick={() => onPick(copy.id)} />
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            padding: 0,
            fontSize: "0.8125rem",
            color: "var(--color-action-primary)",
            cursor: "pointer",
          }}
        >
          {loadingMore ? "Loading…" : "Show more copies"}
        </button>
      )}
      {/* A tile that matches none of the lines is the parcel disagreeing with its description —
          which is information, not a problem to hide, so the way out of this list says so. */}
      {fromAuction && (
        <Muted>
          None of these? Then the parcel holds something its description never listed — press{" "}
          <em>Identify as new copy</em> below.
        </Muted>
      )}
    </div>
  );
}

/** What this tile carries, and therefore which copies cannot take it. Worded from the roles in
 * hand, so it says the same thing the filter did rather than a general claim about free slots. */
function listScope(roles: TilePhotoRole[]): string {
  if (roles.length === 2) {
    return "This tile carries a front and a back, so only copies with neither are listed — one that already has either side cannot take it.";
  }
  if (roles[0] === "back") {
    return "This tile carries a back, so only copies without one are listed — a copy that already has a back cannot take it.";
  }
  return "This tile carries a front, so only copies without one are listed — a copy that already has a front cannot take it.";
}

function CopyRow({
  copy,
  disabled,
  onPick,
}: {
  copy: ItemListItem;
  disabled: boolean;
  onPick: () => void;
}) {
  const numbers = copy.catalogNumbers.map((n) => n.number).join(" · ");
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        textAlign: "left",
        padding: "0.375rem 0.625rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          fontSize: "0.75rem",
          fontVariantNumeric: "tabular-nums",
          color: "var(--color-text-muted)",
        }}
      >
        {formatItemNo(copy.itemNo)}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: "0.8125rem" }}>
        {numbers && <strong>{numbers}</strong>}
        {numbers && copy.stampName ? " — " : ""}
        {copy.stampName ?? (numbers ? "" : "Unnamed stamp")}
        <span style={{ color: "var(--color-text-muted)" }}>
          {" "}
          · {copy.conditionAbbreviation}
        </span>
      </span>
      {/* What the copy already holds — the reason this path exists at all. From the shared helper,
          so the row and the filter above it describe slots the same way. */}
      <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
        {describeFreeSlots(copy.photos)}
      </span>
    </button>
  );
}

// ── A tile parked to be checked (#597) ───────────────────────────────────────────────────────

/**
 * What the collector wrote about a parked piece, and where they change it.
 *
 * **The note is the point of the state.** *Watermark?* — *dark or light blue?* — *check perf against
 * Mi 200*: written while the doubt is fresh, read months later by someone who would otherwise have
 * to derive the doubt again from the very picture that could not settle it. So it leads this panel
 * rather than sitting under the outcomes, and it is a field rather than a line of text, because the
 * doubt narrows as it is worked on.
 *
 * **Optional, and it stays optional.** *Something is off here* is a complete thought — the same
 * call the discard note makes, and for the same reason: parking has to stay cheaper than the
 * interruption it prevents.
 */
function ParkedNote({
  note,
  disabled,
  onSave,
}: {
  note: string | null;
  disabled: boolean;
  onSave: (note: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        marginBottom: "0.875rem",
        padding: "0.625rem 0.75rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        <strong>Set aside to check.</strong> It is still to be identified — it is only out of the
        queue until you have the answer. Identify it below when you do, or put it back.
      </p>
      <TileNote
        label="What to check (optional)"
        placeholder="e.g. watermark? · dark or light blue? · check perf against Mi 200"
        note={note}
        disabled={disabled}
        onSave={onSave}
      />
    </div>
  );
}

/**
 * The doubts a **run** of parked pieces is carrying — read here, written on the piece.
 *
 * A run put back in front of the collector months later is answered by the sentences that were
 * written when it was set aside, so this panel has to show them; what it must not do is offer one
 * field over fifteen tiles, which could only overwrite fourteen sentences or invent a merge of them.
 * Editing stays where the note belongs — the tile's own dialog — and the distinct ones are listed
 * because a run parked together usually wrote the same doubt on all of them, and saying it fifteen
 * times would bury the one piece whose note differs.
 */
function ParkedRunNotes({ tiles }: { tiles: ScanTileData[] }) {
  const notes = [...new Set(tiles.map((t) => t.note?.trim()).filter(Boolean))] as string[];
  const unwritten = tiles.filter((t) => !t.note?.trim()).length;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        marginBottom: "0.875rem",
        padding: "0.625rem 0.75rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        <strong>
          {tiles.length} pieces set aside to check.
        </strong>{" "}
        They are still to be identified. Identify them together below when you have the answer, or
        put them back.
      </p>
      {notes.length > 0 && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          {notes.join(" · ")}
          {unwritten > 0 && (
            <span style={{ color: "var(--color-text-muted)" }}>
              {" "}
              · {unwritten} with no note
            </span>
          )}
        </p>
      )}
      <Muted>Open a piece on the strip to change what its note says.</Muted>
    </div>
  );
}

/**
 * What the piece **could be** (#607), and the one press that settles it.
 *
 * Discovering that a tile cannot be identified from its picture is not free: to know that a
 * watermark or a shade decides it, the collector has already worked out which stamps it could be.
 * #597 kept the note and threw that away, so the return sitting started from the catalogue again.
 * These are the possibilities, and pressing one identifies the tile as that stamp **exactly as
 * picking it from the picker would** — the same condition step, the same confirm, nothing created by
 * the press itself.
 *
 * **The ordinary picker is never replaced by this.** A narrowing can be wrong, and the piece under
 * the lamp may turn out to be neither of the two stamps it was shortlisted to; if the shortlist stood
 * where *Identify as a new copy* stands, the wrong case would be the expensive one. So the footer is
 * untouched and this sits above it.
 *
 * **Nothing survives the identification** — the rows are deleted when the tile becomes a copy, and
 * with the note when it is put back — so this list never has to be reconciled with what the copy
 * actually is. `scan-tiles.ts` owns that.
 */
function CandidateShortlist({
  collectionId,
  areas,
  candidates,
  tileCount,
  parked,
  canIdentify,
  disabled,
  onAdd,
  onRemove,
  onIdentifyAs,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  /** The shortlist over whatever this dialog is about — one tile's, or the union across a run with
   * how many of them carry each possibility (`mergeTileCandidates`). */
  candidates: MergedTileCandidate[];
  /** How many tiles the shortlist is being read for, so a possibility written on only some of them
   * can say so. One is the ordinary case and says nothing. */
  tileCount: number;
  /** Whether the tile has been set aside. Decides only how much of this is drawn: a waiting tile
   * with nothing listed gets one line, because most tiles are identified where they stand and a
   * panel on every one of them would be a form in front of the ordinary answer. */
  parked: boolean;
  /** Whether this order can take a new copy at all — an order whose every lot is closed cannot, so
   * the one-press choices are offered disabled rather than absent: the shortlist is still what the
   * collector came back to read. */
  canIdentify: boolean;
  disabled: boolean;
  onAdd: () => void;
  onRemove: (stampId: string) => void;
  onIdentifyAs: (pick: TileStampPick) => void;
}) {
  const parent = sharedVariantParent(candidates.map((c) => c.candidate));
  // One derivation for the whole list, not one per row: the vendor maps come off a shared query and
  // every candidate resolves through the same (area, issue) lookup the picker's rows do (#377).
  const { vendorMapFor, primaryVendorByArea } = useAreaVendorMaps(areas, collectionId);

  const add = (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      style={{
        alignSelf: "flex-start",
        background: "none",
        border: "none",
        padding: 0,
        fontSize: "0.8125rem",
        color: "var(--color-action-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <Icon name="add" size="sm" />{" "}
      {candidates.length === 0 ? "Cannot tell? List what it could be…" : "Add another it could be…"}
    </button>
  );

  // A waiting tile with nothing listed: one quiet line and no panel. This is the ordinary tile —
  // identified where it stands — and the line is here rather than only on a parked one so the
  // narrowing can be written down **while the piece is on screen**, which is when it is in mind.
  if (candidates.length === 0 && !parked) {
    return <div style={{ marginBottom: "0.875rem" }}>{add}</div>;
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.875rem" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <strong style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          It could be
        </strong>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          {candidates.length === 0
            ? "— the narrowing you have already done, kept for the trip back"
            : "— press one to identify it as that stamp"}
        </span>
      </div>

      {candidates.map(({ candidate: c, onCount }) => (
        <CandidateRow
          key={c.stampId}
          collectionId={collectionId}
          candidate={c}
          // Said only when it is not true of the whole run: a possibility carried by three of five
          // ticked pieces is a fact about how they were narrowed, and smoothing it over would be the
          // union pretending to be an intersection. Adding or removing from here settles it.
          partial={onCount < tileCount ? `on ${onCount} of ${tileCount}` : null}
          vendorMap={vendorMapFor(c.collectionAreaId, c.issueId)}
          primaryVendorId={
            c.collectionAreaId ? primaryVendorByArea.get(c.collectionAreaId) ?? null : null
          }
          canIdentify={canIdentify}
          disabled={disabled}
          onRemove={() => onRemove(c.stampId)}
          onIdentifyAs={onIdentifyAs}
        />
      ))}

      {add}

      {parent && (
        <ParentInsteadNotice
          parent={parent}
          disabled={disabled || !canIdentify}
          onIdentifyAs={onIdentifyAs}
        />
      )}
    </div>
  );
}

/**
 * One possibility, drawn **as the picker draws a stamp** (#607).
 *
 * A shortlist is compared against a piece under a lamp, and a bare catalogue number is not enough to
 * do that with: the thumbnail is what the piece is held against, the subtype is what separates two
 * siblings sharing a number, the catalogue price is what says whether the difference is worth the
 * trip, and the copies-held badge and want marker say whether this one is already in the box or
 * still being looked for. Those are exactly the things the picker's row carries — so the row *is*
 * the picker's, from the same query (`useIssueMembers`, one fetch per issue and shared with the
 * picker's own cache) through the same components (`PhotoThumb`, `StampTitle`, `StampDetailLine`).
 * Restating them here in a smaller form would be a second, poorer rendering of one thing.
 *
 * It degrades rather than blocks: until the issue's members arrive — and permanently for a stamp on
 * no issue — the row is the plain label the read model always carries, and it is pressable
 * throughout. What must never happen is the row being *absent* while a fetch is in flight, since the
 * collector came back to this tile to press it.
 */
function CandidateRow({
  collectionId,
  candidate,
  partial,
  vendorMap,
  primaryVendorId,
  canIdentify,
  disabled,
  onRemove,
  onIdentifyAs,
}: {
  collectionId: string;
  candidate: TileCandidate;
  /** *on 3 of 5*, when this possibility is written on only some of the ticked pieces — null for the
   * ordinary case, which is one tile or a run that agrees. */
  partial: string | null;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  canIdentify: boolean;
  disabled: boolean;
  onRemove: () => void;
  onIdentifyAs: (pick: TileStampPick) => void;
}) {
  const { data: members = [] } = useIssueMembers(
    collectionId,
    candidate.issueId ?? "",
    !!candidate.issueId
  );
  const node = members.find((m) => m.stampId === candidate.stampId) ?? null;
  const label = candidateLabel(candidate);

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "0.25rem" }}>
      <Tooltip content="Identify this tile as this stamp" align="start" style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() =>
            onIdentifyAs({
              stampId: candidate.stampId,
              label,
              shortLabel: candidateShortLabel(candidate),
            })
          }
          disabled={disabled || !canIdentify}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "0.4rem 0.625rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
            font: "inherit",
            fontSize: "0.8125rem",
            cursor: disabled || !canIdentify ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {node ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
              {/* The catalogue photo is the whole reason this row is not a line of text: it is what
                  the piece in the tweezers is held against. Not a button of its own here — the row
                  is one, and a lightbox inside it would be a click that does not identify. */}
              <PhotoThumb collectionId={collectionId} photos={node.photos} reserveWhenEmpty />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <StampTitle node={node} />
                  {candidate.unknownVariant && (
                    <span style={{ color: "var(--color-text-muted)" }}> — unknown variant</span>
                  )}
                  {partial && (
                    <span style={{ color: "var(--color-text-muted)" }}> — {partial}</span>
                  )}
                </span>
                <StampDetailLine
                  node={node}
                  vendorMap={vendorMap}
                  primaryVendorId={primaryVendorId}
                />
              </div>
            </div>
          ) : (
            <>
              {label}
              {partial && <span style={{ color: "var(--color-text-muted)" }}> — {partial}</span>}
            </>
          )}
        </button>
      </Tooltip>
      {/* Ruling one out is the ordinary progress of the work parking exists for, so it costs
          exactly what adding it did — and it is a button of its own rather than a menu, there
          being one thing to do to a possibility that is no longer one. */}
      <Tooltip content="Rule this one out">
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Rule out ${label}`}
          style={{
            padding: "0 0.5rem",
            height: "100%",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-muted)",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <Icon name="close" size="sm" />
        </button>
      </Tooltip>
    </div>
  );
}

/** The shortlist as it stands, under the piece in the picker's aside (#607) — what makes a chooser
 * that stays open legible: a pick lands here, so the next one reads as *and this one* rather than as
 * a press that may not have registered. Plain labels, since the rows themselves are two feet away in
 * the tree the collector is picking from. */
function ShortlistSoFar({ candidates }: { candidates: TileCandidate[] }) {
  if (candidates.length === 0) {
    return (
      <Muted>Pick everything this piece could be — the popup stays open until you close it.</Muted>
    );
  }
  return (
    <div
      style={{
        flexShrink: 0,
        padding: "0.5rem 0.625rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
        fontSize: "0.8125rem",
        color: "var(--color-text-secondary)",
      }}
    >
      <strong>It could be:</strong>{" "}
      {candidates.map((c) => candidateShortLabel(c)).join(" · ")}
    </div>
  );
}

/**
 * **Much of the case this feature serves already has a better answer, and this is where the app says
 * so** (#607).
 *
 * A copy may point at a stamp at any level of the variant tree, and pointing at the *parent* is the
 * statement "I know which stamp, not which variant": the copy is created, flagged unknown-variant,
 * valued cautiously, given an internal number and a place in the box, and *Identify variant*
 * re-points it later with the change recorded in its refinement history. So *it is Mi 200, but
 * watermark A or B?* needs **no parking at all** — a parked tile keeps the piece loose in a tray
 * instead, which is worse in every respect.
 *
 * **Said once, quietly, and never as a nag.** It appears only when the shortlist has in fact become
 * *these variants of one node* — which is the whole of its condition, and `sharedVariantParent`
 * insists on the effective `actsAsVariant` of every candidate, because an error, a plate flaw or an
 * overprint is its own collectible and the parent is a concrete stamp in its own right. On such a
 * shortlist the parent would be **one of the answers rather than the question**, and this must not
 * appear. It is a sentence with an action, not a warning: the collector may still have reasons to
 * keep the piece in the tray, and nothing here undoes the parking on their behalf.
 */
function ParentInsteadNotice({
  parent,
  disabled,
  onIdentifyAs,
}: {
  parent: NonNullable<TileCandidate["parent"]>;
  disabled: boolean;
  onIdentifyAs: (pick: TileStampPick) => void;
}) {
  const label = candidateLabel(parent);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        padding: "0.5rem 0.625rem",
        borderRadius: "0.375rem",
        border: "1px dashed var(--color-border-strong)",
        background: "var(--color-bg-page)",
        fontSize: "0.8125rem",
        color: "var(--color-text-secondary)",
      }}
    >
      <span>
        These are all variants of <strong>{label}</strong>. You do not have to keep this piece in the
        tray: identify it as {label} and it is recorded as <em>variant not yet known</em> — a copy
        with a number and a place in the box, valued cautiously, and <em>Identify variant</em> settles
        it whenever the lamp comes out.
      </span>
      <button
        type="button"
        onClick={() =>
          onIdentifyAs({
            stampId: parent.stampId,
            label,
            shortLabel: candidateShortLabel(parent),
          })
        }
        disabled={disabled}
        style={{
          alignSelf: "flex-start",
          padding: "0.25rem 0.625rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-bg-elevated)",
          color: "var(--color-text-secondary)",
          fontSize: "0.8125rem",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        Identify as {label} instead
      </button>
    </div>
  );
}

/**
 * The note field both waiting-room states carry — a discard's *what the parcel held*, a parked
 * tile's *what to check*. One component, because they are one control: a small textarea that only
 * offers to save once what is in it differs from what is stored, so a tile whose note has not been
 * touched shows no button to press.
 */
function TileNote({
  label,
  placeholder,
  note,
  disabled,
  onSave,
}: {
  label: string;
  placeholder: string;
  note: string | null;
  disabled: boolean;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(note ?? "");
  // Re-seeded when the stored note moves underneath — a save that landed, or the tile being
  // re-read — so the box never sits on a value the tile no longer has.
  const [seed, setSeed] = useState(note);
  if (seed !== note) {
    setSeed(note);
    setDraft(note ?? "");
  }
  const dirty = draft.trim() !== (note ?? "");

  return (
    <label style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
      {label}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        rows={2}
        placeholder={placeholder}
        style={{
          marginTop: "0.25rem",
          width: "100%",
          padding: "0.375rem 0.5rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-bg-page)",
          color: "var(--color-text-primary)",
          fontSize: "0.8125rem",
          resize: "vertical",
        }}
      />
      {dirty && (
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={disabled}
          style={{
            marginTop: "0.375rem",
            padding: "0.25rem 0.625rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            fontSize: "0.8125rem",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {disabled ? "Saving…" : "Save the note"}
        </button>
      )}
    </label>
  );
}

// ── A tile that is already done with ─────────────────────────────────────────────────────────

/** Where a discard's note is written, since discarding itself never stopped to ask for one. Also
 * where a consumed tile says what it became. */
function SettledTile({
  tile,
  disabled,
  onSaveNote,
}: {
  tile: ScanTileData;
  disabled: boolean;
  onSaveNote: (note: string) => void;
}) {
  if (tile.state === "consumed") {
    return (
      <div
        style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}
      >
        {tile.item ? (
          <>
            <p style={{ margin: 0 }}>
              This tile became copy <strong>{formatItemNo(tile.item.itemNo)}</strong>, which now owns
              the images above.
            </p>
            {/* **Which** copy, not merely that there is one (#584). A number alone cannot be
                checked against the piece in the tweezers; the stamp it was identified as can, and
                that is what makes opening the copy a decision rather than a way of finding out. The
                numbers are the copy's own, drawn the way the assign list one screen back draws
                them. */}
            <ConsumedIdentity item={tile.item} />
          </>
        ) : (
          <p style={{ margin: 0 }}>
            This tile became a copy that has since been <strong>deleted</strong>, and its images went
            with it. There is nothing to restore — the tile stays as the record that it was worked
            through.
          </p>
        )}
        {tile.outsideDescription && (
          <p style={{ margin: "0.5rem 0 0" }}>
            Its stamp is on <strong>none of the auction lot&rsquo;s lines</strong> — the parcel holds
            something its description never listed.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
        <strong>Discarded.</strong> The image is kept and the tile no longer counts as
        unidentified. It survives the lot closing: for a card bought sight-unseen these tiles are
        the only record of what was actually inside.
      </p>
      <TileNote
        label="Note (optional)"
        placeholder="e.g. thinned, heavy crease, faked overprint"
        note={tile.note}
        disabled={disabled}
        onSave={onSaveNote}
      />
    </div>
  );
}

/** What the copy a tile became *is*, in one line — its numbers, its name and its condition, the
 *  three the assign list's own rows lead with, so a tile before and after being worked through
 *  describes its copy the same way. */
function ConsumedIdentity({ item }: { item: NonNullable<ScanTileData["item"]> }) {
  const numbers = item.catalogNumbers.join(" · ");
  return (
    <p style={{ margin: "0.375rem 0 0", color: "var(--color-text-primary)" }}>
      {numbers && <strong>{numbers}</strong>}
      {numbers && item.stampName ? " — " : ""}
      {item.stampName ?? (numbers ? "" : "Unnamed stamp")}
      <span style={{ color: "var(--color-text-muted)" }}> · {item.conditionAbbreviation}</span>
    </p>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>{children}</p>
  );
}
