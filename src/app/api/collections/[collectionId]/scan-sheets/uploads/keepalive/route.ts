import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { keepScanUploadsAlive } from "@/lib/scan-uploads";
import { readUploadIds } from "../upload-ids";

/**
 * The page sending a batch of card scans is still open (#1568). Asked every minute for the files it
 * holds that are not being sent right now — waiting their turn, or failed and waiting for a retry —
 * so none of them is taken for an upload whose page closed.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ids = await readUploadIds(request);
  if (!ids) return NextResponse.json({ error: "Invalid uploads." }, { status: 400 });
  await keepScanUploadsAlive(session.user.id, ids);
  return NextResponse.json({ ok: true });
}
