import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { confirmColnectMatch, ColnectMatchConflictError } from "@/lib/colnect";
import { parseColnectAttributes } from "@/lib/colnect-attributes";

// Commit a user-chosen Colnect match (#250, part of #155): write `Stamp.colnectId` for a stamp the
// user picked from a `needs-confirm` result. Returns 409 with the existing ID when the write would
// overwrite a different Colnect ID and `allowOverwrite` was not set.

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

  const {
    colnectId,
    stampId,
    allowOverwrite,
    backfill,
    catalogRefs,
    issueDate,
    issuedOn,
    attributeSync,
    attributes,
  } = (body ?? {}) as {
    colnectId?: unknown;
    stampId?: unknown;
    allowOverwrite?: unknown;
    backfill?: unknown;
    catalogRefs?: unknown;
    issueDate?: unknown;
    issuedOn?: unknown;
    attributeSync?: unknown;
    attributes?: unknown;
  };
  if (typeof colnectId !== "string" || !colnectId.trim() || typeof stampId !== "string" || !stampId) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // The item's printed catalog refs travel with the confirmation so the chosen stamp can be
  // backfilled (#280) in the same call. Malformed entries are dropped, never fatal — the match
  // itself must still commit.
  const refs: { catalog: string; number: string }[] = Array.isArray(catalogRefs)
    ? catalogRefs.flatMap((r) => {
        if (typeof r !== "object" || r === null) return [];
        const { catalog, number } = r as { catalog?: unknown; number?: unknown };
        return typeof catalog === "string" && typeof number === "string"
          ? [{ catalog, number }]
          : [];
      })
    : [];

  try {
    const written = await confirmColnectMatch(ownerId, collectionId, {
      colnectId: colnectId.trim(),
      stampId,
      allowOverwrite: allowOverwrite === true,
      backfill: backfill === true,
      catalogRefs: refs,
      // The page's "Issued on" travels with the confirmation for the same reason its numbers do
      // (#655): the chosen stamp is dated in the same call.
      issueDate: issueDate === true,
      ...(typeof issuedOn === "string" ? { issuedOn } : {}),
      // …and what it states about the stamp, for the same reason again (#739).
      attributeSync: attributeSync === true,
      attributes: parseColnectAttributes(attributes),
    });
    return NextResponse.json({
      ok: true,
      backfill: written.backfill,
      date: written.date,
      attributes: written.attributes,
    });
  } catch (err) {
    if (err instanceof ColnectMatchConflictError) {
      return NextResponse.json(
        { error: "conflict", existingColnectId: err.existingColnectId },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
