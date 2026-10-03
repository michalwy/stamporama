import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { interruptScanUploads } from "@/lib/scan-uploads";
import { readUploadIds } from "../upload-ids";

/**
 * The page sending a batch of card scans is closing (#1568): stop the files it had not finished.
 *
 * Sent with `navigator.sendBeacon` as the tab goes, which is why it reads the body as text whatever
 * its type says and answers nothing worth reading — nobody is left to read it. The half-sent scan's
 * parts are removed and each row stays as the report the purchase shows next time it is opened.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ids = await readUploadIds(request);
  if (!ids) return NextResponse.json({ error: "Invalid uploads." }, { status: 400 });
  return NextResponse.json({ interrupted: await interruptScanUploads(session.user.id, ids) });
}
