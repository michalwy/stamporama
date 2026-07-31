import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { overwriteColnectCatalogNumber, ColnectDuplicateNumberError } from "@/lib/colnect";

// Resolve a catalog-number conflict with Colnect's value (#433): replace one stamp's number for a
// single catalog vendor with what the Colnect item prints. Session-or-token authorized like the rest
// of the matcher, since the Assistant calls it cross-site from colnect.com. Returns 409 with the
// holding stamps when the collection blocks duplicate catalog identities (#85).

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

  const { stampId, catalogVendorId, number } = (body ?? {}) as {
    stampId?: unknown;
    catalogVendorId?: unknown;
    number?: unknown;
  };
  if (
    typeof stampId !== "string" ||
    !stampId ||
    typeof catalogVendorId !== "string" ||
    !catalogVendorId ||
    typeof number !== "string" ||
    !number.trim()
  ) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await overwriteColnectCatalogNumber(ownerId, collectionId, {
      stampId,
      catalogVendorId,
      number,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ColnectDuplicateNumberError) {
      return NextResponse.json(
        { error: "duplicate", stampNames: err.stampNames },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
