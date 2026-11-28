// Pictures sent with a feedback report (#2727) — what may be attached, read the same way by the
// dialog (before it sends) and by `POST /api/feedback` (which decides). Pure: no Prisma, no I/O, so
// `pnpm test:unit` holds it and the dialog imports it.
//
// **The owner's limits (2026-11-28): images only — PNG, JPEG, WebP — at most five per report, each at
// most 10 MB**, for a signed-in collector and for an anonymous visitor of a shared page alike. What a
// file is comes from its bytes (`sniffAttachment`, the conversation log's reader), never from its
// name or declared type; a PDF, which that reader also knows, is refused here.

import { sniffAttachment } from "./conversation-attachment-rules";

export const FEEDBACK_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type FeedbackAttachmentType = (typeof FEEDBACK_ATTACHMENT_TYPES)[number];

/** The file picker's `accept`; the server reads the bytes again. */
export const FEEDBACK_ATTACHMENT_ACCEPT = FEEDBACK_ATTACHMENT_TYPES.join(",");

/** How many pictures one report carries. */
export const MAX_FEEDBACK_ATTACHMENTS = 5;

/** How large one picture may be: 10 MB. */
export const MAX_FEEDBACK_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * The most a whole request may carry: every picture at its limit plus room for the report's own
 * fields and the multipart framing. A body declared larger is refused before it is read.
 */
export const MAX_FEEDBACK_REQUEST_BYTES = MAX_FEEDBACK_ATTACHMENTS * MAX_FEEDBACK_ATTACHMENT_BYTES + 1024 * 1024;

export function isFeedbackAttachmentType(value: string): value is FeedbackAttachmentType {
  return (FEEDBACK_ATTACHMENT_TYPES as readonly string[]).includes(value);
}

/** What a picture is, from its first bytes, or null for anything a report does not keep. */
export function sniffFeedbackAttachment(bytes: Uint8Array): FeedbackAttachmentType | null {
  const type = sniffAttachment(bytes);
  return type && isFeedbackAttachmentType(type) ? type : null;
}

/** Why a set of files cannot go with a report, before any byte is read. */
export type FeedbackFilesProblem = "too_many" | "too_large" | "empty";

/**
 * Check what the browser chose by count and size — the cheap half, which the dialog runs as files
 * are added and the route runs again. What the bytes are is the server's half.
 */
export function checkFeedbackFiles(
  files: readonly { readonly size: number }[]
): { ok: true } | { ok: false; problem: FeedbackFilesProblem; index: number } {
  if (files.length > MAX_FEEDBACK_ATTACHMENTS) return { ok: false, problem: "too_many", index: MAX_FEEDBACK_ATTACHMENTS };
  for (const [index, file] of files.entries()) {
    if (file.size === 0) return { ok: false, problem: "empty", index };
    if (file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) return { ok: false, problem: "too_large", index };
  }
  return { ok: true };
}

/**
 * Whether the dialog lets a file through by its declared type — a hint only; the bytes decide on the
 * server. A file with no declared type (a name without an extension) is let through for them to.
 */
export function looksLikeFeedbackPicture(type: string): boolean {
  return type === "" || isFeedbackAttachmentType(type.toLowerCase());
}

/** The sentences the route refuses with, in English like every other refusal it gives. */
export const FEEDBACK_FILES_MESSAGES: Record<FeedbackFilesProblem | "type", string> = {
  too_many: `Attach at most ${MAX_FEEDBACK_ATTACHMENTS} pictures to one report.`,
  too_large: "A picture may be at most 10 MB.",
  empty: "One of the files is empty.",
  type: "Only pictures can be attached: PNG, JPEG or WebP.",
};
