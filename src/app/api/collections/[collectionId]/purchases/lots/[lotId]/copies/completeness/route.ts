import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getIntakeIssueIds } from "@/lib/items";
import { getLotSetCompleteness } from "@/lib/lot-set-completeness";

/** Per-checklist for-sale completeness for the issue groups of one lot (#563). Its own route rather
 * than a field on the copies summary: the figure is only drawn in the *by issue* view, and folding
 * the collection-wide read into the summary would make every flat-view reader pay for it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, lotId } = await params;
  try {
    const issueIds = await getIntakeIssueIds(session.user.id, collectionId, { lotId });
    const byIssue = await getLotSetCompleteness(session.user.id, collectionId, issueIds, {
      lotId,
    });
    return NextResponse.json(byIssue);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
