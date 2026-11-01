import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listPreparingProposals } from "@/lib/proposals";

// The proposals being prepared (#2287, #2307) — the only ones that take lots, so what New offer's
// Proposal field (#2304) and the offer generator's Into proposal offer to put new offers into.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  try {
    return NextResponse.json({ items: await listPreparingProposals(session.user.id, collectionId) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
