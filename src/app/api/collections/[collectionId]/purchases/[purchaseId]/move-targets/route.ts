import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listCopiesMoveTargets } from "@/lib/lots";

/** The documents *Move copies to…* (#2123) chooses among: every other purchase and opening
 * balance of the collection, with its lots. Unpaginated — the dialog searches it client-side. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { purchaseId } = await params;
  try {
    const documents = await listCopiesMoveTargets(session.user.id, purchaseId);
    return NextResponse.json({ documents });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
