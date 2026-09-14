// Which references a comparison can switch between (#1005): the photos of the stamp under
// consideration **and of every stamp beneath it** — the forgeries among them, since a forgery is a
// non-variant child of the stamp it imitates (ADR-0049 §1) and a reference hangs where it belongs
// (§3). Nothing new labels a forgery: the tree position and the subtype chip already say it.
//
// Pure and structural over the issue tree's own rows (`StampNodeData` has the fields), so the
// ordering — which is what makes stepping from one reference to the next read as walking the tree —
// is a unit test.

export interface ReferenceTreeRow<P> {
  stampId: string;
  parentId: string | null;
  photos: readonly P[];
}

/** One stamp in the comparison's list: the row, how deep it sits under the stamp it was reached
 * from, and that stamp. */
export interface ReferenceCandidate<R> {
  row: R;
  depth: number;
  rootStampId: string;
}

/**
 * Each stamp under consideration followed by its descendants, depth first, siblings in the order the
 * issue tree lists them.
 *
 * A stamp is listed **once**: two shortlisted stamps where one is a variant of the other would
 * otherwise put the child's references in the list twice, and stepping through them would land on
 * the same picture two presses apart. A root that turns out to sit under an earlier root is therefore
 * skipped where it would have repeated; one that is not in the rows at all is skipped too, having
 * nothing to show.
 */
export function referenceCandidates<R extends ReferenceTreeRow<unknown>>(
  rows: readonly R[],
  rootStampIds: readonly string[]
): ReferenceCandidate<R>[] {
  const byId = new Map(rows.map((r) => [r.stampId, r]));
  const children = new Map<string, R[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = children.get(row.parentId);
    if (list) list.push(row);
    else children.set(row.parentId, [row]);
  }

  const out: ReferenceCandidate<R>[] = [];
  const seen = new Set<string>();
  const walk = (row: R, depth: number, rootStampId: string) => {
    if (seen.has(row.stampId)) return;
    seen.add(row.stampId);
    out.push({ row, depth, rootStampId });
    for (const child of children.get(row.stampId) ?? []) walk(child, depth + 1, rootStampId);
  };
  for (const id of rootStampIds) {
    const root = byId.get(id);
    if (root) walk(root, 0, id);
  }
  return out;
}

/**
 * The reference a comparison opens on for a stamp: its own first photo, or failing that the first
 * photo found beneath it in list order — a base stamp with no picture of its own is usually compared
 * through its variants' pictures. Null when nothing under it has a photo at all.
 */
export function firstReferenceFor<R extends ReferenceTreeRow<unknown>>(
  candidates: readonly ReferenceCandidate<R>[],
  stampId: string
): R["photos"][number] | null {
  const start = candidates.findIndex((c) => c.row.stampId === stampId);
  if (start < 0) return null;
  const depth = candidates[start].depth;
  for (let i = start; i < candidates.length; i++) {
    if (i > start && candidates[i].depth <= depth) break;
    const photo = candidates[i].row.photos[0];
    if (photo !== undefined) return photo;
  }
  return null;
}

/** Every reference photo in list order — what stepping to the previous or next reference walks. */
export function referencePhotos<R extends ReferenceTreeRow<unknown>>(
  candidates: readonly ReferenceCandidate<R>[]
): { photo: R["photos"][number]; stampId: string }[] {
  return candidates.flatMap((c) => c.row.photos.map((photo) => ({ photo, stampId: c.row.stampId })));
}
