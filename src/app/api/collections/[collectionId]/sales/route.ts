import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSalesPaginated } from "@/lib/sales";
import { isSaleStatus } from "@/lib/sale-status";

// Paginated sales list for the Sales screen (ADR-0012, #166). Filters by platform, fulfillment
// status (#392), free text, and whether a set is still to be chosen (#697).
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
  // "Only the sales still waiting on which set went" (#697). Present-and-`1` rather than any truthy
  // value, so a link carrying `setChoice=0` reads as off rather than as on.
  const setChoicePending = sp.get("setChoice") === "1";

  try {
    const result = await listSalesPaginated(session.user.id, collectionId, {
      offset,
      platformId,
      statuses,
      search,
      setChoicePending,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
