import type { IntakeGroupAxis } from "@/lib/intake-groups";
import type { IntakeWriteTouched } from "@/lib/lots";
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
