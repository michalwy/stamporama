import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  listPurchasesPaginated,
  type PurchaseSortBy,
  type PurchaseStatus,
} from "@/lib/purchases";

const VALID_SORT_BY = new Set<PurchaseSortBy>(["purchasedAt", "createdAt"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);
const VALID_STATUS = new Set<PurchaseStatus>(["preparing", "in_transit", "arrived"]);

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
  const statusParam = sp.get("status") as PurchaseStatus | null;
  const status = statusParam && VALID_STATUS.has(statusParam) ? statusParam : undefined;
  const contactId = sp.get("contactId") || undefined;
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
      status,
      contactId,
      sortBy,
      sortDir,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
