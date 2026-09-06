import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listComposeTargetSetCopies } from "@/lib/offers";

// The copies of one set of the Add-to-offer picker's target offers (#867), enriched as inventory
// rows for the set's expandable *Show contents*.
//
// It is a route of its own because the details are lazy: `compose-targets` beside it used to enrich
// every copy in every set of every non-terminal offer before the picker had drawn anything, which
// was 94% of that response for rows that stay collapsed. One set, when it is opened.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const offerSetId = request.nextUrl.searchParams.get("offerSetId") ?? "";
  if (!offerSetId) {
    return NextResponse.json({ error: "offerSetId is required" }, { status: 400 });
  }

  try {
    const copies = await listComposeTargetSetCopies(session.user.id, collectionId, offerSetId);
    // A set outside this collection reads as absent, not as an error worth distinguishing.
    if (!copies) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ copies });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
