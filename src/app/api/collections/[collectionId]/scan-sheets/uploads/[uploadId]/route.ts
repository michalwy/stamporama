import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ScanAuthError, ScanValidationError } from "@/lib/scan-sheets";
import { abortScanUpload, receiveScanChunk } from "@/lib/scan-uploads";

/**
 * One part of a card scan (#590).
 *
 * The body is the raw bytes and nothing else — no multipart wrapper, because the whole point is
 * that this request is small enough for an unconfigured proxy to pass, and a boundary and its
 * headers are bytes spent on saying what a query parameter already says.
 *
 * **A retry re-sends the chunk, not the file.** A part the server already holds is answered `200`
 * with the count it holds, so a client retrying a request whose response it never saw resumes
 * rather than starting a 200 MB upload again.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { uploadId } = await params;
  const index = Number(request.nextUrl.searchParams.get("index"));
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "Invalid chunk index." }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Invalid chunk." }, { status: 400 });
  }

  try {
    return NextResponse.json(await receiveScanChunk(session.user.id, uploadId, index, bytes));
  } catch (err) {
    if (err instanceof ScanAuthError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ScanValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to store the chunk." }, { status: 500 });
  }
}

/** Give up on an upload — a review the collector cancelled, a scan they picked by mistake. The
 * hourly sweep would collect it anyway; this is what stops the parts sitting on the volume for
 * hours after everyone involved already knows they are unwanted. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { uploadId } = await params;
  try {
    await abortScanUpload(session.user.id, uploadId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ScanAuthError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to abandon the upload." }, { status: 500 });
  }
}
