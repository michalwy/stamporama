import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { previewOfferGeneration } from "@/lib/offer-generator";
import { parseGeneratorRequest } from "@/lib/offer-generator-rules";
import { readItemFilters } from "../../items/item-filters";

// The preview of a bulk offer pass from the Copies list (#1287). Read-only; confirming it is the
// `generateOffersAction` server action, which re-reads and re-plans (#717).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const parsed = parseGeneratorRequest(request.nextUrl.searchParams);
  // Platform, status, mode and packaging are all the collector's to state; none is guessed.
  if (!parsed) {
    return NextResponse.json({ error: "Choose a platform, a status, a mode and a packaging." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await previewOfferGeneration(session.user.id, collectionId, {
        ...parsed,
        filters: readItemFilters(new URLSearchParams(parsed.filters)),
      })
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
