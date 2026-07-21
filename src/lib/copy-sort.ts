import type { ItemListItem } from "./items";

// Copy-list sorting shared by the purchase-order lot view (#157), the sale-lot composition
// view (#164), and the server-side lot-intake pagination (#172) so every path orders copies
// identically. Sorts on the same fields the rows show. Pure (no React / Prisma) so it runs
// on both the client and the server.

/** The primary-vendor catalog number of a copy (falling back to any recorded number), or null.
 * Used as the "by catalog number" sort key. */
export function primaryCatalogNumber(
  item: ItemListItem,
  primaryVendorByArea: Map<string, string | null>
): string | null {
  const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
  const cn =
    item.catalogNumbers.find((c) => c.catalogVendorId === primaryVendorId) ??
    item.catalogNumbers[0] ??
    null;
  return cn ? cn.number : null;
}

// Natural (numeric-aware) collation so catalog numbers order 1, 2, 10 — not 1, 10, 2 (#157).
const COPY_SORT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The copy sort keys the toolbar offers, in display order. */
export const COPY_SORT_KEYS = ["added", "year", "catalog", "price", "name"] as const;
export type CopySortKey = (typeof COPY_SORT_KEYS)[number];

export const COPY_SORT_LABELS: Record<CopySortKey, string> = {
  added: "Order added",
  year: "Year",
  catalog: "Catalog no.",
  price: "Price",
  name: "Name",
};

/**
 * Sort a lot's copies for display (#157). "added" keeps the incoming (creation) order; the
 * other keys sort on the same fields the rows show — year, catalog number, catalog value, or
 * stamp name. Copies missing the sort field (no year / no catalog number / uncertain value /
 * no name) always sort last, regardless of direction, so blanks never lead. Stable: equal keys
 * keep their incoming order.
 */
export function sortCopies(
  items: ItemListItem[],
  sortKey: string,
  sortDir: string,
  primaryVendorByArea: Map<string, string | null>
): ItemListItem[] {
  if (sortKey === "added") return sortDir === "desc" ? [...items].reverse() : items;
  const dir = sortDir === "desc" ? -1 : 1;
  const yearOf = (it: ItemListItem) => it.issuedYear ?? it.issueYear ?? null;
  const nameOf = (it: ItemListItem) => it.stampName ?? it.issueName ?? "";
  const numCmp = (a: number | null, b: number | null) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1; // blanks last, both directions
    if (b == null) return -1;
    return (a - b) * dir;
  };
  const strCmp = (a: string, b: string) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return COPY_SORT_COLLATOR.compare(a, b) * dir;
  };
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "year") cmp = numCmp(yearOf(a.it), yearOf(b.it));
      else if (sortKey === "price") cmp = numCmp(a.it.value.baseAmount, b.it.value.baseAmount);
      else if (sortKey === "name") cmp = strCmp(nameOf(a.it), nameOf(b.it));
      else if (sortKey === "catalog")
        cmp = strCmp(
          primaryCatalogNumber(a.it, primaryVendorByArea) ?? "",
          primaryCatalogNumber(b.it, primaryVendorByArea) ?? ""
        );
      if (cmp === 0) cmp = a.i - b.i; // stable tiebreak on incoming order
      return cmp;
    })
    .map((d) => d.it);
}
