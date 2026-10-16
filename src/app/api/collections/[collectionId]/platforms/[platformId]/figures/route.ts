import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPlatformFigures } from "@/lib/platform-figures";

/** A platform's figures (#1960), for the summary strip on its Settings page. Read on demand rather
 *  than by the Settings loader, so only a platform's own page pays for counting its offers, sales and
 *  purchases. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; platformId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, platformId } = await params;
  const figures = await getPlatformFigures(session.user.id, collectionId, platformId);
  if (!figures) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(figures);
}
