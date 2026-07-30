import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listAttachableCopies } from "@/lib/lots";

/** The copies this open lot could take on (#388) — everything not already on it and not frozen
 * into a closed lot's cost split. Unpaginated, mirroring the offer composition picker: the dialog
 * scopes by area/year and filters the rest client-side. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lotId } = await params;
  const sp = request.nextUrl.searchParams;
  const areaIds = sp.getAll("areaId");
  const yearParam = sp.get("year");
  const year =
    yearParam === "none"
      ? ("none" as const)
      : yearParam && /^\d+$/.test(yearParam)
        ? parseInt(yearParam, 10)
        : undefined;

  try {
    const items = await listAttachableCopies(session.user.id, lotId, {
      areaIds: areaIds.length > 0 ? areaIds : null,
      search: sp.get("search") || undefined,
      year,
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
