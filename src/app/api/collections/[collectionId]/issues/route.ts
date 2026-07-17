import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listIssuesPaginated } from "@/lib/issues";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const cursor = searchParams.get("cursor") ?? undefined;
  const areaIdsParam = searchParams.get("areaIds");
  const areaIds = areaIdsParam ? areaIdsParam.split(",") : undefined;

  try {
    const result = await listIssuesPaginated(session.user.id, collectionId, {
      cursor,
      areaIds,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
