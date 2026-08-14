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
