import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ScanAuthError, ScanValidationError } from "@/lib/scan-sheets";
import { finalizeScanUpload } from "@/lib/scan-uploads";

/**
 * Assemble a chunked upload and store the scan (#590).
 *
 * This is where the bytes stop moving and the work starts: the parts are joined into one local file
 * and it goes through `uploadSheet` → `prepareSheet` exactly as a single-request upload did — a
 * ~140 Mpx decode and the `view` derivative, which is seconds of server work with nothing crossing
 * the wire. Hence the client's second phase: a bar that reached 100% and then sat there would read
 * as a hang at precisely the moment the upload had in fact succeeded.
 *
 * Answers the same `UploadedSheet` the single-request route answered, so everything downstream —
 * the review editor, detection, the cut — meets what it always met.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { uploadId } = await params;
  try {
    const sheet = await finalizeScanUpload(session.user.id, uploadId);
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
