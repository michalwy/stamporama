"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  commitCut,
  deleteBatch,
  pairTilesManually,
  proposeCut,
  recutBatch,
  setBatchLabel,
  unpairTileBack,
  type CutReport,
} from "@/lib/scan-sheets";
import {
  addTileCandidate,
  assignTileToCopy,
  discardTiles,
  identifyTilesAsNewCopies,
  noteTile,
  parkTiles,
  reidentifyTileCopy,
  removeTileCandidate,
  returnTilesToQueue,
} from "@/lib/scan-tiles";
import type { Box } from "@/lib/scan-boxes";
import type { ScanOwnerRef } from "@/lib/scan-sheets";

// Scan sheet ingest actions (#566, ADR-0033). JSON-shaped, like everything else under
// `src/app/actions/`; the one binary boundary — uploading the scan itself — is a route handler
// (ADR-0011's rule, unchanged).
//
// The batch-level verbs take a `ScanOwnerRef` rather than a purchase id (#725), because a card can
// belong to an order or to nothing but the collection. The tile-level ones take tile ids and are
// unchanged: a tile carries its own owner, and the server reads it rather than believing a caller.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export type ScanActionState =
  | { status: "success" }
  | { status: "error"; message: string };

/** A committed cut answers with what it did, not merely that it worked: a count mismatch between
 * the two sides is a **signal** the collector needs to see — a stamp fell out, two regions were
 * drawn as one, or the wrong file was uploaded — and the review step is where it gets fixed. */
export type CommitCutActionState =
  | { status: "success"; report: CutReport }
  | { status: "error"; message: string };

/** Turn the reviewed boxes into tiles. Nothing exists until this call, which is what makes the
 * whole review free to be wrong. */
export async function commitCutAction(
  sheetId: string,
  boxes: Box[]
): Promise<CommitCutActionState> {
  const session = await getSession();
  try {
    return { status: "success", report: await commitCut(session.user.id, sheetId, boxes) };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to cut the scan. Please try again.",
    };
  }
}

/**
 * Propose the cut for a scan that has not been cut yet (#574): the boxes the editor opens on
 * instead of an empty card.
 *
 * **It cannot fail loudly.** A scan detection could not read, or found nothing on, still opens the
 * editor — on an empty canvas, exactly as before this existed. Drawing the boxes by hand is the
 * primitive and stays a guaranteed path; a proposal is a saving on it, so a failure here costs the
 * collector the saving and nothing else. An error banner over a card that can still be cut would be
 * telling them about a problem they have no move to make about.
 */
export async function proposeCutAction(sheetId: string): Promise<{ boxes: Box[] }> {
  const session = await getSession();
  try {
    return { boxes: await proposeCut(session.user.id, sheetId) };
  } catch {
    return { boxes: [] };
  }
}

/** Drop a back-only tile's image onto a front tile — the sparse-case pairing, done by dragging. */
export async function pairTilesAction(
  backTileId: string,
  frontTileId: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await pairTilesManually(session.user.id, backTileId, frontTileId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to pair the tiles. Please try again.",
    };
  }
}

/**
 * Take a back off the tile it is paired to (#648) — it goes back to the batch's unpaired backs,
 * where the same drag puts it on the right tile.
 *
 * The way out of a mis-pairing that used to cost the whole batch: nothing else about the card
 * moves, and every tile already identified beside it stays exactly as it is.
 */
export async function unpairTileBackAction(tileId: string): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await unpairTileBack(session.user.id, tileId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to unpair the back. Please try again.",
    };
  }
}

/** Throw away a batch's tiles, keeping its scans, so the cut can be drawn again. Refused once a
 * tile has become a copy — see `recutBatch`. */
export async function recutBatchAction(
  owner: ScanOwnerRef,
  batchNo: number
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await recutBatch(session.user.id, owner, batchNo);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to re-cut the batch. Please try again.",
    };
  }
}

// ── Identifying a tile (#567) ─────────────────────────────────────────────────────────────────

/** A tile that became a copy answers with which one, so the screen can name it instead of saying
 * only that something happened. */
export type TileOutcomeActionState =
  | { status: "success"; itemId: string; itemNo: number }
  | { status: "error"; message: string };

