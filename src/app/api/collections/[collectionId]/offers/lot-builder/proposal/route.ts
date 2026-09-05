import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { buildLotProposal } from "@/lib/lot-builder";
import { parseLotBuilderRequest } from "@/lib/lot-builder-criteria";

// One round of the bulk-lot builder (#759): the criteria, the seed, the pins and the rejections —
// the five things the wizard holds in its URL — read back into a proposal.
//
// The pool is re-read on every call and nothing about the previous proposal is trusted, which is the
// same contract the commit keeps (#717). A re-roll is a new seed and nothing else.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const parsed = parseLotBuilderRequest(request.nextUrl.searchParams);
  if (!parsed.criteria.platformId) {
    return NextResponse.json({ error: "Choose a platform to build the lot for." }, { status: 400 });
  }

  try {
    return NextResponse.json(await buildLotProposal(session.user.id, collectionId, parsed));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
