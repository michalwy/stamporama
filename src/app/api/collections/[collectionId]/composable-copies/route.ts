import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listComposableCopies } from "@/lib/offers";
import { readSearchParam } from "@/lib/text-input";

// Copies eligible to go into an offer not made yet (#2291) — a post's *New lot…* picks them before the
// offer exists: For sale, delivered and not sold, as for an offer's own set. `notOfferedOn` narrows them to
// the copies not yet offered on that platform — a proposal's *New lots…* (#2299), on Direct.
// `notOnOpenOffer=true` to those on no open offer anywhere (#2338), the lots of `exceptProposal` or
// `exceptPost` — the screen's own — not counting.
export async function GET(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;
  const search = readSearchParam(sp);
  const areaIds = sp.getAll("areaId");
  const notOfferedPlatformId = sp.get("notOfferedOn") || undefined;

  try {
    const items = await listComposableCopies(session.user.id, collectionId, {
      search,
      notOfferedPlatformId,
      notOnOpenOffer: sp.get("notOnOpenOffer") === "true",
      ownOffers: {
        proposalId: sp.get("exceptProposal") || null,
        facebookPostId: sp.get("exceptPost") || null,
      },
      areaIds: areaIds.length > 0 ? areaIds : undefined,
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
