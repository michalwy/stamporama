import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLotPoolSummary } from "@/lib/lot-builder";
import { parseLotBuilderRequest } from "@/lib/lot-builder-criteria";

// The bulk-lot wizard's criteria readout (#759): what the pool holds, answered **without** running a
// pick, so the criteria panel stays live while generating a proposal stays a deliberate act. Reads
// over exactly the same `where` as the proposal's own pool, which is what keeps the two from
// disagreeing about which copies they are about.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const { criteria } = parseLotBuilderRequest(request.nextUrl.searchParams);
  // Everything else is judged against the platform (#259/#334/#506), so there is no pool to read
  // without one — an empty answer here would read as "nothing to list" rather than "nothing asked".
  if (!criteria.platformId) {
    return NextResponse.json({ error: "Choose a platform to build the lot for." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getLotPoolSummary(session.user.id, collectionId, criteria));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
