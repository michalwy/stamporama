import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { matchColnectItems, type ColnectMatchItemInput } from "@/lib/colnect";

// Colnect catalog-number matcher (#250, part of #155). Accepts a batch of extracted Colnect items
// and returns a per-item decision (auto / needs-confirm / skipped), writing unambiguous matches
// unless `dryRun` is set. Session-authorized like every collection route; the extension's per-
// profile token transport is handled separately (#251).

/** Parse and validate the request body into matcher input; returns null on a malformed shape. */
function parseBody(
  body: unknown
): { items: ColnectMatchItemInput[]; dryRun: boolean } | null {
  if (typeof body !== "object" || body === null) return null;
  const { items, dryRun } = body as { items?: unknown; dryRun?: unknown };
  if (!Array.isArray(items)) return null;

  const parsed: ColnectMatchItemInput[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) return null;
    const { colnectId, catalogRefs } = raw as { colnectId?: unknown; catalogRefs?: unknown };
    if (typeof colnectId !== "string" || !colnectId.trim()) return null;
    if (!Array.isArray(catalogRefs)) return null;
    const refs: { catalog: string; number: string }[] = [];
    for (const r of catalogRefs) {
      if (typeof r !== "object" || r === null) return null;
      const { catalog, number } = r as { catalog?: unknown; number?: unknown };
      if (typeof catalog !== "string" || typeof number !== "string") return null;
      refs.push({ catalog, number });
    }
    parsed.push({ colnectId: colnectId.trim(), catalogRefs: refs });
  }
  return { items: parsed, dryRun: dryRun === true };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;

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
    const results = await matchColnectItems(session.user.id, collectionId, parsed.items, {
      dryRun: parsed.dryRun,
    });
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
