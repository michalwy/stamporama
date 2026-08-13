import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLocationRefUsage } from "@/lib/locations";

/** The refs already written in one location and the next one to suggest (#565). Read by the file
 * dialog when a location is chosen, so the suggestion and the "this ref already holds N copies"
 * confirmation both come from the location — never from the lot, which shares the box. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; locationId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, locationId } = await params;
  try {
    return NextResponse.json(await getLocationRefUsage(session.user.id, collectionId, locationId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
