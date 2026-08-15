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
  type CutReport,
} from "@/lib/scan-sheets";
import {
  assignTileToCopy,
  discardTile,
  identifyTilesAsNewCopies,
  noteDiscardedTile,
  undiscardTile,
} from "@/lib/scan-tiles";
import type { Box } from "@/lib/scan-boxes";

// Scan sheet ingest actions (#566, ADR-0033). JSON-shaped, like everything else under
// `src/app/actions/`; the one binary boundary — uploading the scan itself — is a route handler
// (ADR-0011's rule, unchanged).

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

/** Throw away a batch's tiles, keeping its scans, so the cut can be drawn again. Refused once a
 * tile has become a copy — see `recutBatch`. */
export async function recutBatchAction(
  purchaseId: string,
  batchNo: number
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await recutBatch(session.user.id, purchaseId, batchNo);
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

/** Record that a tile became nothing, and why. The image stays; the tile leaves the unidentified
 * count and survives the lot closing, because it is evidence rather than a queue item. */
export async function discardTileAction(
  tileId: string,
  note: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await discardTile(session.user.id, tileId, note);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to discard the tile. Please try again.",
    };
  }
}

/** Write or clear a discarded tile's note. Discarding itself asks for nothing — this is where the
 * rare tile that deserves a sentence gets one, afterwards. */
export async function noteTileAction(
  tileId: string,
  note: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await noteDiscardedTile(session.user.id, tileId, note);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the note. Please try again.",
    };
  }
}

/** Put a discarded tile back in the queue. */
export async function undiscardTileAction(tileId: string): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await undiscardTile(session.user.id, tileId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to restore the tile. Please try again.",
    };
  }
}

/** Delete a batch outright: its tiles and its retained scans. */
export async function deleteBatchAction(
  purchaseId: string,
  batchNo: number
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await deleteBatch(session.user.id, purchaseId, batchNo);
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
  purchaseId: string,
  batchNo: number,
  label: string
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await setBatchLabel(session.user.id, purchaseId, batchNo, label);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to name the card. Please try again.",
    };
  }
}
