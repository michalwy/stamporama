import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { matchColnectItems, type ColnectMatchItemInput } from "@/lib/colnect";
import { parseColnectAttributes } from "@/lib/colnect-attributes";

// Colnect catalog-number matcher (#250, part of #155). Accepts a batch of extracted Colnect items
// and returns a per-item decision (auto / needs-confirm / skipped), writing unambiguous matches
// unless `dryRun` is set. Session-authorized like every collection route; the extension's per-
// profile token transport is handled separately (#251).

/** Parse and validate the request body into matcher input; returns null on a malformed shape. */
function parseBody(
  body: unknown
): {
  items: ColnectMatchItemInput[];
  dryRun: boolean;
  backfill: boolean;
  issueDate: boolean;
  attributes: boolean;
} | null {
  if (typeof body !== "object" || body === null) return null;
  const { items, dryRun, backfill, issueDate, attributes } = body as {
    items?: unknown;
    dryRun?: unknown;
    backfill?: unknown;
    issueDate?: unknown;
    attributes?: unknown;
  };
  if (!Array.isArray(items)) return null;

  const parsed: ColnectMatchItemInput[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) return null;
    const { colnectId, catalogRefs, issuedOn, attributes: itemAttributes } = raw as {
      colnectId?: unknown;
      catalogRefs?: unknown;
      issuedOn?: unknown;
      attributes?: unknown;
    };
    if (typeof colnectId !== "string" || !colnectId.trim()) return null;
    if (!Array.isArray(catalogRefs)) return null;
    const refs: { catalog: string; number: string }[] = [];
    for (const r of catalogRefs) {
      if (typeof r !== "object" || r === null) return null;
      const { catalog, number } = r as { catalog?: unknown; number?: unknown };
      if (typeof catalog !== "string" || typeof number !== "string") return null;
      refs.push({ catalog, number });
    }
    parsed.push({
      colnectId: colnectId.trim(),
      catalogRefs: refs,
      // What the page printed under "Issued on" (#655), verbatim. Not a hard shape — a value we
      // cannot read is simply no date, and must not cost the item its match.
      ...(typeof issuedOn === "string" ? { issuedOn } : {}),
      // What the page states about the stamp itself (#739), read on the same terms: an attribute we
      // cannot read is no attribute, and must not cost the item its match.
      attributes: parseColnectAttributes(itemAttributes),
    });
  }
  // Backfill, date sync and attribute sync are each opt-in on the wire (#280, #655, #739): wanting
  // Colnect's numbers, its dates and its attributes are three separate appetites, and an older
  // client that doesn't know about one of them never writes it by accident.
  return {
    items: parsed,
    dryRun: dryRun === true,
    backfill: backfill === true,
    issueDate: issueDate === true,
    attributes: attributes === true,
  };
}

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

  const parsed = parseBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const results = await matchColnectItems(ownerId, collectionId, parsed.items, {
      dryRun: parsed.dryRun,
      backfill: parsed.backfill,
      issueDate: parsed.issueDate,
      attributes: parsed.attributes,
    });
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
