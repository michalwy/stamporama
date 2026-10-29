import { inCollectionForDelivery } from "@/lib/delivery-state";
import type { IntakeGroupAxis, IntakeGroupNode } from "@/lib/intake-groups";
import type { ItemListItem } from "@/lib/items";
import type { IntakeWriteTouched, LotCopyRowFields } from "@/lib/lots";
import type {
  IntakeFilterParams,
  LotCopiesParams,
  OrderFilterParams,
} from "./use-lot-copies-query";

/**
 * The order screen's copy reads, by what they are about. The third segment says which: a lot id
 * for one lot's reads, `"purchase"` for the whole order's, `"selection-count"` for the bar and
 * `"selection-refs"` for the Store dialog's figure strip (#1535). The fourth says what of it —
 * `list`, `summary`, `return`, `completeness`.
 */
export const lotCopiesKeys = {
  all: (collectionId: string) => ["lot-copies", collectionId] as const,
  lot: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId] as const,
  list: (collectionId: string, lotId: string, params: LotCopiesParams) =>
    ["lot-copies", collectionId, lotId, "list", params] as const,
  summary: (
    collectionId: string,
    lotId: string,
    filters: IntakeFilterParams,
    groupBy: readonly IntakeGroupAxis[]
  ) => ["lot-copies", collectionId, lotId, "summary", filters, groupBy] as const,
  purchaseList: (collectionId: string, purchaseId: string, params: LotCopiesParams) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "list", params] as const,
  purchaseSummary: (
    collectionId: string,
    purchaseId: string,
    filters: OrderFilterParams,
    groupBy: readonly IntakeGroupAxis[]
  ) => ["lot-copies", collectionId, "purchase", purchaseId, "summary", filters, groupBy] as const,
  purchaseReturn: (collectionId: string, purchaseId: string) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "return"] as const,
  lotReturn: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId, "return"] as const,
  completeness: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId, "completeness"] as const,
  purchaseCompleteness: (collectionId: string, purchaseId: string) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "completeness"] as const,
};

/**
 * What a write on the order screen touched (#1409), handed back with its result so the screen
 * re-reads that and nothing more. A write that hands back none is re-read in full, which is right
 * for the order-level ones and a safe answer for any write nobody has described.
 */
export interface IntakeWriteScope extends IntakeWriteTouched {
  /** The order's own figures moved — a lot's status, price or copy count, the issues its copies
   *  fall under, its tiles — so the server render is re-read as well. */
  orderChanged?: boolean;
  /** The written copy's row was set in place (#2262), so no list of copies is read again — see
   *  `staleAfterCopyEdit`. */
  rowPatched?: boolean;
}

/** The segments a lot's own reads are never keyed under — everything else in that place is a lot. */
const NOT_A_LOT = new Set(["purchase", "selection-count", "selection-refs"]);

/**
 * Whether a write leaves this query stale (#1409). `touchedLotIds` is what the write touched, or
 * null when it cannot say — an order-level write — and then everything is.
 *
 * **A lot the write did not touch keeps its header.** Every lot card reads its own summary, open or
 * collapsed, so re-reading every lot's after each write made a one-lot operation cost as many reads
 * as the order has lots. A lot's summary and its return are made of its own copies only, so an
 * untouched lot's cannot have moved.
 *
 * **The order's own reads always go** — its bar, its chips, its flat list are made of every lot,
 * the touched one included — and so do the selection's count and its tally of refs.
 *
 * **An open card's rows go too, touched or not**, because a row speaks about more than its own
 * copy: the want marker counts the other copies of the stamp, wherever they sit, and the set
 * completeness counts the checklist's for-sale copies across the collection. Those two reads only
 * run while a card is open, so this costs what the collector has open, never what the order holds.
 */
export function staleAfterWrite(
  queryKey: readonly unknown[],
  collectionId: string,
  touchedLotIds: ReadonlySet<string> | null
): boolean {
  if (queryKey[0] !== "lot-copies" || queryKey[1] !== collectionId) return false;
  if (touchedLotIds === null) return true;
  const about = queryKey[2];
  if (typeof about !== "string" || NOT_A_LOT.has(about)) return true;
  if (touchedLotIds.has(about)) return true;
  const what = queryKey[3];
  return what === "list" || what === "completeness";
}

/** What a copy's own row edits change (#2262): its disposition flags, its delivery state, and
 *  where it is filed — the edits made from the row without opening the copy. */
export type CopyRowChanges = Partial<
  Pick<LotCopyRowFields, "inCollection" | "forSale" | "forTrade" | "deliveryState" | "locationId">
>;

/**
 * How a copy's row reads once a row edit has landed (#2262), so the row can say so the moment it is
 * clicked rather than after the save. The write's own rules, restated: a pre-arrival delivery state
 * takes the copy out of the collection, an explicit flag wins over that, and clearing the location
 * clears the ref with it.
 */
