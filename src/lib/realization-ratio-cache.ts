// The learned realisation ratios, kept for a while once learned (#2426) — no imports, so every
// module that writes what the ratios are learned from can clear them without an import cycle
// (`docs/agents/platform.md`: a cycle between `src/lib` modules passes every test and throws at
// module-init in the app).
//
// Learning them reads every closed auction lot and every price observation of the collection and
// values each one, so it costs in proportion to the collection's history; every offer's screen, every
// Prepare page and every bid anchor asked it again. Settled with the collector on 2026-11-04: one set
// per collection, learned once and shared, **learned again after five minutes**, and **at once** after
// a write to an auction lot's result or composition, a price observation, a catalogue's manual factor
// or the collection's fallback percentage — the writes that call {@link forgetRealizationRatios}.
// A catalogue value edited by hand meanwhile reaches the ratios within the five minutes.

/** How long a learned set is used before it is learned again. */
export const REALIZATION_RATIO_TTL_MS = 5 * 60_000;

interface Entry<T> {
  at: number;
  /** The load itself, shared by every request that asks while it runs. */
  value: Promise<T>;
}

// Pinned to `globalThis` so `next dev`'s HMR keeps one store instead of stranding entries in a
// module instance nothing reads any more.
const globalForRatios = globalThis as unknown as {
  realizationRatioCache?: Map<string, Entry<unknown>>;
};
const entries = (globalForRatios.realizationRatioCache ??= new Map());

/**
 * The collection's learned set: the kept one while it is younger than the TTL, else `load()`'s, kept
 * from then on. A load that fails is not kept.
 */
export function cachedRealizationRatios<T>(
  collectionId: string,
  load: () => Promise<T>,
  now: number = Date.now()
): Promise<T> {
  const kept = entries.get(collectionId) as Entry<T> | undefined;
  if (kept && now - kept.at < REALIZATION_RATIO_TTL_MS) return kept.value;
  const value = load();
  const entry: Entry<T> = { at: now, value };
  entries.set(collectionId, entry);
  value.catch(() => {
    if (entries.get(collectionId) === entry) entries.delete(collectionId);
  });
  return value;
}

/**
 * Something the ratios are learned from has changed: every collection's set is learned again on its
 * next read. Every collection's rather than one's, because the writers know a lot or an observation
 * and not always its collection, and an instance is one collector's.
 */
export function forgetRealizationRatios(): void {
  // A load still running is dropped with the rest: whoever asked for it gets its answer, and the next
  // read learns again from what is stored now.
  entries.clear();
}
