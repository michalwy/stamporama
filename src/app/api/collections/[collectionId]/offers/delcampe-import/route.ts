import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { DelcampeImportError, importDelcampeActiveItems } from "@/lib/delcampe-import";

// Reconciling one Delcampe active-items export against this collection's offers (#611).
//
// Multipart through a route handler rather than a server action, the photo upload's boundary (#112):
// the payload is a file the collector picked, and the answer is a report the screen prints rather
// than a redirect.
//
// **A refusal about the file is a 400 with one sentence**, because there is nothing to fix listing
// by listing — the wrong export was picked, no platform is marked as Delcampe, the download failed.
// What the *rows* could not do is not a refusal at all: it is the report, and it comes back with a
// 200 beside everything the import did do.

/** A ceiling on the upload itself, before a byte of it is parsed. An active-items export is a few
 *  hundred bytes per listing, so this is thousands of listings and nowhere near anything Delcampe
 *  produces — it is here so that a file picked by mistake is refused by size rather than by parser. */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { collectionId } = await params;

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
    return NextResponse.json({ error: "That file is too large to be an export (max 8 MB)." }, { status: 413 });
  }

  const text = await file.text();

  try {
    const outcome = await importDelcampeActiveItems(
      session.user.id,
      collectionId,
      text,
      file.name || null
    );
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    if (err instanceof DelcampeImportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
