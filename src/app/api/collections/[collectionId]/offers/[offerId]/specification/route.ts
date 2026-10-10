import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readOfferSpecification } from "@/lib/offer-specification";
import { specificationText } from "@/lib/offer-specification-rules";

// An offer's specification as plain text (#1759), for the offer screen's *Copy specification as
// text*. The same read as the printable page (#1758), so the two list the same copies in the same
// order and language; only the rendering differs.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, offerId } = await params;
  const spec = await readOfferSpecification(session.user.id, offerId);
  if (!spec || spec.collectionId !== collectionId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ text: specificationText(spec), count: spec.rows.length });
}
