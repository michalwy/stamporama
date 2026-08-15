import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listIssueGroupCompleteness } from "@/lib/items";
import { readItemFilters } from "../../item-filters";

/**
 * Per-checklist, per-condition completeness for the issue groups on screen (#594).
 *
 * Its own route rather than a field on the groups page, exactly as #563's lot completeness is: the
 * figure is only drawn in the *by issue* grouping, and folding it into `issue-groups` would make
 * every reader of that page pay for the checklist read. It takes the list's whole filter set — the
 * figures are counted over the copies the list is showing — plus the issues actually on screen.
 */
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
  const issueIds = (sp.get("issueIds") ?? "").split(",").filter(Boolean);

  try {
    const byIssue = await listIssueGroupCompleteness(
      session.user.id,
      collectionId,
      issueIds,
      readItemFilters(sp)
    );
    return NextResponse.json(byIssue);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
