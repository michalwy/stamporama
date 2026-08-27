import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getOverviewProgress } from "@/lib/overview";

// The Overview screen's Progress section (#651): coverage by area, checklist completeness, growth
// and the open-wants gap. Its own route beside `overview/value` so each section loads — and shows
// its skeleton — on its own (#649).
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
    return NextResponse.json(await getOverviewProgress(session.user.id, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
