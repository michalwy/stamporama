import seed from "./delcampe-category-seed.json";
import type { DelcampeCategoryRow } from "./delcampe-category-catalog-rules";

// A snapshot of Delcampe's published Stamps category tree, checked into the repo (#609; ADR-0035 §4).
//
// **Why it is here at all**, given the daily refresh: a fresh install would otherwise have a picker
// that searches nothing until the first pass runs — which takes minutes, needs the internet, and is
// the very first thing a collector setting Delcampe up reaches for. An instance with no outbound
// access never gets one at all. The snapshot makes the feature work before and without the network,
// and the refresh is what keeps it right afterwards.
//
// **It is a fallback, never a merge.** The moment a pass has stored anything, the stored rows are the
// answer and this file is not consulted — two sources blended would make "why is this category still
// offered?" unanswerable, and Delcampe retiring a category is a thing the collector should see
// happen.
//
// Regenerated with `pnpm delcampe:categories --seed`, which is the same walk the refresh makes.
// Nothing reads `readAt` but a person: it is here so that a stale file can be recognised as one.

/** When this snapshot was read from Delcampe. */
export const DELCAMPE_CATEGORY_SEED_READ_AT: string = seed.readAt;

/** The snapshot as rows. Stored as `[id, path]` pairs rather than as objects because the name is
 *  always the path's last segment — the file is half a megabyte of one repeated shape, and storing
 *  the name a second time is a hundred kilobytes saying nothing. */
export const DELCAMPE_CATEGORY_SEED: DelcampeCategoryRow[] = seed.categories.map(([id, path]) => ({
  id,
  path,
  name: path.slice(path.lastIndexOf(" > ") + 3),
}));
