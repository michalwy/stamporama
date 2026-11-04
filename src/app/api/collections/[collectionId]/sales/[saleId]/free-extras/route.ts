import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listFreeExtraCandidates, SaleActionBlockedError } from "@/lib/sales";

// The copies a sale may give away as free extras (#2408), ranked cheapest first with their values in
// the sale's currency. The dialog proposes from them as the limits are typed, so this is read once.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; saleId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { saleId } = await params;
  try {
    return NextResponse.json(await listFreeExtraCandidates(session.user.id, saleId));
  } catch (e) {
    if (e instanceof SaleActionBlockedError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
