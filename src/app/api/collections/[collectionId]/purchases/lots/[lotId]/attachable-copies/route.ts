import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { countAttachableAmong, listAttachableCopies, type AttachableCopiesQuery } from "@/lib/lots";
import { readSearchParam } from "@/lib/text-input";
import { readAttachQuery, readAttachStates } from "@/lib/attach-picker-filters";

/** The picker's question as the query string asks it: the area rail, the state chips (`state`,
 * repeatable — none named is the held copies, #2121), and every other filter, the year, the search
 * and the sort (#2179, `writeAttachQuery`). */
function readQuery(sp: URLSearchParams): AttachableCopiesQuery {
  const areaIds = sp.getAll("areaId");
  return {
    ...readAttachQuery(sp, readSearchParam(sp)),
    areaIds: areaIds.length > 0 ? areaIds : null,
    states: readAttachStates(sp.getAll("state")),
  };
}

/** The copies this open lot could take on (#388) — everything not already on it and not frozen
 * into a closed lot's cost split — one page at a time (#2179): narrowed, searched and ordered here,
 * with the list's total and its year facet. `cursor` is the offset the previous page handed back. */
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
  const cursor = sp.get("cursor");
  try {
    const page = await listAttachableCopies(session.user.id, lotId, readQuery(sp), {
      offset: cursor && /^\d+$/.test(cursor) ? parseInt(cursor, 10) : 0,
    });
    return NextResponse.json(page);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** How many of the ticked copies (`{ ids }` in the body) the same query string holds (#2179) — the
 * rest are what the Attach button says the filters hide. A POST because a selection can run to
 * hundreds of ids. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lotId } = await params;
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
  try {
    const matching = await countAttachableAmong(
      session.user.id,
      lotId,
      readQuery(request.nextUrl.searchParams),
      ids
    );
    return NextResponse.json({ matching });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
