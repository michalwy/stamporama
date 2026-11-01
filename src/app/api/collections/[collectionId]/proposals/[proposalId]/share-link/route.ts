import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readProposalShareState } from "@/lib/proposal-handout";

// The proposal's link for the buyer (#2288) as the collector's dialog reads it: the address, when it
// was made and last opened — `link` is `null` when the proposal has none — what a buyer opening it sees
// now, and the proposal's language, which the buyer's page speaks.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; proposalId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, proposalId } = await params;
  try {
    return NextResponse.json(await readProposalShareState(session.user.id, proposalId, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
