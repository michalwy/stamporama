import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { searchPlatforms } from "@/lib/platforms";
import { readSearchParam } from "@/lib/text-input";

/** The platforms a picker offers for a new record (#1955): switched on, matching `q` by name. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const query = readSearchParam(request.nextUrl.searchParams, "q") ?? "";
  try {
    const items = await searchPlatforms(session.user.id, collectionId, query);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
