import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PhotoScaleError, readScanningSetup } from "@/lib/photo-scales";

// The collection's scanning profiles and its default (#2061) — what a dialog that gives photos a
// scale offers, read when it opens rather than carried down from every page that can open it.
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
    return NextResponse.json(await readScanningSetup(session.user.id, collectionId));
  } catch (err) {
    if (err instanceof PhotoScaleError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
