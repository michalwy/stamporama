import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getActiveStorage, getStorage } from "./storage";
import { MAX_UPLOAD_BYTES, THUMB_MAX_EDGE } from "./photos/process";
import {
  MAX_ATTACHMENTS_PER_ENTRY,
  UNSUPPORTED_ATTACHMENT_MESSAGE,
  attachmentExtension,
  attachmentKind,
  attachmentTooLargeMessage,
  cleanAttachmentName,
  sniffAttachment,
  tooManyAttachmentsMessage,
  type ConversationAttachmentKind,
  type ConversationAttachmentType,
} from "./conversation-attachment-rules";

// Attachments on conversation log entries (#2150, ADR-0073 §7): the files a buyer's message came
// with — a payment confirmation, a photo of a damaged stamp, a certificate — kept with the entry.
// One module for every writer: the card's upload route and removal action, and the agent API.
//
// **Kept as they came.** The bytes are stored as uploaded, under `<collectionId>/conversation/<uuid>/`;
// a picture also gets a WebP thumbnail for the card. What a file is comes from its bytes
// (`sniffAttachment`), never from its name.
//
// **Written before the rows, deleted after them.** The bytes go up first and the rows are created in
// one transaction after, so a row never names a file that is not there; a failure removes what was
// written. A delete drops the rows first and the bytes after, best-effort — a failure leaves an
// orphan file, never a row pointing at nothing. **The cascade from an entry or a contact drops rows
// only**, so every path that deletes an entry reads {@link conversationAttachmentRefs} first and
// hands them to {@link deleteConversationAttachmentBytes} once the delete went through.

/** Thrown for a file or a removal the caller has to change something about. */
export class ConversationAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationAttachmentError";
  }
}

/** An attachment as every reader is told it. */
export interface ConversationAttachmentData {
  id: string;
  fileName: string;
  kind: ConversationAttachmentKind;
  contentType: string;
  sizeBytes: number;
  /** Whether a thumbnail was made — a picture's is; a PDF has none. */
  hasThumb: boolean;
  widthPx: number | null;
  heightPx: number | null;
  createdAt: string;
}

export const ATTACHMENT_SELECT = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  thumbKey: true,
  widthPx: true,
  heightPx: true,
  createdAt: true,
} as const satisfies Prisma.ConversationAttachmentSelect;

/** Oldest first: the order they were attached in. */
export const ATTACHMENT_ORDER: Prisma.ConversationAttachmentOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];

type AttachmentRow = Prisma.ConversationAttachmentGetPayload<{ select: typeof ATTACHMENT_SELECT }>;

export function toAttachmentData(row: AttachmentRow): ConversationAttachmentData {
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

/** One file as a writer hands it over. */
export interface ConversationAttachmentInput {
  name: string;
  bytes: Buffer;
}

/** A file checked and read, ready to store. */
interface PreparedAttachment {
  fileName: string;
  contentType: ConversationAttachmentType;
  bytes: Buffer;
  thumb: Buffer | null;
  widthPx: number | null;
  heightPx: number | null;
}

/**
 * Check one file: its size, what its bytes are, and — for a picture — that it can be read, making its
 * thumbnail. Throws {@link ConversationAttachmentError} with the sentence saying why it is refused.
 */
export async function prepareConversationAttachment(input: ConversationAttachmentInput): Promise<PreparedAttachment> {
  const type = sniffAttachment(input.bytes);
  const shownName = input.name.trim() || "The file";
  if (input.bytes.length === 0) throw new ConversationAttachmentError(`"${shownName}" is empty.`);
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw new ConversationAttachmentError(attachmentTooLargeMessage(shownName, input.bytes.length, MAX_UPLOAD_BYTES));
  }
  if (!type) throw new ConversationAttachmentError(`"${shownName}": ${UNSUPPORTED_ATTACHMENT_MESSAGE}`);
  const fileName = cleanAttachmentName(input.name, type);
  if (type === "application/pdf") {
    return { fileName, contentType: type, bytes: input.bytes, thumb: null, widthPx: null, heightPx: null };
  }
  try {
    // `rotate()` with no angle turns by the EXIF orientation, so a phone's photo thumbnails upright;
    // the stored original keeps its tag and a browser honours it when it is opened.
    const { data, info } = await sharp(input.bytes, { failOn: "error" })
      .rotate()
      .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp()
      .toBuffer({ resolveWithObject: true });
    const meta = await sharp(input.bytes).metadata();
    const turned = (meta.orientation ?? 1) >= 5;
    const width = meta.width ?? info.width;
    const height = meta.height ?? info.height;
    return {
      fileName,
      contentType: type,
      bytes: input.bytes,
      thumb: data,
      widthPx: turned ? height : width,
      heightPx: turned ? width : height,
    };
  } catch {
    throw new ConversationAttachmentError(`"${fileName}" could not be read as a picture.`);
  }
}

