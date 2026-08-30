import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listScans } from "@/lib/scan-sheets";

/**
 * The collection's **purchase-less** card scans (#725) — what the Card scans screen renders and what
 * the review editor reloads a previous cut from.
 *
 * Purchase-less and not "every card the collection has": a parcel's cards belong on the order's own
 * screen, where the lot question and the auction assign path are, and one list holding both would
 * have to explain per row which of the two a tile is about. That is `listScans`' rule rather than
 * this route's — the owner is `{ collectionId }`, which means exactly the cards with no order.
 *
 * The upload lives under `uploads/`, as the order's does and for the same reason (#590).
 */
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
    return NextResponse.json(await listScans(session.user.id, { collectionId }));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
