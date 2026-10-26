import { NextRequest } from "next/server";
import { getConversationAttachmentForServing } from "@/lib/conversation-attachments";
import { serveAttachment } from "@/lib/attachment-route";

// **Serving a file kept with a conversation log entry** (#2150) — to the *Conversation* card, and to
// the Assistant, whose entries name this route (`agentConversationAttachmentUrl`). Who may read it,
// the variants and the headers are `serveAttachment`'s, which a sale's files share (#2198).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; attachmentId: string }> }
) {
  const { collectionId, attachmentId } = await params;
  return serveAttachment(request, collectionId, () => getConversationAttachmentForServing(collectionId, attachmentId));
}
