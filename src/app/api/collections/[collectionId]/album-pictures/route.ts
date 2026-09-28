import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import {
  AlbumPictureError,
  MAX_ALBUM_PICTURE_BYTES,
  uploadAlbumPicture,
} from "@/lib/album-pictures";

// **Uploading a picture** into the collection's library for the album's free pages (#1429), from the
// page editor.
//
// Multipart through a route handler rather than a server action, the ornament upload's boundary
// (#1427): the payload is a file the collector picked. An SVG is read into outlines here, or
// rasterised when the reader does not follow it; a file that is neither SVG, PNG nor JPEG is refused
// with the reason — never stored first and found wanting on a card.

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
  if (file.size > MAX_ALBUM_PICTURE_BYTES) {
    return NextResponse.json(
      { error: "This file is too large for a picture (25 MB at most)." },
      { status: 413 }
    );
  }

  try {
    const picture = await uploadAlbumPicture(
      ownerId,
      collectionId,
      file.name,
      Buffer.from(await file.arrayBuffer())
    );
    return NextResponse.json(picture, { status: 201 });
  } catch (err) {
    if (err instanceof AlbumPictureError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[album-pictures] upload failed:", err);
    return NextResponse.json({ error: "The picture could not be saved. Please try again." }, { status: 500 });
  }
}
