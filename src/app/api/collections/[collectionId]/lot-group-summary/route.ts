import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLotGroupSummary } from "@/lib/lot-group-summary";
import { parseLotGroup } from "@/lib/offer-lot-group-rules";

// The summary of a proposal's or a Facebook post's lots (#2326), `?kind=post|proposal&id=`. Owner-checked
// through the collection.
export async function GET(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const search = request.nextUrl.searchParams;
  const group = parseLotGroup({ kind: search.get("kind"), id: search.get("id") });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await getLotGroupSummary(session.user.id, collectionId, group));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
