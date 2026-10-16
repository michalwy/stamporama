import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listPlatforms } from "@/lib/platforms";

/** Every platform of the collection (#1955), switched off ones included — a screen naming the
 *  platforms of records already made needs them all, and one offering platforms for a new record
 *  keeps the switched-on ones. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  try {
    const items = await listPlatforms(session.user.id, collectionId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