/**
 * The same, for a pass over several tiles (#596): one copy per tile, in the order the pieces are
 * laid out on the card.
 *
 * `outcomes` and deliberately **not** `copies`: the purchase screen's shared `run` reads a `copies`
 * field as the want review's `ArrivingCopy[]` (#532), and a differently-shaped list under that name
 * would be handed to it silently. Tile intake raises no want review today, and this is not the
 * change that should start one by accident.
 */
export type TilesOutcomeActionState =
  | { status: "success"; outcomes: { itemId: string; itemNo: number }[] }
  | { status: "error"; message: string };

/**
 * Identify one or several tiles into **new copies** — the stockbook path, and ordinary intake
 * entered from a tile instead of from a stamp picker.
 *
 * `FormData` rather than a JSON argument because it is the very form the condition dialog already
 * submits to `intakeStampsAction`: same fields, same remembered choices, one shape — `lotId`
 * included, which since #586 is one more remembered intake answer rather than something the sheet
 * carried. Deliberately **no** `photoChangeSet` — a tile's crops are its own copy's front and back.
 *
 * **A list of tiles, not one** (#596): ticking several on the strip asserts they are the same stamp
 * in the same condition, so the step is answered once and each tile becomes its own copy with its
 * own images. One tile is a list of one, so there is a single door rather than two that could drift.
 */
export async function identifyTilesAction(
  tileIds: string[],
  formData: FormData
): Promise<TilesOutcomeActionState> {
  const session = await getSession();
  const str = (name: string): string | null => {
    const v = formData.get(name);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const stampId = str("stampId");
  if (!stampId) {
    return {
      status: "error",
      message:
        tileIds.length === 1
          ? "Select a stamp to identify this tile as."
          : "Select a stamp to identify these tiles as.",
    };
  }
  const conditionId = str("conditionId");
  if (!conditionId) return { status: "error", message: "A condition must be selected." };
  try {
    const copies = await identifyTilesAsNewCopies(session.user.id, tileIds, {
      // Which lot the created copies belong to (#586). Absent is a complete answer on a purchase
      // with one lot, which is the stockbook case and must keep asking nothing.
      lotId: str("lotId"),
      stampId,
      conditionId,
      certificateStatusId: str("certificateStatusId"),
      locationId: str("locationId"),
      locationRef: str("locationRef"),
      formatId: str("formatId"),
      inCollection: formData.get("inCollection") === "true",
      forSale: formData.get("forSale") === "true",
      forTrade: formData.get("forTrade") === "true",
    });
    return { status: "success", outcomes: copies };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error
          ? e.message
          : tileIds.length === 1
            ? "Failed to identify the tile. Please try again."
            : "Failed to identify the tiles. Please try again.",
    };
  }
}

/** Give a tile's images to a copy already on the order — the auction path, where settlement has
 * already created identified copies that need photographs rather than identification. */
export async function assignTileAction(
  tileId: string,
  itemId: string
): Promise<TileOutcomeActionState> {
  const session = await getSession();
  try {
    const outcome = await assignTileToCopy(session.user.id, tileId, itemId);
    return { status: "success", ...outcome };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to assign the tile. Please try again.",
    };
  }
}

/**
 * Identify a consumed tile's copy **again** — the same form the identification submits, applied to
 * the copy that already exists instead of creating one.
 *
 * `FormData` for exactly the reason `identifyTilesAction` takes it: this is the very form the
 * condition dialog submits, reached through the very picker, so the correction and the
 * identification are one vocabulary rather than two. What it does **not** read is `lotId` — the copy
 * has a lot, and moving it between lots is a decision about money rather than about what the piece
 * is — nor a `photoChangeSet`, the tile's crops already being this copy's front and back.
 */
export async function reidentifyTileAction(
  tileId: string,
  formData: FormData
): Promise<ScanActionState> {
  const session = await getSession();
  const str = (name: string): string | null => {
    const v = formData.get(name);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const stampId = str("stampId");
  if (!stampId) return { status: "error", message: "Select the stamp this piece actually is." };
  const conditionId = str("conditionId");
  if (!conditionId) return { status: "error", message: "A condition must be selected." };
  try {
    await reidentifyTileCopy(session.user.id, tileId, {
      stampId,
      conditionId,
      certificateStatusId: str("certificateStatusId"),
      locationId: str("locationId"),
      locationRef: str("locationRef"),
      formatId: str("formatId"),
      inCollection: formData.get("inCollection") === "true",
      forSale: formData.get("forSale") === "true",
      forTrade: formData.get("forTrade") === "true",
    });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error ? e.message : "Failed to change the identification. Please try again.",
    };
  }
}

