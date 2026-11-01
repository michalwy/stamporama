import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readProposalMessage } from "@/lib/proposal-handout";

// A proposal's message to its buyer (#2288), from the Direct platform's template: the text — null with
// no template — and the template's tokens that are not placeholders. Reading it hands nothing out;
// copying it does.
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
    return NextResponse.json(await readProposalMessage(session.user.id, proposalId, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
