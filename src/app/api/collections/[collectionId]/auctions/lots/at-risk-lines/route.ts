import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listAtRiskLotLines } from "@/lib/auctions";

// The lines of every lot the collector is winning, for the duplicate warning (#369). Unpaginated
// and unfiltered: it is bounded by what one person is bidding on at one time, and the dialogs match
// against the whole set in memory rather than asking again for every line they are given.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  try {
    return NextResponse.json(await listAtRiskLotLines(session.user.id, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
