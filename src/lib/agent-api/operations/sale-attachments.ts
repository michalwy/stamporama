import "server-only";
import { prisma } from "../../db";
import { SaleAttachmentError, addSaleAttachments, listSaleAttachments } from "../../sale-attachments";
import { invalidRequest, notFound } from "../errors";
import { requiredString, stringList } from "../params";
import { MAX_ATTACHMENT_FILES, parseAttachmentFileSpec, type AttachmentFileSpec } from "../conversation-log-reads";
import {
  agentSaleAttachment,
  summarizeSaleAttachmentBatch,
  type AgentSaleAttachmentAnswer,
  type AgentSaleAttachmentBatch,
  type AgentSaleAttachments,
} from "../sale-attachment-reads";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// A sale's own files (#2198) — photos of the packed parcel, the posting receipt, a tracking slip:
// what settles a dispute about a lost or damaged parcel. **The agent lists and fetches them, and
// adds one**, as it does a conversation entry's (#2150): a file is sent in the call as base64 in the
// same grammar, and read back as a link to the sale attachment route, which a *read only* token opens.
//
// **Adding a file is the sale screen's own write**, `addSaleAttachments`, so a file the agent sends is
// checked as one the collector uploads is. **It is a record, not an act**: nothing about the sale
// changes, so it does not put the sale *to review* (#1948) — as a conversation entry does not.
// **Removing one stays the collector's**: the agent has no operation for it.

const SALE_ID_PARAMETER: ParameterSpec = {
  name: "saleId",
  in: "path",
  type: "string",
  required: true,
  description: "The sale's id, from `list_sales`, `get_sale`, `sell_offer` or `sell_offer_set`.",
};

const FILE_GRAMMAR =
  "one string each with a field per line written `name=value`: `data` (the file's bytes in base64; a `data:…;base64,` prefix is fine, and it may wrap over lines) is required, `name` (the file's name, e.g. `receipt.jpg`) is optional. A picture (JPEG, PNG, WebP) or a PDF, read from the bytes; anything else is refused";

/** The sale's files as they stand, or not found. */
async function loadSaleAttachments(context: OperationContext, saleId: string): Promise<AgentSaleAttachments> {
  const [sale, attachments] = await Promise.all([
    prisma.sale.findFirst({
      where: { id: saleId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
      select: { id: true, saleNo: true },
    }),
    listSaleAttachments(context.ownerId, context.collectionId, saleId),
  ]);
  if (!sale || !attachments) {
    throw notFound(`No sale with id "${saleId}" is in this token's collection. Use \`list_sales\` to find the right id.`);
  }
  return {
    sale: { id: sale.id, saleNo: sale.saleNo },
    attachments: attachments.map((attachment) => agentSaleAttachment(attachment, context.collectionId)),
  };
}

// ── list_sale_attachments ────────────────────────────────────────────────────

export async function readSaleAttachments(context: OperationContext, params: ParsedParams): Promise<AgentSaleAttachments> {
  return loadSaleAttachments(context, requiredString(params, "saleId"));
}

export const listSaleAttachmentsOperation: Operation = {
  name: "list_sale_attachments",
  method: "GET",
  path: "/sales/{saleId}/attachments",
  description:
    "The collector's own files about a sale — photos of the packed parcel and what went into it, the posting receipt, a tracking slip — oldest first. Each is a link the same token fetches.",
  writes: false,
  parameters: [SALE_ID_PARAMETER],
  result: {
    kind: "object",
    description:
      "`sale` is the sale's `id` and `saleNo`; `attachments` its files, each with `id`, `name`, `type` (`image` or `pdf`), `bytes` and `url` — the file itself, fetched with this same token.",
  },
  handler: async (context, params) => readSaleAttachments(context, params),
};

// ── add_sale_attachments ─────────────────────────────────────────────────────

export async function attachSaleFiles(context: OperationContext, params: ParsedParams): Promise<AgentSaleAttachmentBatch> {
  const saleId = requiredString(params, "saleId");
  await loadSaleAttachments(context, saleId);
  const raw = stringList(params, "files");
  if (raw.length === 0) throw invalidRequest('"files" is empty. Send at least one file.');
  if (raw.length > MAX_ATTACHMENT_FILES) {
    throw invalidRequest(
      `"files" carries ${raw.length} files; one call adds at most ${MAX_ATTACHMENT_FILES}. Send the rest in a second call.`
    );
  }
  const answers: AgentSaleAttachmentAnswer[] = [];
  const toAdd: { index: number; spec: AttachmentFileSpec }[] = [];
  for (const [index, file] of raw.entries()) {
    const parsed = parseAttachmentFileSpec(file, { withEntry: false });
    if (parsed.ok) toAdd.push({ index, spec: parsed.spec });
    else answers.push({ index, status: "refused", reason: parsed.reason });
  }
  // One at a time, so each file is answered on its own.
  for (const { index, spec } of toAdd) {
    try {
      const [attachment] = await addSaleAttachments(context.ownerId, saleId, [{ name: spec.name, bytes: spec.bytes }]);
      answers.push({ index, status: "attached", attachment: agentSaleAttachment(attachment, context.collectionId) });
    } catch (error) {
      if (!(error instanceof SaleAttachmentError)) throw error;
      answers.push({ index, status: "refused", reason: error.message });
    }
  }
  answers.sort((a, b) => a.index - b.index);
  return summarizeSaleAttachmentBatch(answers, await loadSaleAttachments(context, saleId));
}

export const addSaleAttachmentsOperation: Operation = {
  name: "add_sale_attachments",
  method: "POST",
  path: "/sales/{saleId}/attachments",
  description:
    "Add files to a sale — a photo of the packed parcel, the posting receipt, a tracking slip: pictures and PDFs, kept with the sale and shown on it. Nothing else about the sale changes. A file that came with a conversation with the buyer belongs on its conversation entry instead (`attach_conversation_files`).",
  writes: true,
  parameters: [
    SALE_ID_PARAMETER,
    {
      name: "files",
      in: "body",
      type: "string[]",
      required: true,
      description: `The files, at most ${MAX_ATTACHMENT_FILES}, ${FILE_GRAMMAR}.`,
    },
  ],
  result: {
    kind: "object",
    description:
      "`attached` and `refused` count the files; `files` answers each by its `index`: `attached` with the `attachment` (`id`, `name`, `type`, `bytes`, `url`), or `refused` with the `reason` — send that one again alone once fixed. `sale` is the sale's files as they now stand, in `list_sale_attachments`' shape.",
  },
  handler: async (context, params) => attachSaleFiles(context, params),
};
