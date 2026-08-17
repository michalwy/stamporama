import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getPurchaseIntakePage,
  type LotCopySort,
} from "@/lib/items";
import { parseDispositionFilter, parseLotCopyFilter } from "@/lib/intake-filter-params";
import { parseTilePhotoRoles } from "@/lib/tile-photo-roles";

const VALID_SORT = new Set<LotCopySort>(["added", "year", "catalog", "price", "name"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

/** One page of a whole purchase's copies (across all lots) for the order-level intake view with
 * "By lot" grouping off — a single globally-ordered flat/by-issue stream (#172). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, purchaseId } = await params;
  const sp = request.nextUrl.searchParams;

  const offsetParam = sp.get("offset");
  const offset = offsetParam && /^\d+$/.test(offsetParam) ? parseInt(offsetParam, 10) : undefined;
  const sortParam = sp.get("sort") as LotCopySort | null;
  const sort = sortParam && VALID_SORT.has(sortParam) ? sortParam : undefined;
  const filter = parseLotCopyFilter(sp.get("filter"));
  const sortDirParam = sp.get("sortDir");
  const sortDir =
    sortDirParam && VALID_SORT_DIR.has(sortDirParam)
      ? (sortDirParam as "asc" | "desc")
      : undefined;
  // What the copies are kept for (#622) — a second, orthogonal filter axis, so it is read
  // alongside `filter` rather than folded into it.
  const disposition = parseDispositionFilter(sp.get("disposition"));
  const issueKey = sp.get("issueKey") || undefined;
  // Which photo slots a scan tile needs free, for its assign list (#567) — asked at the **order**
  // level since #586, a card of a settled auction holding pieces of every lot in the parcel.
  // Parsed through the shared encoding, so what the list asked for and what the read filters on
  // cannot disagree; anything unrecognised drops out, and an absent param means no constraint.
  const freePhotoSlots = parseTilePhotoRoles(sp.get("freePhotoSlots"));

  try {
    const result = await getPurchaseIntakePage(session.user.id, collectionId, purchaseId, {
      sort,
      sortDir,
      filter,
      disposition,
      freePhotoSlots,
      issueKey,
      offset,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
