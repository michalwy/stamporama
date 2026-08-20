import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listOfferableCopies } from "@/lib/trade-lines";

/** The copies this trade could still promise (#637) — in hand, unsold, not already committed to a
 * live trade. Unpaginated, mirroring the offer composition picker: the dialog scopes by area and
 * year here and filters the rest client-side, so its facets and its rows cannot disagree.
 *
 * `forTrade` defaults to **on**: the disposition is where a collector files what they are willing
 * to part with, and it is the right list to open on — but the picker can turn it off, because a
 * partner routinely asks for a copy by name that was never marked. */
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
  const areaIds = sp.getAll("areaId");
  const yearParam = sp.get("year");
  const year =
    yearParam === "none"
      ? ("none" as const)
      : yearParam && /^\d+$/.test(yearParam)
        ? parseInt(yearParam, 10)
        : undefined;

  try {
    const items = await listOfferableCopies(session.user.id, tradeId, {
      areaIds: areaIds.length > 0 ? areaIds : null,
      search: sp.get("search") || undefined,
      year,
      forTradeOnly: sp.get("forTrade") !== "false",
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
