import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { AlbumOrnamentError, uploadAlbumOrnament } from "@/lib/album-ornament-store";
import { MAX_ORNAMENT_SVG_BYTES } from "@/lib/album-ornament-svg";

// **Uploading a corner ornament** for the album page frame (#1427), from the album template's frame
// field and from Settings → Albums.
//
// Multipart through a route handler rather than a server action, the list import's boundary before
// it: the payload is a file the collector picked. The file is read into a drawing here and refused
// with the reader's own reason if it cannot be — never stored first and found wanting on a card.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_ORNAMENT_SVG_BYTES) {
    return NextResponse.json(
      { error: "This file is too large to be a corner ornament (1 MB at most)." },
      { status: 413 }
    );
  }

  try {
    const ornament = await uploadAlbumOrnament(
      ownerId,
      collectionId,
      file.name,
      Buffer.from(await file.arrayBuffer())
    );
    return NextResponse.json({ id: ornament.id, name: ornament.name }, { status: 201 });
  } catch (err) {
    if (err instanceof AlbumOrnamentError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[album-ornaments] upload failed:", err);
    return NextResponse.json({ error: "The ornament could not be saved. Please try again." }, { status: 500 });
  }
}
