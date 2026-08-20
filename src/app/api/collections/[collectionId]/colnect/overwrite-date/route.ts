import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { overwriteColnectIssuedDate } from "@/lib/colnect";

// Resolve a date-of-issue conflict with Colnect's value (#655): replace one stamp's issue date with
// what the Colnect page prints. Session-or-token authorized like the rest of the matcher, since the
// Assistant calls it cross-site from colnect.com. The printed value is sent verbatim and parsed on
// the instance, exactly as the matcher parsed it when it reported the disagreement.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { stampId, issuedOn } = (body ?? {}) as { stampId?: unknown; issuedOn?: unknown };
  if (typeof stampId !== "string" || !stampId || typeof issuedOn !== "string" || !issuedOn.trim()) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await overwriteColnectIssuedDate(ownerId, collectionId, {
      stampId,
      issuedOn: issuedOn.trim(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
