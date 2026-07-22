import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { searchEligibleLots } from "@/lib/offers";

// Eligible-lot search for the Offers-screen create picker (ADR-0012, #165): non-dissolved lots
// holding ≥1 member, matched case-insensitively on title, capped at 20.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const query = request.nextUrl.searchParams.get("search") ?? "";

  try {
    const items = await searchEligibleLots(session.user.id, collectionId, query);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
