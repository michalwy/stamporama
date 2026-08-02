import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSalesPaginated } from "@/lib/sales";
import { isSaleStatus } from "@/lib/sale-status";

// Paginated sales list for the Sales screen (ADR-0012, #166). Filters by platform, fulfillment
// status (#392) and free text.
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
  const platformId = sp.get("platformId") || undefined;
  // A comma-separated set since the chips became multi-select (#475). An unrecognised status is
  // dropped rather than refused — a stale link narrows to nothing otherwise, and the chips are the
  // authority on what exists.
  const statuses = (sp.get("status") || "").split(",").filter(isSaleStatus);
  const search = sp.get("search") || undefined;

  try {
    const result = await listSalesPaginated(session.user.id, collectionId, {
      offset,
      platformId,
      statuses,
      search,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
