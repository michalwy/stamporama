import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemPhotoCovers } from "@/lib/photo-covers";

// One copy's photos with the covers drawn on them for offers (#1665) — the copy's page shows them as
// an overlay that is off until switched on.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; itemId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;
  return NextResponse.json(await listItemPhotoCovers(session.user.id, itemId));
}
