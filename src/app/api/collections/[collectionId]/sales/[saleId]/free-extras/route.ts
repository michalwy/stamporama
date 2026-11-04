import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listFreeExtraCandidates, SaleActionBlockedError } from "@/lib/sales";
import { readIncludeSpecialised } from "@/lib/specialised-checklists-preference";

// The copies a sale may give away as free extras (#2408), ranked cheapest first with their values in
// the sale's currency — whole complete sets apart from the loose copies above them (#2422). The dialog proposes from them as the limits are typed, so this is read once.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; saleId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, saleId } = await params;
  try {
    // Which checklists count as series is the screens' switch (#1617), as for complete-set offers.
    return NextResponse.json(
      await listFreeExtraCandidates(session.user.id, saleId, await readIncludeSpecialised(collectionId))
    );
  } catch (e) {
    if (e instanceof SaleActionBlockedError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
