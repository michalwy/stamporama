import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listContacts } from "@/lib/contacts";

/** Full contact list for the management UI (#131). The address book is bounded, so the
 * whole list ships in one response and the client filters/searches it locally. Each row
 * carries its purchase `referenceCount` for the delete guard. */
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
    const items = await listContacts(session.user.id, collectionId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