/**
 * Record that one or several tiles became nothing, and why. The images stay; the tiles leave the
 * unidentified count and survive the lot closing, because they are evidence rather than queue items.
 *
 * **A list, like every other outcome on this screen.** A card of junk is discarded a run at a time,
 * and one tile is a list of one so there is a single door rather than two that could drift.
 */
export async function discardTilesAction(
  tileIds: string[],
  note: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await discardTiles(session.user.id, tileIds, note);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error
          ? e.message
          : tileIds.length === 1
            ? "Failed to discard the tile. Please try again."
            : "Failed to discard the tiles. Please try again.",
    };
  }
}

/**
 * Set a tile aside as still to be identified (#597) — the piece a picture cannot settle.
 *
 * Acts immediately and takes whatever note there is, exactly as a discard does: what it costs to
 * park has to stay smaller than what parking saves, or the interruption it exists to prevent simply
 * moves into this button. The note is written or changed afterwards through `noteTileAction`.
 */
export async function parkTilesAction(
  tileIds: string[],
  note: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await parkTiles(session.user.id, tileIds, note);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error
          ? e.message
          : tileIds.length === 1
            ? "Failed to park the tile. Please try again."
            : "Failed to park the tiles. Please try again.",
    };
  }
}

/** Write or clear a discarded or parked tile's note. Neither outcome stops to ask for one — this is
 * where the tile that deserves a sentence gets it: what the parcel held, or what to check. */
export async function noteTileAction(
  tileId: string,
  note: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await noteTile(session.user.id, tileId, note);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the note. Please try again.",
    };
  }
}

/**
 * Add a stamp to a tile's shortlist of what it could be (#607) — the narrowing that discovering
 * *this cannot be identified from its picture* already required, kept instead of thrown away.
 *
 * Its own door rather than a field on `parkTileAction`, because a shortlist is built and pruned over
 * the whole life of the wait: one candidate now, another when the collector remembers the reprint,
 * two struck off when the lamp settles them.
 */
export async function addTileCandidateAction(
  tileIds: string[],
  stampId: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await addTileCandidate(session.user.id, tileIds, stampId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to add the candidate. Please try again.",
    };
  }
}

/** Take a possibility off a tile's shortlist — ruling one out is the ordinary progress of the work
 * parking exists for, so it costs exactly what adding it did. */
export async function removeTileCandidateAction(
  tileIds: string[],
  stampId: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await removeTileCandidate(session.user.id, tileIds, stampId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to remove the candidate. Please try again.",
    };
  }
}

/** Put a discarded or parked tile back in the queue — a mis-clicked discard undone, or a parked
 * piece whose answer is now known. */
export async function returnTilesToQueueAction(tileIds: string[]): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await returnTilesToQueue(session.user.id, tileIds);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message:
        e instanceof Error
          ? e.message
          : tileIds.length === 1
            ? "Failed to restore the tile. Please try again."
            : "Failed to restore the tiles. Please try again.",
    };
  }
}

/** Delete a batch outright: its tiles and its retained scans. */
export async function deleteBatchAction(
  owner: ScanOwnerRef,
  batchNo: number
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await deleteBatch(session.user.id, owner, batchNo);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to delete the batch. Please try again.",
    };
  }
}

/**
 * Name a card, or clear its name (#587).
 *
 * Its own action rather than a field on some other write, because the point of it is that it can be
 * done **afterwards** — a card often turns out to need naming only once a parcel has been left half
 * worked for a week and the strip of thumbnails is the only thing telling one from another.
 */
export async function setBatchLabelAction(
  owner: ScanOwnerRef,
  batchNo: number,
  label: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await setBatchLabel(session.user.id, owner, batchNo, label);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to name the card. Please try again.",
    };
  }
}
