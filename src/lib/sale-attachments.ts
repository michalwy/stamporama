import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getActiveStorage } from "./storage";
import { attachmentExtension, attachmentKind } from "./conversation-attachment-rules";
import {
  ConversationAttachmentError,
  deleteConversationAttachmentBytes,
  prepareConversationAttachment,
  type ConversationAttachmentData,
  type ConversationAttachmentInput,
  type ConversationAttachmentRef,
} from "./conversation-attachments";

// A sale's own files (#2198): photos of the packed parcel and its contents, the posting receipt, a
// tracking slip — what settles a dispute about a lost or damaged parcel. One module for every
// writer: the sale screen's upload route and removal action, the phone's *Add photo*, and the agent
// API.
//
// **Built as the conversation log's files are** (#2150, ADR-0073 §7), and through the same checks:
// a file is read by `prepareConversationAttachment` — what it is from its bytes, the upload limit,
// a picture's thumbnail — and its bytes are deleted by `deleteConversationAttachmentBytes`. Only the
// owner differs, and with it the folder: `<collectionId>/sale/<uuid>/`. **As many as needed**, so
// unlike an entry's there is no count limit; the agent API bounds what one call sends.
//
// **Written before the rows, deleted after them**, as the log's are. **The cascade from a sale drops
// rows only**, so `deleteSale` reads {@link saleAttachmentRefs} first and hands them to
// `deleteConversationAttachmentBytes` once the delete went through; `mergeSales` moves them to the
// sale that remains.

/** Thrown for a file or a removal the caller has to change something about. */
export class SaleAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleAttachmentError";
  }
}

/** A sale's file as every reader is told it — the conversation log's shape. */
export type SaleAttachmentData = ConversationAttachmentData;

const SELECT = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  thumbKey: true,
  widthPx: true,
  heightPx: true,
  createdAt: true,
} as const satisfies Prisma.SaleAttachmentSelect;

/** Oldest first: the order they were added in. */
const ORDER: Prisma.SaleAttachmentOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];

type Row = Prisma.SaleAttachmentGetPayload<{ select: typeof SELECT }>;

function toData(row: Row): SaleAttachmentData {
  return {
    id: row.id,
    fileName: row.fileName,
    kind: attachmentKind(row.contentType),
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    hasThumb: row.thumbKey !== null,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Add files to a sale in a collection the caller owns, all or none. Answers the new attachments in
 * the order given.
 */
export async function addSaleAttachments(
  ownerId: string,
  saleId: string,
  inputs: readonly ConversationAttachmentInput[]
): Promise<SaleAttachmentData[]> {
  if (inputs.length === 0) return [];
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, collection: { ownerId } },
    select: { collectionId: true },
  });
  if (!sale) throw new SaleAttachmentError("That sale is not in this collection any more.");
  const prepared = [];
  for (const input of inputs) {
    try {
      prepared.push(await prepareConversationAttachment(input));
    } catch (err) {
      if (err instanceof ConversationAttachmentError) throw new SaleAttachmentError(err.message);
      throw err;
    }
  }

  const storage = getActiveStorage();
  const written: string[] = [];
  try {
    const rows: Prisma.SaleAttachmentUncheckedCreateInput[] = [];
    for (const file of prepared) {
      const prefix = `${sale.collectionId}/sale/${randomUUID()}`;
      const storageKey = `${prefix}/original.${attachmentExtension(file.contentType)}`;
      await storage.put(storageKey, file.bytes, file.contentType, "delivery");
      written.push(storageKey);
      let thumbKey: string | null = null;
      if (file.thumb) {
        thumbKey = `${prefix}/thumb.webp`;
        await storage.put(thumbKey, file.thumb, "image/webp", "delivery");
        written.push(thumbKey);
      }
      rows.push({
        collectionId: sale.collectionId,
        saleId,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.bytes.length,
        storageBackend: storage.backend,
        storageKey,
        thumbKey,
        widthPx: file.widthPx,
        heightPx: file.heightPx,
      });
    }
    const created = await prisma.$transaction(
      rows.map((data) => prisma.saleAttachment.create({ data, select: SELECT }))
    );
    return created.map(toData);
  } catch (err) {
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    throw err;
  }
}

/** A sale's files, oldest first, or null when the sale is not the caller's in `collectionId`. */
export async function listSaleAttachments(
  ownerId: string,
  collectionId: string,
  saleId: string
): Promise<SaleAttachmentData[] | null> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, collectionId, collection: { ownerId } },
    select: { attachments: { select: SELECT, orderBy: ORDER } },
  });
  return sale ? sale.attachments.map(toData) : null;
}

/** The files of several sales of one collection — the phone's *Sales to do* — keyed by sale. */
export async function listAttachmentsOfSales(
  ownerId: string,
  collectionId: string,
  saleIds: readonly string[]
): Promise<Record<string, SaleAttachmentData[]>> {
  const bySale: Record<string, SaleAttachmentData[]> = {};
  if (saleIds.length === 0) return bySale;
  const rows = await prisma.saleAttachment.findMany({
    where: { saleId: { in: [...saleIds] }, collectionId, collection: { ownerId } },
    select: { ...SELECT, saleId: true },
    orderBy: ORDER,
  });
  for (const row of rows) (bySale[row.saleId] ??= []).push(toData(row));
  return bySale;
}

const REF_SELECT = { storageBackend: true, storageKey: true, thumbKey: true } as const;

/** The bytes of every file the rows matching `where` hold — read before a sale's rows go. */
export async function saleAttachmentRefs(where: Prisma.SaleAttachmentWhereInput): Promise<ConversationAttachmentRef[]> {
  return prisma.saleAttachment.findMany({ where, select: REF_SELECT });
}

/** Remove one file from its sale and delete it. Answers the sale it was on. */
export async function removeSaleAttachment(ownerId: string, attachmentId: string): Promise<{ saleId: string }> {
  const row = await prisma.saleAttachment.findFirst({
    where: { id: attachmentId, collection: { ownerId } },
    select: { saleId: true, ...REF_SELECT },
  });
  if (!row) throw new SaleAttachmentError("That file is not in this collection any more.");
  await prisma.saleAttachment.delete({ where: { id: attachmentId } });
  await deleteConversationAttachmentBytes([row]);
  return { saleId: row.saleId };
}

/** One file for serving, scoped by its collection so an id cannot be read through another. */
export async function getSaleAttachmentForServing(
  collectionId: string,
  attachmentId: string
): Promise<{ fileName: string; contentType: string; storageBackend: string; storageKey: string; thumbKey: string | null } | null> {
  return prisma.saleAttachment.findFirst({
    where: { id: attachmentId, collectionId },
    select: { fileName: true, contentType: true, ...REF_SELECT },
  });
}
