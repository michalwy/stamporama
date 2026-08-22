import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  previewColnectListImport,
  resolveColnectImportRows,
  type ColnectImportSettledRow,
} from "@/lib/colnect-list-import";
import { assertSectionOwner } from "@/lib/trade-access";
import { isTradeSide } from "@/lib/trade-rules";

// **Reading a Colnect list against one side of a trade** (#645), without writing anything.
//
// Multipart through a route handler rather than a server action, the Delcampe import's boundary
// (#611) and the photo upload's before it (#112): the payload is a file the collector picked, and
// the answer is a report the dialog draws rather than a redirect.
//
// **Two things are asked here and both are reads.** `POST` with a file previews it; `PATCH` with the
// rows the collector has settled re-resolves the give side, which has to happen every time a gap is
// fixed — the copy pool is finite and shared, so a row that was a shortfall stops being one the
// moment the row above it stops taking a copy. The **write** is a server action, because it is a
// mutation the screen waits on and reports.

/** A ceiling on the upload before a byte of it is parsed. A Colnect export runs about a kilobyte per
 *  stamp — thirty-nine columns of catalog codes and themes — so this is thousands of rows and far
 *  beyond any list a collector trades against. It is here so a file picked by mistake is refused by
 *  size rather than by parser. */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; tradeId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tradeId } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: "That file is too large to be a Colnect list (max 8 MB)." },
      { status: 413 }
    );
  }

  const sectionId = String(form.get("sectionId") ?? "");
  const side = String(form.get("side") ?? "");
  if (!sectionId || !isTradeSide(side)) {
    return NextResponse.json({ error: "Which section, and which side?" }, { status: 400 });
  }

  const belongs = await sectionBelongsToTrade(session.user.id, sectionId, tradeId);
  if (!belongs) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const preview = await previewColnectListImport(
      session.user.id,
      sectionId,
      side,
      await file.text()
    );
    return NextResponse.json(preview, { status: 200 });
  } catch (err) {
    // Everything this can throw is one sentence about the file or the trade — the wrong export was
    // picked, the section is gone. There is nothing to report row by row when there are no rows.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read that list." },
      { status: 400 }
    );
  }
}

/** Re-resolve the give side over the rows as the collector has them now. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; tradeId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tradeId } = await params;

  let body: { rows?: unknown };
  try {
    body = (await request.json()) as { rows?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const rows = readSettledRows(body.rows);
  if (!rows) return NextResponse.json({ error: "Invalid rows." }, { status: 400 });

  try {
    const shortfalls = await resolveColnectImportRows(session.user.id, tradeId, rows);
    return NextResponse.json({ shortfalls }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** The section has to be on the trade in the path: the guard below it checks ownership, and this
 *  checks that the request is about the trade it says it is. */
async function sectionBelongsToTrade(
  ownerId: string,
  sectionId: string,
  tradeId: string
): Promise<boolean> {
  try {
    const section = await assertSectionOwner(ownerId, sectionId);
    return section.tradeId === tradeId;
  } catch {
    return false;
  }
}

/** The settled rows as they arrive over the wire, or null. Ids are checked against the collection by
 *  the domain — what is checked here is only that this is the shape it takes. */
function readSettledRows(raw: unknown): ColnectImportSettledRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: ColnectImportSettledRow[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.stampId !== "string" || typeof row.conditionId !== "string") return null;
    const line = typeof row.line === "number" ? row.line : 0;
    const quantity = typeof row.quantity === "number" ? row.quantity : 1;
    rows.push({
      line,
      stampId: row.stampId,
      conditionId: row.conditionId,
      quantity: Math.max(1, Math.trunc(quantity)),
    });
  }
  return rows;
}