function attachmentPrefix(collectionId: string): string {
  return `${collectionId}/conversation/${randomUUID()}`;
}

/**
 * Attach files to an entry in a collection the caller owns, all or none. Answers the new
 * attachments in the order given.
 */
export async function addConversationAttachments(
  ownerId: string,
  entryId: string,
  inputs: readonly ConversationAttachmentInput[]
): Promise<ConversationAttachmentData[]> {
  if (inputs.length === 0) return [];
  const entry = await prisma.conversationEntry.findFirst({
    where: { id: entryId, collection: { ownerId } },
    select: { collectionId: true, _count: { select: { attachments: true } } },
  });
  if (!entry) throw new ConversationAttachmentError("That conversation entry is not in this collection any more.");
  if (entry._count.attachments + inputs.length > MAX_ATTACHMENTS_PER_ENTRY) {
    throw new ConversationAttachmentError(tooManyAttachmentsMessage(entry._count.attachments, inputs.length));
  }
  const prepared: PreparedAttachment[] = [];
  for (const input of inputs) prepared.push(await prepareConversationAttachment(input));

  const storage = getActiveStorage();
  const written: string[] = [];
  try {
    const rows: Prisma.ConversationAttachmentUncheckedCreateInput[] = [];
    for (const file of prepared) {
      const prefix = attachmentPrefix(entry.collectionId);
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
        collectionId: entry.collectionId,
        entryId,
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
      rows.map((data) => prisma.conversationAttachment.create({ data, select: ATTACHMENT_SELECT }))
    );
    return created.map(toAttachmentData);
  } catch (err) {
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    throw err;
  }
}

/** Where an attachment's bytes are — read before its rows go, deleted after. */
export interface ConversationAttachmentRef {
  storageBackend: string;
  storageKey: string;
  thumbKey: string | null;
}

const REF_SELECT = { storageBackend: true, storageKey: true, thumbKey: true } as const;

/** The bytes of every attachment the rows matching `where` hold. */
export async function conversationAttachmentRefs(
  where: Prisma.ConversationAttachmentWhereInput
): Promise<ConversationAttachmentRef[]> {
  return prisma.conversationAttachment.findMany({ where, select: REF_SELECT });
}

/** Delete the bytes {@link conversationAttachmentRefs} read, best-effort: a failure is logged and
 *  leaves an orphan file, never a refusal of the delete that already went through. */
export async function deleteConversationAttachmentBytes(refs: readonly ConversationAttachmentRef[]): Promise<void> {
  await Promise.all(
    refs.flatMap((ref) =>
      [ref.storageKey, ref.thumbKey].flatMap((key) =>
        key
          ? [
              getStorage(ref.storageBackend)
                .delete(key)
                .catch((err: unknown) => console.warn(`[conversation-attachments] could not delete ${key}: ${String(err)}`)),
            ]
          : []
      )
    )
  );
}

/** Remove one attachment and its file. Answers the entry it was on. */
export async function removeConversationAttachment(ownerId: string, attachmentId: string): Promise<{ entryId: string }> {
  const row = await prisma.conversationAttachment.findFirst({
    where: { id: attachmentId, collection: { ownerId } },
    select: { entryId: true, ...REF_SELECT },
  });
  if (!row) throw new ConversationAttachmentError("That attachment is not in this collection any more.");
  await prisma.conversationAttachment.delete({ where: { id: attachmentId } });
  await deleteConversationAttachmentBytes([row]);
  return { entryId: row.entryId };
}

/** One attachment for serving, scoped by its collection so an id cannot be read through another. */
export async function getConversationAttachmentForServing(
  collectionId: string,
  attachmentId: string
): Promise<{ fileName: string; contentType: string; storageBackend: string; storageKey: string; thumbKey: string | null } | null> {
  return prisma.conversationAttachment.findFirst({
    where: { id: attachmentId, collectionId },
    select: { fileName: true, contentType: true, ...REF_SELECT },
  });
}

/** One attachment of an entry in `collectionId`, or null. */
export async function getConversationAttachment(
  ownerId: string,
  collectionId: string,
  attachmentId: string
): Promise<(ConversationAttachmentData & { entryId: string }) | null> {
  const row = await prisma.conversationAttachment.findFirst({
    where: { id: attachmentId, collectionId, collection: { ownerId } },
    select: { ...ATTACHMENT_SELECT, entryId: true },
  });
  return row ? { ...toAttachmentData(row), entryId: row.entryId } : null;
}
