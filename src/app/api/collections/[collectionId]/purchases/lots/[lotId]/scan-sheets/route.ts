import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  listLotScans,
  uploadSheet,
  ScanAuthError,
  ScanValidationError,
  type SheetSide,
} from "@/lib/scan-sheets";
import { MAX_UPLOAD_BYTES } from "@/lib/photos/process";

/** Every scan batch on a lot (#566) — what the Scans card renders and what the review editor
 * reloads a previous cut from. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lotId } = await params;
  try {
    return NextResponse.json({ batches: await listLotScans(session.user.id, lotId) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/**
 * Upload a card scan to a lot (#566).
 *
 * A multipart route handler rather than a server action, the same boundary every other binary
 * upload in the app uses (ADR-0011): `src/app/actions/` stays JSON-shaped. The scan itself is
 * **retained** — this is not a staged upload, and there is no pending state to promote later.
 *
 * `side=front` with no `batchNo` opens a new batch; `side=back` names the batch its front is in.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lotId } = await params;

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
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Scan is too large (max 60 MB)." }, { status: 413 });
  }

  const rawSide = form.get("side");
  if (rawSide !== "front" && rawSide !== "back") {
    return NextResponse.json({ error: "Side must be front or back." }, { status: 400 });
  }
  const side: SheetSide = rawSide;

  const rawBatch = form.get("batchNo");
  let batchNo: number | undefined;
  if (typeof rawBatch === "string" && rawBatch.trim() !== "") {
    const parsed = Number(rawBatch);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json({ error: "Invalid batch." }, { status: 400 });
    }
    batchNo = parsed;
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const sheet = await uploadSheet(session.user.id, lotId, {
      bytes,
      mime: file.type,
      side,
      batchNo,
    });
    return NextResponse.json(sheet, { status: 201 });
  } catch (err) {
    if (err instanceof ScanAuthError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ScanValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to process scan." }, { status: 500 });
  }
}
