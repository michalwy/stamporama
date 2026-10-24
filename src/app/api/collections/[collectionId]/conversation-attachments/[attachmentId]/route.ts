import { NextRequest, NextResponse } from "next/server";
import { resolveAgentApiCaller, resolveCollectionOwner } from "@/lib/route-auth";
import { getConversationAttachmentForServing } from "@/lib/conversation-attachments";
import { getStorage, toWebStream } from "@/lib/storage";

// **Serving a file kept with a conversation log entry** (#2150) — to the *Conversation* card, and to
// the Assistant, whose entries name this route (`agentConversationAttachmentUrl`). A session or an
// Assistant token pinned to the collection, as the photo route takes: a *read only* token fetches,
// since fetching writes nothing.
//
// `?variant=thumb` is a picture's thumbnail; without it, the file as it came, **inline** under its own
// name so a click opens it at full size — a browser shows a picture or a PDF itself. `?download=1`
// asks for it as a download instead. The bytes are streamed from here rather than redirected to a
// signed URL, because only this origin can say the file's name.
//
// **A sent bearer token decides alone**, read through the agent API's own resolver — the link is one
// the agent API hands out — and must be the URL's collection's; without one, the screen's session
// decides. The card never sends a token, so nothing it does is changed by this.

const IMMUTABLE = "private, max-age=31536000, immutable";

/** A `Content-Disposition` naming the file: an ASCII fallback, and the name itself in RFC 5987. */
function disposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; attachmentId: string }> }
) {
  const { collectionId, attachmentId } = await params;
  let ownerId: string | null;
  if (request.headers.has("authorization")) {
    const caller = await resolveAgentApiCaller(request);
    ownerId = caller && caller.collectionId === collectionId ? caller.ownerId : null;
  } else {
    ownerId = await resolveCollectionOwner(request, collectionId);
  }
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const attachment = await getConversationAttachmentForServing(collectionId, attachmentId);
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thumb = request.nextUrl.searchParams.get("variant") === "thumb";
  if (thumb && !attachment.thumbKey) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = thumb ? attachment.thumbKey! : attachment.storageKey;
  const mime = thumb ? "image/webp" : attachment.contentType;

  let object;
  try {
    object = await getStorage(attachment.storageBackend).get(key, mime, "delivery");
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const download = request.nextUrl.searchParams.get("download") !== null;
  return new Response(toWebStream(object.stream), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(object.sizeBytes),
      ...(thumb ? {} : { "Content-Disposition": disposition(download ? "attachment" : "inline", attachment.fileName) }),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": IMMUTABLE,
    },
  });
}
