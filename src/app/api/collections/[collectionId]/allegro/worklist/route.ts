import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAllegroWorklist } from "@/lib/allegro-worklist";

// Everything the Allegro worklist screen shows (#467): the connection's own state, when the sync
// last ran, the order lines still waiting to be recorded as sales, and the listings that ended
// without selling.
//
// Unpaginated, like the bulk listing workspace's batch (#322) and for the same reason: this is a
// list whose whole purpose is to empty, and a page boundary in it would hide the tail of exactly the
// work the collector opened the screen to finish.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  try {
    return NextResponse.json(await getAllegroWorklist(session.user.id, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
