import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { scansInPreparation } from "@/lib/scan-notices";

/**
 * The collection's card scans waiting their turn to be prepared or being prepared (#2099) — what the
 * panel of scans being added shows beside the files the tab itself is still sending, on any screen.
 * Each ask answers at once; the panel asks again only while something is listed.
 */
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
    return NextResponse.json({ scans: await scansInPreparation(session.user.id, collectionId) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
