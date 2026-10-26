import { attachmentKind } from "../conversation-attachment-rules";
import { agentSaleAttachmentUrl } from "./photo-url";
import type { AgentConversationAttachment, ConversationAttachmentLike } from "./conversation-log-reads";

// A sale's own files (#2198) as the agent reads them — shipment photos, posting receipts — in the
// shape a conversation entry's files have (#2150): a name, a type, a size and a link, never the
// bytes. Pure, so it unit-tests without Prisma.

/** A sale's file, as an agent reads it. */
export type AgentSaleAttachment = AgentConversationAttachment;

export function agentSaleAttachment(attachment: ConversationAttachmentLike, collectionId: string): AgentSaleAttachment {
  return {
    id: attachment.id,
    name: attachment.fileName,
    type: attachmentKind(attachment.contentType),
    bytes: attachment.sizeBytes,
    url: agentSaleAttachmentUrl(collectionId, attachment.id),
  };
}

/** A sale's files as `list_sale_attachments` answers. */
export interface AgentSaleAttachments {
  readonly sale: { readonly id: string; readonly saleNo: number };
  readonly attachments: readonly AgentSaleAttachment[];
}

/** One file of `add_sale_attachments`, answered. */
export type AgentSaleAttachmentAnswer =
  | { readonly index: number; readonly status: "attached"; readonly attachment: AgentSaleAttachment }
  | { readonly index: number; readonly status: "refused"; readonly reason: string };

export interface AgentSaleAttachmentBatch {
  readonly attached: number;
  readonly refused: number;
  readonly files: readonly AgentSaleAttachmentAnswer[];
  /** The sale's files as they now stand. */
  readonly sale: AgentSaleAttachments;
}

export function summarizeSaleAttachmentBatch(
  answers: readonly AgentSaleAttachmentAnswer[],
  sale: AgentSaleAttachments
): AgentSaleAttachmentBatch {
  return {
    attached: answers.filter((answer) => answer.status === "attached").length,
    refused: answers.filter((answer) => answer.status === "refused").length,
    files: answers,
    sale,
  };
}
