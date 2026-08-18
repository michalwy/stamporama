import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getDelcampeWorklist } from "@/lib/delcampe-worklist";

// What the last active-items import left to do (#611), for the *On Delcampe* screen.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { collectionId } = await params;

  try {
    return NextResponse.json(await getDelcampeWorklist(session.user.id, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
