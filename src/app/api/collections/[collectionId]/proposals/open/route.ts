import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listOpenProposals } from "@/lib/proposals";

// The proposals still open (#2287) — what the offer generator offers to put its new offers into.
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
    return NextResponse.json({ items: await listOpenProposals(session.user.id, collectionId) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
