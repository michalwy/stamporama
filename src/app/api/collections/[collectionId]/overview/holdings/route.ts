import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getOverviewHoldings } from "@/lib/overview";

// The Overview screen's Holdings section (#1398): how many copies the collection holds, by
// disposition and by intake state. Its own route beside `overview/value` and `overview/progress` so
// each section loads — and shows its skeleton — on its own (#649).
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
    return NextResponse.json(await getOverviewHoldings(session.user.id, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
