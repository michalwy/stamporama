import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getProposalScreen } from "@/lib/proposals";

// A proposal as its own screen reads it (#2287): its contact, status and lots with their prices.
// Owner-checked through the collection, and refused for a proposal of another collection.
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
    const screen = await getProposalScreen(session.user.id, proposalId);
    if (!screen || screen.collectionId !== collectionId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(screen);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
