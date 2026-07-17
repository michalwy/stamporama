import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { searchIssues } from "@/lib/issues";

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
  const query = sp.get("q") ?? "";
  const areaIdsParam = sp.get("areaIds");
  const areaIds = areaIdsParam ? areaIdsParam.split(",") : undefined;

  try {
    const items = await searchIssues(session.user.id, collectionId, query, areaIds);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
