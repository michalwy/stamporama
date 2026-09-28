import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { getAlbumPictureForServing } from "@/lib/album-pictures";
import { albumDrawingSvg } from "@/lib/album-ornament-svg";
import { getStorage, toWebStream } from "@/lib/storage";

// **Serving a library picture** (#1429) — for the page editor's canvas and the picture list.
//
// A picture that prints as lines is served as an SVG **written from its outlines** (`albumDrawingSvg`),
// never as the file that was uploaded: the canvas then shows exactly the four commands the PDF draws,
// and nothing the collector uploaded reaches a browser as markup (ADR-0057 §1). A raster is streamed
// as stored — the rasterised PNG of an SVG the reader did not follow, or the upload itself.
//
// A picture is never changed once written, so a response can be cached for as long as a browser
// likes.

const IMMUTABLE = "private, max-age=31536000, immutable";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; pictureId: string }> }
) {
  const { collectionId, pictureId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const picture = await getAlbumPictureForServing(collectionId, pictureId);
  if (!picture) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (picture.drawing) {
    return new Response(albumDrawingSvg(picture.drawing), {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        // Opened on its own rather than through an `<img>`, the document may still run nothing.
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": IMMUTABLE,
      },
    });
  }

  const raster = picture.raster!;
  let object;
  try {
    object = await getStorage(raster.backend).get(raster.key, raster.mime, "delivery");
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(toWebStream(object.stream), {
    status: 200,
    headers: {
      "Content-Type": object.mime,
      "Content-Length": String(object.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": IMMUTABLE,
    },
  });
}
