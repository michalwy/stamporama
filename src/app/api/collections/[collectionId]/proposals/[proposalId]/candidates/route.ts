import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listProposalLotCandidates } from "@/lib/proposals";

// The offers *Add offers…* on a proposal's screen lists (#2287): open, on Direct, in no proposal.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; proposalId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { proposalId } = await params;
  try {
    return NextResponse.json({ items: await listProposalLotCandidates(session.user.id, proposalId) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
