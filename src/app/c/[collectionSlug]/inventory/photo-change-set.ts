// The photo editor's pending change-set, derived from its strip (#112, #137). Pure and outside the
// component so what a Save would send can be tested without rendering the editor — the strip is
// component state, the change-set is a function of it.

import type { PhotoChangeSet, PhotoRole } from "@/lib/photos";
import type { QuarterTurn } from "@/lib/tile-turn";

type SlotRole = Exclude<PhotoRole, null>;

/** One card on the strip, as far as the change-set is concerned. */
export interface ChangeSetEntry {
  source: "committed" | "staged";
  /** Committed photos carry their persisted id. */
  photoId?: string;
  /** Staged uploads carry their staging id once the upload finishes. */
  uploadId?: string;
  status: "uploading" | "done" | "error";
  role: SlotRole | null;
  title: string;
  /** Where the picture came from (#1001), as typed. Sent only by an editor that records it. */
  sourceUrl: string;
  turn: QuarterTurn;
}

/** A photo the owner already had when the editor opened. */
export interface CommittedOriginal {
  id: string;
  role: PhotoRole;
  title: string | null;
  sourceUrl?: string | null;
  sortOrder: number;
}

/** What Save would apply: adds of finished uploads, updates of committed photos whose role, title,
 * order — or, where `recordSource` is set, source — differ from what they opened with, and removals
 * of committed photos no longer on the strip. A strip position is the sort order.
 *
 * Without `recordSource` the source is never sent, so an editor that does not show it (a copy's)
 * cannot clear one by saving (#1001). */
export function derivePhotoChangeSet(
  entries: readonly ChangeSetEntry[],
  initialPhotos: readonly CommittedOriginal[],
  slots: readonly SlotRole[],
  recordSource: boolean
): PhotoChangeSet {
  const initialById = new Map(initialPhotos.map((p) => [p.id, p]));
  const presentCommittedIds = new Set(
    entries.filter((e) => e.source === "committed").map((e) => e.photoId!)
  );
  const remove = initialPhotos.map((p) => p.id).filter((id) => !presentCommittedIds.has(id));

  const add: PhotoChangeSet["add"] = [];
  const update: PhotoChangeSet["update"] = [];
  entries.forEach((e, index) => {
    const role = e.role;
    // Front/back are labelled by their role, so they don't carry a title.
    const title = role === null ? e.title.trim() || null : null;
    const sourceUrl = e.sourceUrl.trim() || null;
    const sortOrder = index;
    if (e.source === "staged") {
      if (e.status === "done" && e.uploadId) {
        add.push({
          uploadId: e.uploadId,
          role,
          title,
          sortOrder,
          turn: e.turn,
          ...(recordSource ? { sourceUrl } : {}),
        });
      }
      return;
    }
    const orig = initialById.get(e.photoId!);
    if (!orig) return;
    const origRole = orig.role !== null && slots.includes(orig.role) ? orig.role : null;
    const origTitle = origRole === null ? (orig.title?.trim() || null) : null;
    const sourceChanged = recordSource && (orig.sourceUrl?.trim() || null) !== sourceUrl;
    if (origRole !== role || origTitle !== title || orig.sortOrder !== sortOrder || sourceChanged) {
      update.push({
        photoId: e.photoId!,
        role,
        title,
        sortOrder,
        ...(recordSource ? { sourceUrl } : {}),
      });
    }
  });

  return { add, update, remove };
}
