import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MAX_UPLOAD_BYTES } from "@/lib/photos/process";
import { attachmentTooLargeMessage } from "@/lib/conversation-attachment-rules";
import { ConversationAttachmentError, addConversationAttachments } from "@/lib/conversation-attachments";

// **Attaching files to a conversation entry by hand** (#2150), from the *Conversation* card.
//
// Multipart through a route handler rather than a server action, as every upload is
// (`storage-and-jobs.md`). **A session only**: the Assistant attaches through the agent API, where its
// token's scope is checked, and this route takes no token so a *read only* one cannot write here.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; entryId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { collectionId, entryId } = await params;
  const entry = await prisma.conversationEntry.findFirst({
    where: { id: entryId, collectionId, collection: { ownerId: session.user.id } },
    select: { id: true },
  });
  if (!entry) return NextResponse.json({ error: "That conversation entry is not in this collection any more." }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const files = form.getAll("file").filter((value): value is File => value instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  const tooLarge = files.find((file) => file.size > MAX_UPLOAD_BYTES);
  if (tooLarge) {
    return NextResponse.json({ error: attachmentTooLargeMessage(tooLarge.name, tooLarge.size, MAX_UPLOAD_BYTES) }, { status: 413 });
  }

  try {
    const attachments = await addConversationAttachments(
      session.user.id,
      entryId,
      await Promise.all(files.map(async (file) => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) })))
    );
    return NextResponse.json({ attachments }, { status: 201 });
  } catch (err) {
    if (err instanceof ConversationAttachmentError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error("[conversation-attachments] upload failed:", err);
    return NextResponse.json({ error: "The file could not be saved. Please try again." }, { status: 500 });
  }
}
