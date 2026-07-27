import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listIssueMembers } from "@/lib/issues";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ collectionId: string; issueId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, issueId } = await params;
  const sp = new URL(request.url).searchParams;
  const displayConditionId = sp.get("displayConditionId") || undefined;
  const displayFormatId = sp.get("displayFormatId") || null;

  try {
    const members = await listIssueMembers(
      session.user.id,
      collectionId,
      issueId,
      displayConditionId,
      displayFormatId
    );
    return NextResponse.json({ members });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
