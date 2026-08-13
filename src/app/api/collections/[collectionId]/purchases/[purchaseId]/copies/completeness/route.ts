import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getIntakeIssueIds } from "@/lib/items";
import { getLotSetCompleteness } from "@/lib/lot-set-completeness";

/** The same figure for the order-level *by issue* view, whose groups are merged across every lot of
 * the purchase (#563) — so *from here* means "arrived in this parcel" rather than "in this lot",
 * which is what that view is grouped by. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, purchaseId } = await params;
  try {
    const issueIds = await getIntakeIssueIds(session.user.id, collectionId, { purchaseId });
    const byIssue = await getLotSetCompleteness(session.user.id, collectionId, issueIds, {
      purchaseId,
    });
    return NextResponse.json(byIssue);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
