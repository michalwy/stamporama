// Attachments on conversation log entries (#2150, ADR-0073 §7) — what a file may be, read the same
// way by the card's upload route and the agent API. Pure: no Prisma, no I/O.
//
// **What a file is comes from its bytes, never from its name or a declared type.** A payment
// confirmation saved as `potwierdzenie` with no extension is still a PDF, and a file called `.pdf`
// that is not one is refused rather than stored and found wanting when it is opened.

/** The kinds of file an entry keeps: a picture, or a PDF document. */
export type ConversationAttachmentKind = "image" | "pdf";

export const CONVERSATION_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ConversationAttachmentType = (typeof CONVERSATION_ATTACHMENT_TYPES)[number];

/** The file picker's `accept`; the server reads the bytes again. */
export const CONVERSATION_ATTACHMENT_ACCEPT = CONVERSATION_ATTACHMENT_TYPES.join(",");

/** How many files one entry keeps. An entry is one moment of a conversation, and a handful of
 *  screenshots and scans is what one carries; the bound keeps a mistaken loop from filling a card. */
export const MAX_ATTACHMENTS_PER_ENTRY = 20;

/** The longest file name kept; a longer one is shortened, keeping its extension. */
export const MAX_ATTACHMENT_NAME_LENGTH = 200;

const EXTENSION: Record<ConversationAttachmentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function attachmentExtension(type: ConversationAttachmentType): string {
  return EXTENSION[type];
}

export function attachmentKind(type: string): ConversationAttachmentKind {
  return type === "application/pdf" ? "pdf" : "image";
}

/** What a file is, read from its first bytes, or null for anything an entry does not keep. */
export function sniffAttachment(bytes: Uint8Array): ConversationAttachmentType | null {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (bytes.length >= 5 && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (bytes.length >= 3 && starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    starts(0x52, 0x49, 0x46, 0x46) && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

/** The sentence refusing a file that is none of the kinds kept. */
export const UNSUPPORTED_ATTACHMENT_MESSAGE =
  "An attachment must be a picture (JPEG, PNG or WebP) or a PDF; this file is neither.";

/**
 * A file name fit to keep and to hand back in a download: the last path segment, no control
 * characters, no quotes, bounded — and an extension matching what the bytes are when the name has
 * none of its own. An empty name becomes `attachment.<ext>`.
 */
export function cleanAttachmentName(name: string, type: ConversationAttachmentType): string {
  const extension = EXTENSION[type];
  const segment = name.split(/[\\/]/).pop() ?? "";
  let cleaned = segment.replace(/[\u0000-\u001f\u007f"]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.replace(/[. ]/g, "") === "") cleaned = "attachment";
  if (!/\.[A-Za-z0-9]{1,5}$/.test(cleaned)) cleaned = `${cleaned}.${extension}`;
  if (cleaned.length > MAX_ATTACHMENT_NAME_LENGTH) {
    const dot = cleaned.lastIndexOf(".");
    const tail = cleaned.slice(dot);
    cleaned = `${cleaned.slice(0, MAX_ATTACHMENT_NAME_LENGTH - tail.length)}${tail}`;
  }
  return cleaned;
}

/** A size as the card and a refusal say it. */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The sentence refusing a file past the upload limit. */
export function attachmentTooLargeMessage(name: string, bytes: number, limit: number): string {
  return `"${name}" is ${formatAttachmentSize(bytes)}; an attachment is at most ${formatAttachmentSize(limit)}.`;
}

/** The sentence refusing files past what one entry keeps. */
export function tooManyAttachmentsMessage(held: number, adding: number): string {
  return `The entry holds ${held} ${held === 1 ? "file" : "files"} and ${adding} more would pass the ${MAX_ATTACHMENTS_PER_ENTRY} an entry keeps. Remove some first, or attach them to another entry.`;
}
