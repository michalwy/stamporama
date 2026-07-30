import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getActionItems } from "@/lib/action-items";

// Everything waiting on the collector, for the sidebar's notification centre (#367). Unpaginated
// and capped per group by the read itself: the panel shows the head of each list and links to the
// screen that shows the rest.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;

  try {
    return NextResponse.json(await getActionItems(session.user.id, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
