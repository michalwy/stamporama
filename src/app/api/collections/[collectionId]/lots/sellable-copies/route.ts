import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSellableCopies } from "@/lib/sale-lots";

// Copies sellable into a unit lot (ADR-0012, #164): flagged For sale, in collection, unsold,
// not already in the target lot. Enriched inventory rows for the composition picker, filtered
// by the same area / year / search controls as the inventory list.
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
  const areaIdsParam = sp.get("areaIds");
  const yearParam = sp.get("year");
  const year =
    yearParam === "none"
      ? ("none" as const)
      : yearParam && /^\d+$/.test(yearParam)
        ? parseInt(yearParam, 10)
        : undefined;

  const excludeIdsParam = sp.get("excludeIds");
  try {
    const items = await listSellableCopies(session.user.id, collectionId, {
      lotId: sp.get("lotId") || undefined,
      areaIds: areaIdsParam ? areaIdsParam.split(",") : undefined,
      search: sp.get("search") || undefined,
      year,
      stampId: sp.get("stampId") || undefined,
      conditionId: sp.get("conditionId") || undefined,
      excludeIds: excludeIdsParam ? excludeIdsParam.split(",") : undefined,
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
