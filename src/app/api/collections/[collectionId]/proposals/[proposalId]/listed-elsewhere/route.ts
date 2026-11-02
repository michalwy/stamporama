import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readProposalLotsListedElsewhere } from "@/lib/listed-elsewhere";

// The ticked lots on *Convert to sale…* whose copies are in an open offer elsewhere (#2339), each copy
// with a twin listed nowhere where there is one.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; proposalId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { proposalId } = await params;
  const offerIds = request.nextUrl.searchParams.getAll("offerId");
  if (offerIds.length === 0) return NextResponse.json({ lots: [] });
  try {
    return NextResponse.json({ lots: await readProposalLotsListedElsewhere(session.user.id, proposalId, offerIds) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