export function copyRowPatch(changes: CopyRowChanges): Partial<LotCopyRowFields> {
  const patch: Partial<LotCopyRowFields> = {};
  if (changes.deliveryState !== undefined) {
    patch.deliveryState = changes.deliveryState;
    const inCollection = inCollectionForDelivery(changes.deliveryState);
    if (inCollection !== undefined) patch.inCollection = inCollection;
  }
  if (changes.inCollection !== undefined) patch.inCollection = changes.inCollection;
  if (changes.forSale !== undefined) patch.forSale = changes.forSale;
  if (changes.forTrade !== undefined) patch.forTrade = changes.forTrade;
  if (changes.locationId !== undefined) {
    patch.locationId = changes.locationId;
    if (changes.locationId === null) patch.locationRef = null;
  }
  return patch;
}

/** What a patch's fields read on the copy before it — what a failed save puts back. */
export function copyRowUndo(
  item: LotCopyRowFields,
  patch: Partial<LotCopyRowFields>
): Partial<LotCopyRowFields> {
  const undo: Partial<LotCopyRowFields> = {};
  for (const key of Object.keys(patch) as (keyof LotCopyRowFields)[]) {
    (undo as Record<string, unknown>)[key] = item[key];
  }
  return undo;
}

/** A paged copy list with one copy's row fields set, or the same object when the copy is not in it
 *  — so a list that does not hold the copy is not handed to its observers as changed. */
export function patchCopyInPages<T extends { pages: { items: ItemListItem[] }[] }>(
  data: T | undefined,
  itemId: string,
  patch: Partial<LotCopyRowFields>
): T | undefined {
  if (!data) return data;
  let found = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((it) => it.id === itemId)) return page;
    found = true;
    return {
      ...page,
      items: page.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    };
  });
  return found ? { ...data, pages } : data;
}

/**
 * What a copy's own row edit leaves stale (#2262) — narrower than {@link staleAfterWrite}, because
 * the row has already been set in place:
 *
 * - **`keep`** — every list of copies, the copy's own lot's included. Re-reading a lot of 4,000
 *   copies, every page the collector has scrolled through, was what made one click cost seconds;
 *   and a copy the change takes out of the list's filters stays in view until the list is next read,
 *   rather than vanishing under the cursor. Another lot's header too, as after any write on one lot.
 * - **`summary`** — the copy's lot's summaries and the order's: its counts follow the change, and
 *   its headings are re-read without dropping the one the copy sits under (`keepVanishedGroups`).
 * - **`stale`** — the rest of the copy's lot and of the order (return, completeness), the selection's
 *   count and refs, and every open card's completeness, which counts for-sale copies collection-wide.
 */
export function staleAfterCopyEdit(
  queryKey: readonly unknown[],
  collectionId: string,
  lotIds: ReadonlySet<string>
): "keep" | "summary" | "stale" {
  if (queryKey[0] !== "lot-copies" || queryKey[1] !== collectionId) return "keep";
  const about = queryKey[2];
  if (about === "purchase") {
    const what = queryKey[4];
    return what === "list" ? "keep" : what === "summary" ? "summary" : "stale";
  }
  if (typeof about !== "string" || NOT_A_LOT.has(about)) return "stale";
  const what = queryKey[3];
  if (what === "list") return "keep";
  if (lotIds.has(about)) return what === "summary" ? "summary" : "stale";
  return what === "completeness" ? "stale" : "keep";
}

/**
 * A summary's headings re-read after a row edit (#2262), with every heading the new read dropped
 * put back where it stood, holding no copies. A heading is dropped when the filters leave nothing
 * under it — the last *For sale* copy of an issue, under the *For sale* chip, cleared — and its rows
 * would go with it, under the cursor. Kept, the copy stays in view until the list is next read, as
 * it does in a flat list. The same array when nothing was dropped, so an unchanged read is not a
 * change.
 */
export function keepVanishedGroups(
  prev: readonly IntakeGroupNode[],
  next: IntakeGroupNode[]
): IntakeGroupNode[] {
  const prevByPath = new Map(prev.map((n) => [n.path, n]));
  const nextPaths = new Set(next.map((n) => n.path));
  // Each dropped heading rides after the heading that stood before it and is still there.
  const after = new Map<string, IntakeGroupNode[]>();
  let anchor = "";
  for (const node of prev) {
    if (nextPaths.has(node.path)) {
      anchor = node.path;
      continue;
    }
    after.set(anchor, [...(after.get(anchor) ?? []), emptied(node)]);
  }
  let changed = after.size > 0;
  const out: IntakeGroupNode[] = [...(after.get("") ?? [])];
  for (const node of next) {
    const before = prevByPath.get(node.path);
    const children = before ? keepVanishedGroups(before.children, node.children) : node.children;
    if (children !== node.children) changed = true;
    out.push(children === node.children ? node : { ...node, children });
    out.push(...(after.get(node.path) ?? []));
  }
  return changed ? out : next;
}

function emptied(node: IntakeGroupNode): IntakeGroupNode {
  return { ...node, count: 0, openCount: 0, children: node.children.map(emptied) };
}
