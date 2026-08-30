import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionIntakePage, type LotCopySort } from "@/lib/items";
import { parseDispositionFilter, parseLotCopyFilter } from "@/lib/intake-filter-params";
import { parseTilePhotoRoles } from "@/lib/tile-photo-roles";

const VALID_SORT = new Set<LotCopySort>(["added", "year", "catalog", "price", "name"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

/**
 * One page of the **whole collection's** copies, on the intake list's own filters and ordering
 * (#725).
 *
 * It exists for one caller: the assign list of a tile on a card that belongs to no order. The
 * order-level twin under `purchases/[purchaseId]/copies` narrows to a parcel because that is what a
 * settled auction's card is matched against; a card scanned off a shelf has no parcel, so the scope
 * is the collection and everything else — `freePhotoSlots` above all — is identical.
 *
 * Deliberately **not** the Copies screen's own read (`/inventory`), which answers a different
 * question with a different shape: this is the intake page, the same one the order's lists use, so
 * the tile's candidate rows are the rows that list already knows how to draw.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
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
  const disposition = parseDispositionFilter(sp.get("disposition"));
  const issueKey = sp.get("issueKey") || undefined;
  const freePhotoSlots = parseTilePhotoRoles(sp.get("freePhotoSlots"));

  try {
    const result = await getCollectionIntakePage(session.user.id, collectionId, {
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
