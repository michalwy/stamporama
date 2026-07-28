// Re-export the shared copy-sort logic, which now lives in `@/lib/copy-sort` so the
// server-side lot-intake pagination (#172) can order copies identically to the client.
export {
  primaryCatalogNumber,
  sortCopies,
  sortSortableCopies,
  COPY_SORT_KEYS,
  COPY_SORT_LABELS,
  type CopySortKey,
  type SortableCopy,
} from "@/lib/copy-sort";
