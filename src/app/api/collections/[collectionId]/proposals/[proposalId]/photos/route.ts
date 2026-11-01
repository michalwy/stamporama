import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readProposalPhotos } from "@/lib/proposal-handout";

// A proposal's lots' photos as its screen shows them (#2288): each lot's upload set, in lot order,
// under the names the archive gives them. Reading them hands nothing out.
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
    return NextResponse.json({ lots: await readProposalPhotos(session.user.id, proposalId, collectionId) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
