import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ScanAuthError, ScanValidationError } from "@/lib/scan-sheets";
import { retryScanUpload } from "@/lib/scan-uploads";
import { kickScanUploadWorker } from "@/lib/scan-upload-worker";

/**
 * Prepare a scan again after its preparation failed (#1567) — from the parts already on the server,
 * so nothing is uploaded a second time. The scan goes to the back of the queue.
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
    const progress = await retryScanUpload(session.user.id, uploadId);
    kickScanUploadWorker();
    return NextResponse.json(progress, { status: 202 });
  } catch (err) {
    if (err instanceof ScanAuthError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ScanValidationError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to try the scan again." }, { status: 500 });
  }
}
