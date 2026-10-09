import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listPurchasesPaginated, type PurchaseSortBy } from "@/lib/purchases";
import { isIntakeDocumentType, parseIntakePartyIds } from "@/lib/purchase-kind";
import { isPurchaseStatus } from "@/lib/purchase-status";

const VALID_SORT_BY = new Set<PurchaseSortBy>(["purchasedAt", "createdAt"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

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
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;
  // A comma-separated set (#1708), any of them; an unrecognised status is dropped rather than
  // refused, as the sales route drops one.
  const statuses = (sp.get("status") || "").split(",").filter(isPurchaseStatus);
  const typeParam = sp.get("type");
  const type = isIntakeDocumentType(typeParam) ? typeParam : undefined;
  const contactId = sp.get("contactId") || undefined;
  // Several of each, `none` among them for a document recorded without one (#1392).
  const platformIds = parseIntakePartyIds(sp.get("platform"));
  const supplierIds = parseIntakePartyIds(sp.get("supplier"));
  const sortByParam = sp.get("sortBy") as PurchaseSortBy | null;
  const sortBy = sortByParam && VALID_SORT_BY.has(sortByParam) ? sortByParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir =
    sortDirParam && VALID_SORT_DIR.has(sortDirParam)
      ? (sortDirParam as "asc" | "desc")
      : undefined;

  try {
    const result = await listPurchasesPaginated(session.user.id, collectionId, {
      offset,
      type,
      statuses,
      contactId,
      platformIds,
      supplierIds,
      sortBy,
      sortDir,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
