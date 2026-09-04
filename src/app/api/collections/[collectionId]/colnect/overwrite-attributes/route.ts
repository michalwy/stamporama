import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { overwriteColnectAttributes } from "@/lib/colnect";
import { parseColnectAttributes } from "@/lib/colnect-attributes";

// Resolve stamp-attribute disagreements with Colnect's values (#739): replace what one stamp states
// with what the Colnect page prints. Session-or-token authorized like the rest of the matcher, since
// the Assistant calls it cross-site from colnect.com. The printed values are sent verbatim and
// compared on the instance, exactly as the matcher compared them when it reported the disagreement —
// so a mapping changed in between is honoured rather than baked into the request.
//
// **Only the attributes named in the body are touched.** An unticked disagreement is expressed by
// leaving that attribute out, the same shape the date sync's ticks already have.

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

  const { stampId, attributes } = (body ?? {}) as { stampId?: unknown; attributes?: unknown };
  const parsed = parseColnectAttributes(attributes);
  if (typeof stampId !== "string" || !stampId || !parsed) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const written = await overwriteColnectAttributes(ownerId, collectionId, {
      stampId,
      attributes: parsed,
    });
    return NextResponse.json({ ok: true, attributes: written });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
