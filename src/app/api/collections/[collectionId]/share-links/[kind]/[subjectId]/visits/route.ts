import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readShareLinkHistory } from "@/lib/share-link-visits";
import { isShareLinkKind } from "@/lib/share-link-visit-rules";

// A share link's visit history (#2557) as the link's dialog reads it: every link the post, offer,
// proposal, sale or trade has had that still has something to show, each with its visits newest
// first. One route for the five kinds, scoped by the collection the caller owns.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; kind: string; subjectId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, kind, subjectId } = await params;
  if (!isShareLinkKind(kind)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await readShareLinkHistory(session.user.id, collectionId, kind, subjectId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
