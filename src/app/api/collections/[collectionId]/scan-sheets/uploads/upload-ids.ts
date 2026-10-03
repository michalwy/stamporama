import type { NextRequest } from "next/server";

/** The most uploads one batch request may name — far past any carton, and a bound on the query. */
const MAX_IDS = 500;

/**
 * The `{ ids }` a batch request about several uploads carries (#1568), or null when it carries
 * something else. Read as text, because a beacon sent as a tab closes does not promise its content
 * type.
 */
export async function readUploadIds(request: NextRequest): Promise<string[] | null> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return null;
  }
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_IDS) return null;
  if (!ids.every((id): id is string => typeof id === "string" && id.length > 0)) return null;
  return ids;
}
