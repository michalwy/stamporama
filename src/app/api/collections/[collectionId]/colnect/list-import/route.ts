import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import {
  ColnectListImportError,
  importColnectListSnapshot,
  previewColnectListFile,
} from "@/lib/colnect-list-snapshot";

// **Loading a Colnect export into a list's snapshot** (#685), from the Colnect screen (#686).
//
// Multipart through a route handler rather than a server action, the trade import's boundary before
// it (#645) and Delcampe's before that (#611): the payload is a file the collector picked.
//
// One endpoint, two calls, because the dialog asks twice. `commit` absent **reads** the file and
// says what it is and which configured list it lands in; `commit` present writes it. The file is
// sent both times rather than parked on the server between them — a Wish export is a few megabytes
// and reading it twice costs less than owning a temporary copy of it, and there is no window in
// which a half-finished import exists.
//
// **The Assistant posts here too** (#690), which is why the authorization is session-or-token: the
// extension fetches the export from Colnect in the collector's own browser and hands the very same
// multipart body straight over, so both routes into a snapshot run one importer with one set of
// rules about what an export means. It sends `requireList`, which the dialog never does — a refresh
// nobody is watching must not replace one list's snapshot with another list's file.

/** A ceiling before a byte is parsed. Colnect's export runs about a kilobyte per stamp across its
 *  thirty-nine columns, so this holds a list of tens of thousands — the Wish list read on
 *  2026-08-22 was 25,145 — and refuses a file picked by mistake by size rather than by parser. */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      { error: "That file is too large to be a Colnect list export (max 64 MB)." },
      { status: 413 }
    );
  }

  const commit = form.get("commit") !== null;
  const rawLt = form.get("lt");
  const lt = rawLt === null ? null : Number(String(rawLt));
  // `""` is a real list name — a file naming no list at all is one unnamed list — so the absent
  // field and the empty one have to stay apart.
  const rawListName = form.get("listName");
  const listName = rawListName === null ? undefined : String(rawListName);

  try {
    const text = await file.text();
    if (!commit) {
      const preview = await previewColnectListFile(ownerId, collectionId, file.name, text);
      return NextResponse.json(preview, { status: 200 });
    }
    if (lt === null || !Number.isFinite(lt)) {
      return NextResponse.json({ error: "Which list is this file?" }, { status: 400 });
    }
    const result = await importColnectListSnapshot(ownerId, collectionId, {
      lt,
      fileName: file.name,
      text,
      listName,
      requireFileNamesList: form.get("requireList") !== null,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ColnectListImportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Everything else this can throw is about the collection rather than the file — it is gone, or
    // it is not this collector's.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
