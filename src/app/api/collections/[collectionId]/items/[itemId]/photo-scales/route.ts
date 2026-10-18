import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PhotoScaleError, readCopyPhotoScales } from "@/lib/photo-scales";

// One copy's photos with what each was scanned with (#2061), and the profiles to choose from — the
// copy's Photos card reads it when it shows the scales.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; itemId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;
  try {
    return NextResponse.json(await readCopyPhotoScales(session.user.id, itemId));
  } catch (err) {
    if (err instanceof PhotoScaleError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
