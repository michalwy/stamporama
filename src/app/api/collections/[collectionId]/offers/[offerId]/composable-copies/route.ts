import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listComposableCopies } from "@/lib/offers";
import { readSearchParam } from "@/lib/text-input";
import { ISSUE_FORMAT_FILTER_PARAM, parseIssueFormatIds } from "@/lib/issue-format-filter";

// Copies eligible to add to an offer's set (ADR-0013): For sale, delivered, not sold, and not
// already in a set of this offer. `notOnOpenOffer=true` narrows them to the copies on no other open
// offer (#2338).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, offerId } = await params;
  const sp = request.nextUrl.searchParams;
  const search = readSearchParam(sp);
  const areaIds = sp.getAll("areaId");

  try {
    const items = await listComposableCopies(session.user.id, collectionId, {
      offerId,
      notOnOpenOffer: sp.get("notOnOpenOffer") === "true",
      search,
      areaIds: areaIds.length > 0 ? areaIds : undefined,
      issueFormatIds: parseIssueFormatIds(sp.get(ISSUE_FORMAT_FILTER_PARAM)),
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
