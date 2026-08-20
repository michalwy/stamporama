import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listTradeLinePage } from "@/lib/trade-lines";
import { isTradeSide } from "@/lib/trade-rules";
import { readTradeGroupLevels } from "@/lib/trade-grouping";

/**
 * One page of one side of one section of a trade (#637).
 *
 * Per `(section, side)` rather than per trade, because that is the unit the screen scrolls: the two
 * columns are two independent bags with their own search, their own filters and their own scroll
 * position, and a single endpoint over both would make either column's *next page* depend on the
 * other's.
 *
 * The arrangement is a **parameter**, not a client-side pass: grouping computed over one page would
 * lie about the pages not fetched yet.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; tradeId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tradeId } = await params;
  const sp = request.nextUrl.searchParams;

  const sectionId = sp.get("sectionId") ?? "";
  const sideParam = sp.get("side") ?? "";
  if (!sectionId || !isTradeSide(sideParam)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const offsetParam = sp.get("offset");
  const offset = offsetParam && /^\d+$/.test(offsetParam) ? parseInt(offsetParam, 10) : 0;
  const conditionIds = sp.getAll("conditionId").filter(Boolean);
  const levels = readTradeGroupLevels((sp.get("group") ?? "").split(",").filter(Boolean));

  try {
    const page = await listTradeLinePage(session.user.id, tradeId, {
      sectionId,
      side: sideParam,
      levels,
      offset,
      pageSize: 50,
      filters: {
        search: sp.get("search")?.trim() || undefined,
        conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
        // Give-side only, and the domain simply never applies it to a receive line — a filter the
        // other column does not offer must still be harmless if it arrives.
        noPhotos: sp.get("noPhotos") === "true",
        missingCatalogValue: sp.get("noCatalogValue") === "true",
      },
    });
    return NextResponse.json(page);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
