import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSaleLineSetOptions } from "@/lib/sales";

// The sets this line could have gone out as (#697): every still-available set of its own offer,
// plus the one it names today. Fetched only when the *Choose set* picker opens — the sale detail
// draws its lines without it, and an offer at quantity one has nothing to choose among.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; lineId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lineId } = await params;
  const choice = await listSaleLineSetOptions(session.user.id, lineId);
  if (!choice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(choice);
}
