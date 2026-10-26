import { NextRequest } from "next/server";
import { getSaleAttachmentForServing } from "@/lib/sale-attachments";
import { serveAttachment } from "@/lib/attachment-route";

// **Serving a sale's own file** (#2198) — to the sale screen's *Attachments* card, the phone's *Sales
// to do*, and the Assistant, whose reads name this route (`agentSaleAttachmentUrl`). Who may read it,
// the variants and the headers are `serveAttachment`'s, as for a conversation entry's files (#2150).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; attachmentId: string }> }
) {
  const { collectionId, attachmentId } = await params;
  return serveAttachment(request, collectionId, () => getSaleAttachmentForServing(collectionId, attachmentId));
}
