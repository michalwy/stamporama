import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findDuplicateIssuesByName } from "@/lib/issues";

/** Existing issues in an area that share a proposed name (trimmed, case-insensitive), for the
 * non-blocking duplicate-name warning shown while creating an issue (#178). Requires both
 * `areaId` and `name`; a blank name returns no matches. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;
  const areaId = sp.get("areaId") || "";
  const name = sp.get("name") || "";

  if (!areaId || !name.trim()) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const matches = await findDuplicateIssuesByName(
      session.user.id,
      collectionId,
      areaId,
      name
    );
    return NextResponse.json({ matches });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
