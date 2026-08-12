import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPurchaseReturn } from "@/lib/purchases";

/** What this order cost and what selling its copies has brought back so far (#559). The
 * `collectionId` in the path is the route's scope; ownership is asserted against the purchase
 * itself, which is what resolves the collection. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { purchaseId } = await params;
  try {
    return NextResponse.json(await getPurchaseReturn(session.user.id, purchaseId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
