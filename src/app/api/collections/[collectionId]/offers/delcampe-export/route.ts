import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { buildDelcampeUploadBundle, DelcampeExportError } from "@/lib/delcampe-export";

// The Easy Uploader bundle for the batch the listing workspace is showing (#610) — one CSV plus the
// pictures it names, as one flat ZIP.
//
// POST and a JSON body for the batch photo archive's reason (#323): which offers are in the session
// follows from the screen's filters, and a query string carrying forty ids is a URL-length gamble.
// The download is therefore driven from the client (fetch → blob) rather than a plain link.
//
// **A refusal is a body, not a status alone.** An offer that cannot be written as a row is reported
// with every reason it carries, one entry per offer, because the collector is about to go and fix
// them — `409` with that list is the whole point of refusing before a file is built rather than
// after Delcampe rejects one.

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
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const offerIds = (body as { offerIds?: unknown })?.offerIds;
  if (!Array.isArray(offerIds) || offerIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "offerIds must be an array of ids." }, { status: 400 });
  }

  let result;
  try {
    result = await buildDelcampeUploadBundle(session.user.id, collectionId, offerIds as string[]);
  } catch (err) {
    if (err instanceof DelcampeExportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, refusals: result.refusals },
      { status: 409 }
    );
  }

  const { bundle } = result;
  return new Response(new Uint8Array(bundle.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(bundle.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${bundle.fileName}"`,
      // What the caller cannot see from the bytes, so the screen can report the batch it just built.
      "X-Row-Count": String(bundle.rowCount),
      "X-Image-Count": String(bundle.imageCount),
      // The pictures are whatever the plan holds right now, and regenerating replaces every one.
      "Cache-Control": "no-store",
    },
  });
}
