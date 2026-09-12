import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findSeriesRecombinations } from "@/lib/series-recombination";

// The series one platform's single offers plus its available copies could complete (#1210). Read-only;
// acting on a listed series is #1211's.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const platformId = request.nextUrl.searchParams.get("platformId");
  // Availability is a per-platform question, so there is nothing to answer without one.
  if (!platformId) {
    return NextResponse.json({ error: "Choose a platform." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await findSeriesRecombinations(session.user.id, collectionId, platformId)
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
