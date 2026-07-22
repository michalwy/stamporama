import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listOffersPaginated } from "@/lib/offers";
import { isOfferState } from "@/lib/offer-rules";

// Paginated offers list for the Offers screen (ADR-0012, #165). Filters by platform + state; a
// `lotId` narrows to one lot's offers (the lot detail panel).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;

  const offsetParam = sp.get("offset");
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;
  const platformId = sp.get("platformId") || undefined;
  const stateParam = sp.get("state");
  const state = stateParam && isOfferState(stateParam) ? stateParam : undefined;
  const lotId = sp.get("lotId") || undefined;

  try {
    const result = await listOffersPaginated(session.user.id, collectionId, {
      offset,
      platformId,
      state,
      lotId,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
