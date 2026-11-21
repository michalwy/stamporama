import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getProposalLotsPrepare } from "@/lib/proposals";

// A proposal's open lots as Prepare rows (#2287) — what its screen prices them from, as a post's
// screen does (#2031). `?lots=` (offer ids, comma-separated) answers for those lots alone (#2639): what
// the screen asks after while their photos are being made. Owner-checked through the collection.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; proposalId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, proposalId } = await params;
  const only = request.nextUrl.searchParams.get("lots")?.split(",").filter(Boolean);
  try {
    return NextResponse.json({ lots: await getProposalLotsPrepare(session.user.id, collectionId, proposalId, only) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
