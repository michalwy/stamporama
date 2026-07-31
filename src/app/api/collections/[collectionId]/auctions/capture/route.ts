import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { AuctionActionBlockedError, captureAuctionLot } from "@/lib/auctions";
import {
  normalizeAuctionText,
  normalizeAuctionUrl,
  parseAuctionAmount,
  parseAuctionInstant,
} from "@/lib/auction-rules";

// Capture a watched auction from the marketplace page it is listed on (#355).
//
// Session **or** Assistant token (`resolveCollectionOwner`), like the matcher and the listing kit:
// the extension reaches us cross-site from allegro.pl, where the session cookie is not sent. A
// static segment ahead of `[saleId]`-style routes, and collection-scoped like every other token
// route — a capture is a write into one collection, and the token is pinned to exactly one.
//
// `dryRun` is what the Assistant's window shows before the collector presses Save: which parcel the
// lot lands in, whether the seller is new here, and whether this listing is already being watched.
// It is answered by the same function that performs the write, so the preview cannot describe
// something the save would not do.
//
// The endpoint validates shape and nothing else. Whether a page is an auction at all, and which of
// its figures is a bid rather than an opening price, is the platform module's decision on the page
// itself — the server never sees the listing.

interface CaptureBody {
  dryRun?: unknown;
  platformOfferId?: unknown;
  url?: unknown;
  title?: unknown;
  lotNo?: unknown;
  sellerName?: unknown;
  endsAt?: unknown;
  startingPrice?: unknown;
  currentBid?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as CaptureBody;

  const platformOfferId = str(body.platformOfferId).trim();
  if (!platformOfferId) {
    return NextResponse.json({ error: "This listing carries no offer id." }, { status: 400 });
  }
  const url = normalizeAuctionUrl(str(body.url));
  if (!url) {
    return NextResponse.json({ error: "This listing carries no address." }, { status: 400 });
  }
  const endsAt = parseAuctionInstant(str(body.endsAt));
  if (!endsAt) {
    return NextResponse.json({ error: "This listing states no closing time." }, { status: 400 });
  }
  const startingPrice = parseAuctionAmount(str(body.startingPrice), "Starting price");
  if (!startingPrice.ok) return NextResponse.json({ error: startingPrice.message }, { status: 400 });
  const currentBid = parseAuctionAmount(str(body.currentBid), "Current bid");
  if (!currentBid.ok) return NextResponse.json({ error: currentBid.message }, { status: 400 });

  try {
    const result = await captureAuctionLot(
      ownerId,
      collectionId,
      {
        platformOfferId,
        url,
        title: normalizeAuctionText(str(body.title)),
        lotNo: normalizeAuctionText(str(body.lotNo)),
        sellerName: normalizeAuctionText(str(body.sellerName)),
        endsAt,
        startingPrice: startingPrice.value,
        currentBid: currentBid.value,
      },
      { dryRun: body.dryRun === true }
    );
    return NextResponse.json(result);
  } catch (e) {
    // A domain refusal is the collector's to read — an unset Allegro platform above all, which is
    // fixed on a Settings tab and not by capturing again. Anything else is a 404, matching the other
    // auction routes: a collection the caller cannot reach and one that does not exist are the same
    // answer.
    if (e instanceof AuctionActionBlockedError) {
      return NextResponse.json({ error: e.message, reason: e.reason }, { status: 409 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
