import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listHeldCopyPictures } from "@/lib/stamp-holdings";

// The copies the collection holds of one stamp, with their photos (#1207) — read by the intake
// step's comparison, opened from #562's *you hold* line, so the incoming piece can be looked at
// beside the copies already held.
//
// `exclude` names the copy a re-identified scan tile already became: that copy is the piece being
// identified, not one to compare it with. No stamp named is answered as "nothing to show", as the
// holdings route beside it does — this is a read.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const stampId = request.nextUrl.searchParams.get("stampId");
  if (!stampId) {
    return NextResponse.json({ copies: [] });
  }
  const exclude = request.nextUrl.searchParams.get("exclude") || null;

  try {
    const copies = await listHeldCopyPictures(session.user.id, collectionId, stampId, exclude);
    return NextResponse.json({ copies });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
