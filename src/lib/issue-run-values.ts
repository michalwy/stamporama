import "server-only";
import {
  getBulkQuickCatalogPriceContext,
  type BulkQuickPriceCatalog,
  type BulkQuickPriceRow,
} from "./stamps";
import { getVariantSubtrees, type VariantPriceRow } from "./variant-prices";
import { withUmbrellaVariants, type RunReadSubject } from "./issue-run";

/** What one read of a checklist run's values answers (#2260). */
export interface RunCatalogValues {
  /** Each umbrella asked about, its own subtree — the rows the run prices its variants on (#2161). */
  trees: Record<string, VariantPriceRow[]>;
  catalogs: BulkQuickPriceCatalog[];
  /** What is on file for every subject asked and every variant under an umbrella among them. */
  rows: BulkQuickPriceRow[];
}

/**
 * A checklist run's catalogue values **in one read** (#2260): the umbrellas' trees first, then the
 * offer grid's bulk context (#720) for every subject asked and, on an umbrella, every stamp of its
 * tree in the same condition and certificate. The run window had read each umbrella's tree on its
 * own and the whole run's prices again as each tree came in; this is one round trip whatever the run
 * holds.
 *
 * `umbrellaIds` names the stamps the window treats as umbrellas — its own reading of the checklist's
 * members; one not among the subjects is not read.
 */
export async function getRunCatalogValues(
  ownerId: string,
  request: { subjects: RunReadSubject[]; umbrellaIds: string[] }
): Promise<RunCatalogValues> {
  const asked = new Set(request.subjects.map((s) => s.stampId));
  const trees = await getVariantSubtrees(
    ownerId,
    request.umbrellaIds.filter((id) => asked.has(id))
  );
  const { catalogs, rows } = await getBulkQuickCatalogPriceContext(
    ownerId,
    withUmbrellaVariants(request.subjects, trees)
  );
  return { trees, catalogs, rows };
}
