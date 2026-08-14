"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  commitCut,
  deleteBatch,
  pairTilesManually,
  recutBatch,
  type CutReport,
} from "@/lib/scan-sheets";
import {
  assignTileToCopy,
  discardTile,
  identifyTileAsNewCopy,
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
  lotId: string,
  batchNo: number
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await recutBatch(session.user.id, lotId, batchNo);
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
 * Identify a tile into a **new copy** — the stockbook path, and ordinary intake entered from a
 * tile instead of from a stamp picker.
 *
 * `FormData` rather than a JSON argument because it is the very form the lot's condition dialog
 * already submits to `intakeStampsAction`: same fields, same remembered choices, one shape.
 * Deliberately **no** `photoChangeSet` — the tile's crops are this copy's front and back.
 */
export async function identifyTileAction(
  tileId: string,
  formData: FormData
): Promise<TileOutcomeActionState> {
  const session = await getSession();
  const str = (name: string): string | null => {
    const v = formData.get(name);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const stampId = str("stampId");
  if (!stampId) return { status: "error", message: "Select a stamp to identify this tile as." };
  const conditionId = str("conditionId");
  if (!conditionId) return { status: "error", message: "A condition must be selected." };
  try {
    const outcome = await identifyTileAsNewCopy(session.user.id, tileId, {
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
    return { status: "success", ...outcome };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to identify the tile. Please try again.",
    };
  }
}

/** Give a tile's images to a copy already on the lot — the auction path, where settlement has
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
  lotId: string,
  batchNo: number
): Promise<ScanActionState> {
  const session = await getSession();
  try {
    await deleteBatch(session.user.id, lotId, batchNo);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to delete the batch. Please try again.",
    };
  }
}
