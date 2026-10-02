import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listLotBulkScopeRefs, readLotBulkScope } from "@/lib/lots";

/**
 * Which of the intake screen's selected copies already sit in one location, by ref (#1535).
 *
 * The Store dialog's figure strip counts a copy already on the card as neither *added* nor a second
 * time in the total, and the selection cannot say that itself — a ticked group runs past the loaded
 * rows. Read through the same {@link readLotBulkScope} the write uses, so the copies counted are
 * the copies written.
 */
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
  const locationId = sp.get("locationId")?.trim();
  if (!locationId) {
    return NextResponse.json({ error: "Missing location" }, { status: 400 });
  }
  const scope = readLotBulkScope((name) => sp.get(name));

  try {
    return NextResponse.json(
      await listLotBulkScopeRefs(session.user.id, collectionId, scope, locationId)
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
