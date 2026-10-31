import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listLocationHistory } from "@/lib/location-moves";

/** One page of what came into a location and what left it, newest first (#2277), narrowed by ref
 *  and by day. A location that groups others answers for everything under it. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ collectionId: string; locationId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, locationId } = await params;
  const url = new URL(request.url);
  try {
    return NextResponse.json(
      await listLocationHistory(session.user.id, collectionId, locationId, {
        ref: url.searchParams.get("ref"),
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        cursor: url.searchParams.get("cursor"),
      })
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
