import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ScanAuthError, ScanValidationError } from "@/lib/scan-sheets";
import { finalizeScanUpload } from "@/lib/scan-uploads";
import { kickScanUploadWorker } from "@/lib/scan-upload-worker";

/**
 * The last chunk is in: put the scan in the queue to be prepared (#590, #1567).
 *
 * **Answers at once.** Preparing the scan — joining the parts, a ~140 Mpx decode and the `view`
 * derivative — used to happen inside this request, and a large card outlived the proxy in front of
 * the app: Cloudflare gives up after about 100 s with a 524, and the collector was left with a scan
 * whose bytes had all arrived and no card to cut. Now the scan joins a queue the in-process worker
 * prepares one at a time, and the Card scans section reads how it is going from the order's scans.
 *
 * `202`, with where the scan now is. Finalizing an upload already queued — the retry of a request
 * whose answer was lost — answers the same way rather than refusing.
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
    const progress = await finalizeScanUpload(session.user.id, uploadId);
    kickScanUploadWorker();
    return NextResponse.json(progress, { status: 202 });
  } catch (err) {
    if (err instanceof ScanAuthError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ScanValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to finish the upload." }, { status: 500 });
  }
}
