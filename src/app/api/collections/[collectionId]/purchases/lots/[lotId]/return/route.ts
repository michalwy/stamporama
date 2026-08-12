import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLotReturn } from "@/lib/purchases";

/** What one lot cost and what selling its copies has brought back so far (#559) — the order-level
 * figure, narrowed to the line it was bought as. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lotId } = await params;
  try {
    return NextResponse.json(await getLotReturn(session.user.id, lotId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
