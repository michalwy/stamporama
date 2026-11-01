import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listComposableCopies } from "@/lib/offers";
import { readSearchParam } from "@/lib/text-input";

// Copies eligible to go into an offer not made yet (#2291) — a post's *New lot…* picks them before the
// offer exists: For sale, delivered and not sold, as for an offer's own set.
export async function GET(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;
  const search = readSearchParam(sp);
  const areaIds = sp.getAll("areaId");

  try {
    const items = await listComposableCopies(session.user.id, collectionId, {
      search,
      areaIds: areaIds.length > 0 ? areaIds : undefined,
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
