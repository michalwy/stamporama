/**
 * The address and list arithmetic of a list-beside-detail page (#1471; ADR-0059 §5), kept apart
 * from the components so it can be tested without rendering anything.
 */

/** What `&row=` holds while a row is being added rather than edited. */
export const NEW_ROW = "new";

/**
 * What the detail pane shows, read from `&row=`: nothing chosen, a row being added — under a
 * parent, where the list is a tree (a catalog name under its vendor) — or an existing row.
 */
export type RowSelection =
  | { kind: "none" }
  | { kind: "new"; parentId: string | null }
  | { kind: "row"; id: string };

/** The `&row=` value for adding a row, under `parentId` where the list is a tree. */
export function newRowKey(parentId?: string | null): string {
  return parentId ? `${NEW_ROW}:${parentId}` : NEW_ROW;
}

export function parseRowKey(key: string | null | undefined): RowSelection {
  if (!key) return { kind: "none" };
  if (key === NEW_ROW) return { kind: "new", parentId: null };
  if (key.startsWith(`${NEW_ROW}:`)) {
    const parentId = key.slice(NEW_ROW.length + 1);
    return parentId ? { kind: "new", parentId } : { kind: "new", parentId: null };
  }
  return { kind: "row", id: key };
}

/**
 * The row the detail pane edits. **Nothing chosen opens the first row** — the page's default, left
 * out of the address like every other default (ADR-0059 §7) — and so does a row that is gone (a
 * stale bookmark, a row deleted in another tab): a pane saying *not found* would be a dead end for a
 * question the list beside it already answers.
 */
export function currentRow<T extends { id: string }>(
  items: readonly T[],
  selection: RowSelection
): T | null {
  if (selection.kind === "new") return null;
  const chosen = selection.kind === "row" ? items.find((i) => i.id === selection.id) : undefined;
  return chosen ?? items[0] ?? null;
}

/** The list with the row at `from` moved to `to` — a drag's optimistic order. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The row an add created: the first id in `after` that was not in `before`. The actions answer a
 * create with a bare *success*, so the new row is recognised when the refreshed list arrives with
 * it, and the pane moves onto it — the collector sees what they saved, ready for the next change.
 */
export function createdId(before: ReadonlySet<string>, after: readonly string[]): string | null {
  return after.find((id) => !before.has(id)) ?? null;
}
