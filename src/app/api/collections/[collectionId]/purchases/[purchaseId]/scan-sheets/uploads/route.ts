import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ScanAuthError, ScanValidationError, type SheetSide } from "@/lib/scan-sheets";
import { openScanUpload } from "@/lib/scan-uploads";

/**
 * Open a chunked card-scan upload (#590).
 *
 * The scan itself never crosses this route — only its description does, which is what lets the size
 * and the format be refused *before* 200 MB have been sent. The answer carries the chunk size this
 * instance is configured for, so the client is told how to send the file rather than having to know
 * (`STAMPORAMA_UPLOAD_CHUNK_KB` is the operator's dial, and a client with the number compiled in
 * would ignore it).
 *
 * `side=front` with no `batchNo` opens a new batch and `side=back` names the batch its front is in,
 * exactly as the single-request route did — the questions the upload answers are unchanged, they
 * are just asked at the start instead of alongside the bytes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { purchaseId } = await params;

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
    const opened = await openScanUpload(session.user.id, purchaseId, {
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
      // A scan over `MAX_UPLOAD_BYTES` is refused with the status a too-large upload has always been
      // refused with, even though nothing has been sent yet: it is the same answer to the same
      // question, and the client's error path should not have to learn a second one.
      const tooLarge = err.message.includes("too large");
      return NextResponse.json({ error: err.message }, { status: tooLarge ? 413 : 400 });
    }
    return NextResponse.json({ error: "Failed to start the upload." }, { status: 500 });
  }
}
