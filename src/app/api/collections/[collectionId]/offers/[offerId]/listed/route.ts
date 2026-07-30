import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { OfferActionBlockedError, recordOfferListed } from "@/lib/offers";

// The listing came back (#412, part of #155): the platform's own entry URL, read from the page the
// sale form landed on, recorded against the offer — which goes `ready → active` with its listing date
// stamped (#320).
//
// Session **or** Assistant bearer token, like the listing kit this answers (#405): the extension is
// the caller in the case this exists for, and it reaches us from the marketplace's own tab where the
// session cookie is not sent. It is the **fallback** path — the page that handed the offer over
// normally publishes it itself through `publishOfferAction`, with the collector watching — so
// `recordOfferListed` is idempotent and the two arriving in either order is a no-op, not a conflict.
//
// The extension only ever reports a URL. What it means — which transition it is, whether it is
// allowed at all — is decided here, on the instance, exactly as it is for every other write.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const { collectionId, offerId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let url: unknown;
  try {
    ({ url } = (await request.json()) as { url?: unknown });
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "A listing URL is required." }, { status: 400 });
  }

  try {
    const outcome = await recordOfferListed(ownerId, offerId, url);
    return NextResponse.json({ outcome });
  } catch (e) {
    // A refusal is the offer's own state saying no — a paused or sold offer is not taken live by a
    // marketplace submission — and its sentence is what the caller has to show.
    if (e instanceof OfferActionBlockedError) {
      return NextResponse.json({ error: e.message, reason: e.reason }, { status: 409 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
