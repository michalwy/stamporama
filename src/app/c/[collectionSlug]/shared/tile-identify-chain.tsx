"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampConditionData } from "@/lib/conditions";
import type { LocationData } from "@/lib/locations";
import {
  StampPickerBrowser,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import {
  pickedStampText,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import {
  IntakeConditionDialog,
  type IntakeConditionDialogProps,
  type PendingSelection,
} from "./intake-condition-dialog";
import { IdentifiedPieceAside, type IdentifiedPiece } from "./tile-zoom-view";
import type { ScanTileData } from "@/lib/scan-sheets";
import type { IdentifyHistoryAnswers } from "@/lib/tile-identify-history";
import type { TileStampPick } from "./tile-identify-dialog";

/**
 * The chain a **scan tile** is identified through (#567): the stamp picker, then the condition step,
 * and the write at the end of it — including a repeat off the identification history (#757, #595
 * before it) and *Identify again* (#584).
 *
 * It lived in `purchase-detail-panel.tsx` until #725, and the move is the point of the issue rather
 * than tidying beside it: the very same chain now runs from the collection's own card scans, where
 * there is no order and no lot. Two copies of it would have been two sets of remembered choices, two
 * places for a repeated identification to mean something slightly different, and two ends to keep in
 * step with `identifyTilesAction`.
 *
 * **The one thing the two screens differ in is `lotChoice`.** An order asks which lot the new copy
 * belongs to (#586); a card scanned outside any order asks nothing, because there is no lot — and
 * absent is the shape the condition step already had for *the lot is not in question*.
 *
 * The chain owns no writing. `run` is the caller's — the purchase screen's version refreshes the
 * order, invalidates its copy pages and raises the want review (#532) — so what happens after a
 * copy is created stays where the knowledge of it is.
 */

/**
 * A correction in flight: which tile is being identified again, and what its copy answers **now**.
 *
 * The prefill is built where the tile is — from `ScanTileData.item`, which the scans card already
 * holds — rather than fetched at the far end of the chain: it is the copy as the strip last read it,
 * and a second read three dialogs later would be a second answer to a question already in hand.
 * `stampId` rides along for the picker's *current* mark, so the tree says where the copy already
 * sits instead of leaving the collector to check it on the other side of the screen.
 */
interface TileCorrection {
  tileId: string;
  stampId: string;
  prefill: NonNullable<IntakeConditionDialogProps["prefill"]>;
}

/** Where the chain is and what it is carrying. Held by {@link useTileIdentifyChain} and handed
 * straight to {@link TileIdentifyChainDialogs}; the three fields a screen actually reads are the
 * handlers at the bottom, which are what `ScansCard` takes. */
export interface TileIdentifyChainState {
  tileStep: "none" | "picker" | "condition";
  setTileStep: (step: "none" | "picker" | "condition") => void;
  tileIntake: IdentifiedPiece[];
  setTileIntake: (pieces: IdentifiedPiece[]) => void;
  tileSelection: PendingSelection | null;
  setTileSelection: (selection: PendingSelection | null) => void;
  tileRepeat: IdentifyHistoryAnswers | null;
  setTileRepeat: (answers: IdentifyHistoryAnswers | null) => void;
  tileCorrection: TileCorrection | null;
  setTileCorrection: (correction: TileCorrection | null) => void;
  resetTileIntake: () => void;
  /** What `ScansCard.onIdentifyTiles` is given. */
  onIdentifyTiles: (pieces: IdentifiedPiece[], pick?: TileStampPick) => void;
  /** What `ScansCard.onReidentifyTile` is given. */
  onReidentifyTile: (piece: IdentifiedPiece, copy: NonNullable<ScanTileData["item"]>) => void;
  /** What `ScansCard.onRepeatIdentification` is given (#757) — a row of the history, pressed. */
  onRepeatIdentification: (answers: IdentifyHistoryAnswers, pieces: IdentifiedPiece[]) => void;
}

export function useTileIdentifyChain(input: {
  /** The screen's own error slot, cleared as the chain opens and moves. Shared rather than owned
   * here, because the write at the end is the caller's `run` and its refusal has to land in the
   * same place every other refusal on that screen does. */
  setError: (message: string | undefined) => void;
}): TileIdentifyChainState {
  const { setError } = input;
  /**
   * Identifying a scan tile into a **new copy** (#567), which since #586 is the order's job rather
   * than a lot card's — the card the tile came from belongs to the parcel, so the chain that turns
   * one of its tiles into a copy has to start here.
   *
   * It is the same picker → condition chain every other intake goes through, deliberately: a second
   * pair of those dialogs would be a second set of remembered choices. What rides with it is the
   * tile and, once the condition step asks it, **which lot** the copy belongs to — the one question
   * the re-parenting left to be answered at identification, where it is answerable at all.
   */
  const [tileStep, setTileStep] = useState<"none" | "picker" | "condition">("none");
  /**
   * The pieces this identification is about — one, or a whole run ticked on the strip (#596).
   *
   * A **list** rather than a piece, all the way down the chain, because with several ticked there is
   * no single piece the step is about and picking the first to stand for the rest is exactly the
   * mistake the aside exists to prevent. One tile is a list of one, so there is one path and not two.
   */
  const [tileIntake, setTileIntake] = useState<IdentifiedPiece[]>([]);
  const [tileSelection, setTileSelection] = useState<PendingSelection | null>(null);
  /**
   * The answers of the identification being **repeated** (#757), in the fields of the condition
   * step, for the tile they are being repeated onto. Non-null only on the repeat path — the
   * ordinary picker → condition chain must keep arriving at the remembered defaults and nothing
   * else.
   *
   * Nothing here remembers *which* identification is repeatable any more, and that is #757's whole
   * change: the history is the screen's consumed tiles, read from the same batches the strip draws,
   * so it survives the reload that #595's one-deep screen state did not — which is exactly the
   * sitting a half-worked card is returned to.
   */
  const [tileRepeat, setTileRepeat] = useState<IdentifyHistoryAnswers | null>(null);
  /**
   * The tile whose identification is being **corrected** — *Identify again* on a tile that already
   * became a copy. Null on every ordinary intake, and what it changes is only the chain's two ends:
   * the condition step opens on the copy's own answers instead of the remembered defaults, and the
   * submit re-answers that copy instead of creating one.
   *
   * The whole middle — the picker, the issue and stamp dialogs it can open, the condition step's own
   * fields, the catalogue value (#593), the piece beside all of them (#592) — is the identification's
   * unchanged. Being wrong about which stamp a piece is usually means being wrong about what was
   * read off it, so the correction has to be able to say everything the identification said; a
   * stamp-only re-point would have sent the collector to the copies list for the other half of the
   * same mistake.
   */
  const [tileCorrection, setTileCorrection] = useState<TileCorrection | null>(null);
  function resetTileIntake() {
    setTileStep("none");
    setTileIntake([]);
    setTileSelection(null);
    setTileRepeat(null);
    setTileCorrection(null);
    setError(undefined);
  }
  return {
    tileStep,
    setTileStep,
    tileIntake,
    setTileIntake,
    tileSelection,
    setTileSelection,
    tileRepeat,
    setTileRepeat,
    tileCorrection,
    setTileCorrection,
    resetTileIntake,
    onIdentifyTiles: (pieces, pick) => {
      setTileIntake(pieces);
      setTileRepeat(null);
      setError(undefined);
      if (pick) {
        // The stamp is already known (#607): a candidate pressed on a parked tile's shortlist, or
        // the parent offered in place of one. So the chain enters at the step the picker would have
        // led to — with **no** prefill, unlike a repeat off the history (#757): what has been
        // answered is the stamp and nothing else, and the condition, the format and the ref must
        // arrive at the ordinary remembered defaults rather than at another tile's answers.
        setTileSelection({ kind: "stamp", stampId: pick.stampId, label: pick.label });
        setTileStep("condition");
        return;
      }
      setTileStep("picker");
    },
    // *Identify again*: the same chain, over a tile that already became a copy. It enters at the
    // picker like an ordinary identification — the stamp is the answer being corrected, so it is
    // asked first — and what it carries is the copy's current answers, so the condition step opens
    // on what the copy *is* rather than on defaults remembered from another card.
    onReidentifyTile: (piece, copy) => {
      setTileIntake([piece]);
      setTileRepeat(null);
      setError(undefined);
      setTileCorrection({
        tileId: piece.tileId,
        stampId: copy.stampId,
        prefill: {
          conditionId: copy.conditionId,
          certificateStatusId: copy.certificateStatusId ?? "",
          formatId: copy.formatId ?? "",
          locationId: copy.locationId ?? "",
          locationRef: copy.locationRef ?? "",
          disposition: {
            inCollection: copy.inCollection,
            forSale: copy.forSale,
            forTrade: copy.forTrade,
          },
          // The lot is not asked on a correction — the copy has one, and moving it is a decision
          // about money rather than about what the piece is — so this is the field `lotChoice`
          // being absent leaves unread.
          lotId: "",
        },
      });
      setTileStep("picker");
    },
    // A row of the history, pressed (#757, #595 before it): the picker is skipped, because its
    // answer is the record being repeated, and the chain resumes at the step that would have
    // followed it — with the fields filled and the ordinary confirm still to press. Which row it
    // was is the caller's to know; the chain is handed the answers and nothing else.
    onRepeatIdentification: (answers, pieces) => {
      setTileIntake(pieces);
      setTileSelection({ kind: "stamp", stampId: answers.stampId, label: answers.label });
      setTileRepeat(answers);
      setTileCorrection(null);
      setError(undefined);
      setTileStep("condition");
    },
  };
}


export interface TileIdentifyChainDialogsProps {
  chain: TileIdentifyChainState;
  collectionId: string;
  areas: CollectionAreaData[];
  scanDpi: number;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  setError: (message: string | undefined) => void;
  /** The lot question (#586), or absent where there is none to ask — a purchase with one lot, and
   * every card that belongs to no order at all (#725). A correction never asks it whatever this
   * says; see the condition step below. */
  lotChoice?: IntakeConditionDialogProps["lotChoice"];
  /** The screen's own runner: what happens after a copy exists. The purchase screen refreshes the
   * order, invalidates its copy pages and raises the want review; the card-scans screen has none of
   * those to do and does the two that are common. */
  run: (
    fn: () => Promise<{ status: string; message?: string; id?: string }>,
    onDone?: (result: { status: string; message?: string; id?: string }) => void
  ) => void;
  /** Re-read the strip after a tile has become — or stopped being — a copy. Identifying touches
   * both namespaces: `run` invalidates the copies, and this is the scans half, without which the
   * strip keeps showing a tile that is already a copy. */
  onIdentified: () => void;
}

export function TileIdentifyChainDialogs({
  chain,
  collectionId,
  areas,
  scanDpi,
  conditions,
  certificateStatuses,
  locations,
  isPending,
  error,
  setError,
  lotChoice,
  run,
  onIdentified,
}: TileIdentifyChainDialogsProps) {
  const {
    tileStep,
    setTileStep,
    tileIntake,
    tileSelection,
    setTileSelection,
    tileRepeat,
    setTileRepeat,
    tileCorrection,
    resetTileIntake,
  } = chain;
  return (
    <>
      {/* Identifying a tile: pick the stamp (#567) */}
      {tileStep === "picker" && tileIntake.length > 0 && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          // The piece, for the whole of the identification and not only its first dialog (#592).
          // The picker passes it on to the issue and stamp dialogs it opens, which is the deepest
          // point of the chain and the one the collector reaches furthest from where they started.
          // With a run ticked (#596) it is all of them, small — one stamp is being picked for every
          // piece on screen, and this is where a wrong assertion is still free to be corrected.
          aside={
            <IdentifiedPieceAside
              collectionId={collectionId}
              pieces={tileIntake}
              scanDpi={scanDpi}
            />
          }
          asideWidth="26rem"
          // Correcting an identification, the stamp the copy is pointing at now is marked on its own
          // row: the tree is being read *against* that answer, and one that said nothing about where
          // the copy already sits sends the collector to check on the other side of the screen.
          // Pressing it is a complete answer — the condition and the rest may be what was wrong.
          marked={
            tileCorrection
              ? {
                  stampIds: new Set([tileCorrection.stampId]),
                  label: "current",
                  hint: "What this copy is identified as now",
                }
              : undefined
          }
          onPick={(picked: PickedStamp) => {
            setTileSelection({
              kind: "stamp",
              stampId: picked.stampId,
              label: pickedStampText(picked),
            });
            setError(undefined);
            setTileStep("condition");
          }}
          // A tile is one piece — one region of one card — so a whole-checklist expansion has
          // nothing to attach its images to. Omitted rather than refused: the picker only draws the
          // "add this whole set" buttons when it is given somewhere to send them, so entering from
          // a tile simply never offers the answer that could not work.
          onClose={resetTileIntake}
        />
      )}

      {/* …then its condition, its lot, and everything else intake asks */}
      {tileStep === "condition" && tileIntake.length > 0 && tileSelection && (
        <IntakeConditionDialog
          selection={tileSelection}
          collectionId={collectionId}
          scanDpi={scanDpi}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          locations={locations}
          isPending={isPending}
          error={error}
          // The tile's crops **are** this copy's front and back, so the uploader is out of the way:
          // a second front would collide with the copy's one front slot.
          hidePhotos
          // *Used or mint?* is read off the piece, and gum and hinge marks are on its back — so the
          // piece is beside the field asking, both sides, at the size the tile dialog showed it
          // (#592). Only here: the two other entries into this dialog have no picture of the piece.
          // Several pieces (#596) are all shown, which is where the collector's assertion that they
          // are one stamp in one condition gets its last look before it becomes N copies.
          pieces={tileIntake}
          // What is about to exist, said before anything is created — the rule every bulk action on
          // this screen follows.
          copyCount={tileIntake.length}
          submitLabel={
            tileCorrection
              ? // Never *Identify the tile*: nothing is created here, and a correction that read
                // like an intake would leave the collector wondering whether they now hold two
                // copies of the piece in their tweezers.
                "Save the identification"
              : tileIntake.length === 1
                ? "Identify the tile"
                : `Identify ${tileIntake.length} tiles`
          }
          // A repeat off the history (#757) arrives here with another tile's answers rather than
          // through the picker. Null on every other route in, which is what keeps this an action and
          // not a default.
          prefill={tileCorrection ? tileCorrection.prefill : (tileRepeat ?? undefined)}
          // The one question #586 left to identification. Only the order's **open** lots, since a
          // closed one takes no new copy at all (ADR-0009 §3) and offering it would be offering a
          // refusal.
          // **Not asked on a correction.** The copy already belongs to a lot and takes its cost
          // basis from it (ADR-0009 §3), so which lot it is on is a question about money rather
          // than about what the piece is — and the identification is what is being corrected here.
          // Offering the question would also mean quietly moving a copy off a closed lot, since
          // only open ones can be offered. Absent is the shape this dialog already has for *the lot
          // is not in question* — the stockbook case, and every card that belongs to no order at
          // all (#725).
          lotChoice={tileCorrection ? undefined : lotChoice}
          onBack={() => {
            if (!isPending) {
              setError(undefined);
              // Backing out of a repeat retires it (#595). *Back* from here is the collector saying
              // this tile is **not** the same as the last, so the stamp they pick next must arrive
              // at the ordinary remembered defaults — a format left standing from the previous tile
              // would be exactly the inherited value #573 refused.
              setTileRepeat(null);
              setTileStep("picker");
            }
          }}
          onClose={resetTileIntake}
          onSubmit={(fd) => {
            setError(undefined);
            if (tileSelection.kind === "stamp") fd.set("stampId", tileSelection.stampId);
            // Every ticked tile, in card order — the order the copies are created and numbered in
            // (#596). Each one is handed its own tile's images by the write; nothing here is shared
            // between them but the answers on this form.
            const tileIds = tileIntake.map((p) => p.tileId);
            const correction = tileCorrection;
            run(
              async () => {
                const scans = await import("@/app/actions/scans");
                // The same form either way, and the only thing that differs is what it lands on: a
                // correction re-answers the copy the tile already became, an identification creates
                // one. Both consume the same fields, which is what keeps the two one vocabulary.
                const r = correction
                  ? await scans.reidentifyTileAction(correction.tileId, fd)
                  : await scans.identifyTilesAction(tileIds, fd);
                if (r.status === "error") setError(r.message);
                // Identifying a tile touches **both** — it creates a copy *and* consumes the tile —
                // so both namespaces are re-read: the shared runner invalidates the copies, and this
                // adds the scans, without which the strip keeps showing a tile that is already a
                // copy. (`shared/scans-card.tsx` states the rule the other outcomes follow.) A
                // correction touches both for the same reason: the copy changed, and the tile's
                // square is what says what it became.
                else void onIdentified();
                return r;
              },
              () => {
                // Nothing is recorded here for the *next* tile to repeat (#757). What can be
                // repeated is the screen's own consumed tiles, re-read by `onIdentified` above — so
                // an intake the server refused leaves no offer behind, without this end having to
                // know it, and a correction is simply not an identification the history lists.
                resetTileIntake();
              }
            );
          }}
        />
      )}
    </>
  );
}
