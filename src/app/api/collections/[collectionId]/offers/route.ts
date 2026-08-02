import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listOffersPaginated } from "@/lib/offers";
import { isOfferState } from "@/lib/offer-rules";

// Paginated offers list for the Offers screen (ADR-0013). Filters by platform + state, or the
// derived "needs action" overlay (active offers holding a set sold elsewhere).
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
  // A comma-separated set since the state chips became multi-select (#475); unknown tokens are
  // dropped rather than refused, the chips being the authority on what exists.
  const states = (sp.get("state") || "").split(",").filter(isOfferState);
  const needsAction = sp.get("needsAction") === "1";
  const search = sp.get("search") || undefined;
  const includeClosed = sp.get("includeClosed") === "1";

  try {
    const result = await listOffersPaginated(session.user.id, collectionId, {
      offset,
      platformId,
      states,
      needsAction,
      search,
      includeClosed,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
