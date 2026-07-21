import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listEligibleSubLots } from "@/lib/sale-lots";

// Unit lots eligible to add as sub-lots of a quantity lot (ADR-0012, #164): non-dissolved,
// same collection, excluding the target lot and its current members. `lotId` is required.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const lotId = request.nextUrl.searchParams.get("lotId");
  if (!lotId) {
    return NextResponse.json({ error: "lotId is required" }, { status: 400 });
  }

  try {
    const items = await listEligibleSubLots(session.user.id, collectionId, lotId, {
      limit: 100,
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
