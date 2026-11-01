import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getProposalSaleOptions } from "@/lib/proposals";

// What *Convert to sale…* on a proposal's screen offers (#2289): its open lots, and the contact's
// sales not yet sent on any platform.
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
    return NextResponse.json(await getProposalSaleOptions(session.user.id, proposalId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
