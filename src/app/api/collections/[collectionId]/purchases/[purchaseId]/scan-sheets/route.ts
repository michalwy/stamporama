import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listPurchaseScans } from "@/lib/scan-sheets";

/**
 * An order's card scans.
 *
 * **The upload lives under `uploads/`** (#590), not here: a 1200 dpi card is 100–200 MB and no
 * ordinary deployment can carry that in one request body — nginx defaults `client_max_body_size` to
 * 1 MB, Cloudflare caps at 100 MB — so a scan is opened, sent in parts and finalized. The
 * single-request `POST` this route used to carry is gone rather than kept as a fallback: it could
 * only ever serve the cards small enough not to need it, and two ways to upload the same thing,
 * with nothing calling one of them, reads as an unfinished refactor.
 *
 * Copy photos are the asymmetry that *is* deliberate: a few megabytes will never approach a proxy's
 * limit, so `photos/uploads` keeps the plain single-request path.
 */

/** Every scan batch on an order (#566, re-parented by #586) — what the Card scans section renders
 * and what the review editor reloads a previous cut from. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { purchaseId } = await params;
  try {
    return NextResponse.json(await listPurchaseScans(session.user.id, purchaseId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
