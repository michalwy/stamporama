import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { offerFilterCounts } from "@/lib/offers";
import { isOfferState } from "@/lib/offer-rules";

// Faceted counts for the offer list's filter controls (#332). Takes the same params as the list
// route: each count ignores its own dimension and respects the rest.
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
  // A comma-separated set since the state chips became multi-select (#475); unknown tokens are
  // dropped rather than refused, the chips being the authority on what exists.
  const states = (sp.get("state") || "").split(",").filter(isOfferState);

  try {
    const counts = await offerFilterCounts(session.user.id, collectionId, {
      platformId: sp.get("platformId") || undefined,
      states,
      search: sp.get("search") || undefined,
      needsAction: sp.get("needsAction") === "1",
      includeClosed: sp.get("includeClosed") === "1",
    });
    return NextResponse.json(counts);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
