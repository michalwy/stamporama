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
  const displayConditionId =
    new URL(request.url).searchParams.get("displayConditionId") || undefined;

  try {
    const members = await listIssueMembers(
      session.user.id,
      collectionId,
      issueId,
      displayConditionId
    );
    return NextResponse.json({ members });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
