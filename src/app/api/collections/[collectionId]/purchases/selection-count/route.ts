import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { countLotBulkScope, readLotBulkScope } from "@/lib/lots";

/**
 * How many copies the intake screen's current selection holds (#571).
 *
 * The action bar cannot count itself. A ticked issue group under a filter chip has no
 * client-side figure — the intake summaries count whole groups — and `unpriced` is a derived
 * valuation rather than a column. So the number the bar prints and the number the write touches
 * come from one place, read through the same {@link readLotBulkScope} the write uses.
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
  const scope = readLotBulkScope((name) => sp.get(name));

  try {
    const count = await countLotBulkScope(session.user.id, collectionId, scope);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
