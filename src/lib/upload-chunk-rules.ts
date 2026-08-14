/**
 * How large a piece of a card scan may be (#590) — pure, so the number and the arithmetic over it
 * are unit-testable and readable from either side of the wire.
 *
 * The whole point of chunking is to ask the operator's proxy for something it passes **without
 * being configured**. `MAX_UPLOAD_BYTES` (200 MB) is the app's judgement about what a card may
 * weigh and stays exactly where it is; this is the judgement about what a *request* may weigh, and
 * they answer to different people — the first to the collector's scanner, the second to whatever
 * sits in front of the app.
 *
 * The default is deliberately below every default we know of rather than at one: nginx ships
 * `client_max_body_size 1m`, and a chunk sized *at* that limit has no room for the request line and
 * headers a proxy may count with the body. Half a megabyte makes a 200 MB card 400 requests, which
 * is nothing next to the transfer itself.
 *
 * It is an override and not a wall because the floor is not knowable from here: an operator behind
 * something stricter lowers it, and one on a permissive path who would rather make forty requests
 * than four hundred raises it.
 */

/** Half a megabyte. See above for why below 1 MB rather than at it. */
export const DEFAULT_UPLOAD_CHUNK_KB = 512;

/** Bounds on the override. The floor keeps a typo (`STAMPORAMA_UPLOAD_CHUNK_KB=1`) from turning a
 * 200 MB card into 200,000 requests; the ceiling is where chunking stops buying anything, being
 * already past the strictest cap this feature exists for. Both are clamps rather than refusals: a
 * bad value must not be able to break an upload path, on the same reasoning that keeps the
 * retention parsers forgiving. */
export const MIN_UPLOAD_CHUNK_KB = 64;
export const MAX_UPLOAD_CHUNK_KB = 32 * 1024;

/** Resolve the configured chunk size, in bytes, from the raw environment value. Anything
 * unparseable is the default; anything out of range is clamped into it. */
export function resolveUploadChunkBytes(raw: string | undefined | null): number {
  const parsed = Number(raw?.trim());
  const kb =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.max(Math.floor(parsed), MIN_UPLOAD_CHUNK_KB), MAX_UPLOAD_CHUNK_KB)
      : DEFAULT_UPLOAD_CHUNK_KB;
  return kb * 1024;
}

/** How many chunks a file of `totalBytes` is sent in. An empty file is zero chunks — and is
 * refused before it gets here, an image of nothing not being an image. */
export function chunkCount(totalBytes: number, chunkBytes: number): number {
  if (totalBytes <= 0 || chunkBytes <= 0) return 0;
  return Math.ceil(totalBytes / chunkBytes);
}

/** The byte range of one chunk, as `[start, end)`. The last one is short. */
export function chunkRange(
  index: number,
  totalBytes: number,
  chunkBytes: number
): { start: number; end: number } {
  const start = index * chunkBytes;
  return { start, end: Math.min(start + chunkBytes, totalBytes) };
}
