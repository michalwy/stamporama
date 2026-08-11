import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { searchCollection } from "@/lib/collection-search";

// "Have I got this?", asked from outside the app (#529) — the endpoint the Assistant's **Find in
// Stamporama** context menu lands on with whatever text the collector selected on an auction page.
//
// Session **or** Assistant token (`resolveCollectionOwner`), like the matcher, the listing kit, the
// capture and the offer lookup: the extension reaches us cross-site from wherever the collector was
// browsing, where the session cookie is not sent.
//
// Read-only, and an empty `q` is an **empty answer** rather than a 400: the window opens on whatever
// was selected, and a selection that turns out to be whitespace is the collector's next keystroke to
// fix, not an error to render at them.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await searchCollection(
      ownerId,
      collectionId,
      request.nextUrl.searchParams.get("q") ?? ""
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
