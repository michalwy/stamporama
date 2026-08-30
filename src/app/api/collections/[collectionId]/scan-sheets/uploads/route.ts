import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ScanAuthError, ScanValidationError, type SheetSide } from "@/lib/scan-sheets";
import { openScanUpload } from "@/lib/scan-uploads";

/**
 * Open a chunked card-scan upload with **no order behind it** (#725).
 *
 * The order's twin of this lives under `purchases/[purchaseId]/scan-sheets/uploads` and differs in
 * exactly one thing: which owner it hands `openScanUpload`. Everything after the open — the parts,
 * the finalize, the assembled sheet — is the same pair of routes under
 * `scan-sheets/uploads/[uploadId]`, because a chunk is addressed by its upload and has never had an
 * opinion about who the card belongs to.
 */
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
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const input = body as {
    mime?: unknown;
    side?: unknown;
    batchNo?: unknown;
    label?: unknown;
    totalBytes?: unknown;
  };

  if (input.side !== "front" && input.side !== "back") {
    return NextResponse.json({ error: "Side must be front or back." }, { status: 400 });
  }
  const side: SheetSide = input.side;

  if (typeof input.mime !== "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (typeof input.totalBytes !== "number") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  let batchNo: number | undefined;
  if (input.batchNo != null) {
    if (typeof input.batchNo !== "number" || !Number.isInteger(input.batchNo) || input.batchNo < 1) {
      return NextResponse.json({ error: "Invalid batch." }, { status: 400 });
    }
    batchNo = input.batchNo;
  }

  // The card's name, given as it is added (#587). Optional and never a reason to refuse a scan.
  const label = typeof input.label === "string" ? input.label : null;

  try {
    const opened = await openScanUpload(session.user.id, { collectionId }, {
      mime: input.mime,
      side,
      batchNo,
      label,
      totalBytes: input.totalBytes,
    });
    return NextResponse.json(opened, { status: 201 });
  } catch (err) {
    if (err instanceof ScanAuthError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ScanValidationError) {
      // Same status a too-large upload has always been refused with, even though nothing has been
      // sent yet: one answer to one question, and the client's error path should not learn a second.
      const tooLarge = err.message.includes("too large");
      return NextResponse.json({ error: err.message }, { status: tooLarge ? 413 : 400 });
    }
    return NextResponse.json({ error: "Failed to start the upload." }, { status: 500 });
  }
}
