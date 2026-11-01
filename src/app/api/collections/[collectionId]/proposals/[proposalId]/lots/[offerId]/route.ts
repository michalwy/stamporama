import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getProposalLot } from "@/lib/proposals";
import { readProposalPhotos } from "@/lib/proposal-handout";

// One lot of a proposal as its screen shows it (#2313) — what a price, a title or the lot's own state
// saved from its row refreshes, instead of the whole proposal, as a post's lot is (#2221) — with its
// photos. Owner-checked through the collection; 404 for an offer that is not a lot of this proposal.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; proposalId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, proposalId, offerId } = await params;
  try {
    const lot = await getProposalLot(session.user.id, collectionId, proposalId, offerId);
    if (!lot) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [photos] = await readProposalPhotos(session.user.id, proposalId, collectionId, [offerId]);
    return NextResponse.json({ ...lot, photos: photos ?? null });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
