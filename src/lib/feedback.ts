import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "./db";
import { AdminError, assertAdmin } from "./admin-access";
import { getActiveStorage, getStorage } from "./storage";
import { attachmentExtension } from "./conversation-attachment-rules";
import {
  ConversationAttachmentError,
  prepareConversationAttachment,
  type ConversationAttachmentInput,
} from "./conversation-attachments";
import {
  FEEDBACK_FILES_MESSAGES,
  checkFeedbackFiles,
  sniffFeedbackAttachment,
} from "./feedback-attachment-rules";
import {
  FEEDBACK_NOTE_MAX,
  isFeedbackStatus,
  parseIssueUrl,
  type FeedbackSource,
  type FeedbackStatus,
  type FeedbackSubmission,
} from "./feedback-rules";
import { getAppVersion } from "./version";

// In-app feedback, stored and read (#2720). Sending is open to a signed-in collector and to an
// anonymous visitor of a shared page; **reading and updating are an administrator's**, checked here
// whichever surface asks — the admin panel's actions or the admin MCP tools.

export interface FeedbackSender {
  /** The signed-in account, or null for an anonymous visitor. */
  userId: string | null;
}

/**
 * Store one report. The collection is resolved from the slug **for the sender's own account** — a
 * slug is unique per owner, and a report must not be attachable to somebody else's collection by
 * typing its name. What the browser said about the page is kept as it arrived, already trimmed and
 * redacted by `parseFeedbackSubmission`; the app's version is the server's own.
 */
export async function createFeedbackReport(
  sender: FeedbackSender,
  submission: FeedbackSubmission,
  files: readonly ConversationAttachmentInput[] = []
): Promise<{ id: string }> {
  const prepared = await prepareFeedbackFiles(files);
  const collection =
    sender.userId && submission.collectionSlug
      ? await prisma.collection.findUnique({
          where: { ownerId_slug: { ownerId: sender.userId, slug: submission.collectionSlug } },
          select: { id: true },
        })
      : null;
  const source: FeedbackSource = submission.sharedPage ? "shared" : "app";

  // Written before the rows, as a sale's files are, so a row never names a file that is not there;
  // a failure removes what was written.
  const storage = getActiveStorage();
  const written: string[] = [];
  const attachments: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    storageBackend: string;
    storageKey: string;
    thumbKey: string | null;
    widthPx: number | null;
    heightPx: number | null;
  }[] = [];
  try {
    for (const file of prepared) {
      const prefix = `feedback/${randomUUID()}`;
      const storageKey = `${prefix}/original.${attachmentExtension(file.contentType)}`;
      await storage.put(storageKey, file.bytes, file.contentType, "delivery");
      written.push(storageKey);
      let thumbKey: string | null = null;
      if (file.thumb) {
        thumbKey = `${prefix}/thumb.webp`;
        await storage.put(thumbKey, file.thumb, "image/webp", "delivery");
        written.push(thumbKey);
      }
      attachments.push({
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
    return await storeReport(sender, submission, source, collection?.id ?? null, attachments);
  } catch (err) {
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    throw err;
  }
}

/** Thrown for a picture the sender has to change something about; the message says what. */
export class FeedbackAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackAttachmentError";
  }
}

/**
 * Check every picture before anything is written: the count and sizes (the owner's limits), what
 * the bytes are — a picture, never a PDF — and that each can be read, making its thumbnail.
 */
async function prepareFeedbackFiles(files: readonly ConversationAttachmentInput[]) {
  const counted = checkFeedbackFiles(files.map((file) => ({ size: file.bytes.length })));
  if (!counted.ok) throw new FeedbackAttachmentError(FEEDBACK_FILES_MESSAGES[counted.problem]);
  const prepared = [];
  for (const file of files) {
    if (!sniffFeedbackAttachment(file.bytes)) throw new FeedbackAttachmentError(FEEDBACK_FILES_MESSAGES.type);
    try {
      prepared.push(await prepareConversationAttachment(file));
    } catch (err) {
      if (err instanceof ConversationAttachmentError) throw new FeedbackAttachmentError(err.message);
      throw err;
    }
  }
  return prepared;
}

async function storeReport(
  sender: FeedbackSender,
  submission: FeedbackSubmission,
  source: FeedbackSource,
  collectionId: string | null,
  attachments: Prisma.FeedbackAttachmentCreateWithoutReportInput[]
): Promise<{ id: string }> {
  return prisma.feedbackReport.create({
    data: {
      source,
      kind: submission.kind,
      message: submission.message,
      // A signed-in collector is reachable through their account; the field is the visitor's.
      contact: sender.userId ? null : submission.contact,
      userId: sender.userId,
      collectionId,
      route: submission.route,
      sharedPage: submission.sharedPage,
      appVersion: getAppVersion(),
      userAgent: submission.userAgent,
      viewport: submission.viewport,
      language: submission.language,
      timeZone: submission.timeZone,
      theme: submission.theme,
      recentErrors: submission.recentErrors,
      ...(attachments.length > 0 ? { attachments: { create: attachments } } : {}),
    },
    select: { id: true },
  });
}

/** A report's pictures in the order they were sent. */
const ATTACHMENT_ORDER: Prisma.FeedbackAttachmentOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];

const REPORT_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  source: true,
  kind: true,
  message: true,
  status: true,
  issueUrl: true,
  adminNote: true,
  contact: true,
  userId: true,
  collectionId: true,
  route: true,
  sharedPage: true,
  appVersion: true,
  userAgent: true,
  viewport: true,
  language: true,
  timeZone: true,
  theme: true,
  recentErrors: true,
  user: { select: { name: true, email: true } },
  collection: { select: { name: true, slug: true } },
  attachments: {
    select: { id: true, fileName: true, contentType: true, sizeBytes: true, widthPx: true, heightPx: true },
    orderBy: ATTACHMENT_ORDER,
  },
} as const;

export interface FeedbackReportView {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  source: string;
  kind: string;
  message: string;
  status: string;
  issueUrl: string | null;
  adminNote: string | null;
  contact: string | null;
  userId: string | null;
  collectionId: string | null;
  route: string;
  sharedPage: string | null;
  appVersion: string;
  userAgent: string | null;
  viewport: string | null;
  language: string | null;
  timeZone: string | null;
  theme: string | null;
  recentErrors: string | null;
  user: { name: string; email: string } | null;
  collection: { name: string; slug: string } | null;
  attachments: FeedbackAttachmentView[];
}

/** A picture sent with a report, as the panel and the admin tools list it — never its bytes. */
export interface FeedbackAttachmentView {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
}

export interface FeedbackListOptions {
  status?: FeedbackStatus;
  limit: number;
  offset: number;
}

/** Reports newest first, with the count of everything that matches. Administrators only. */
export async function listFeedbackReports(
  adminId: string,
  options: FeedbackListOptions
): Promise<{ reports: FeedbackReportView[]; total: number }> {
  await assertAdmin(adminId);
  const where = options.status ? { status: options.status } : {};
  const [reports, total] = await Promise.all([
    prisma.feedbackReport.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: options.offset,
      take: options.limit,
      select: REPORT_SELECT,
    }),
    prisma.feedbackReport.count({ where }),
  ]);
  return { reports, total };
}

/** How many reports nobody has read yet. Administrators only. */
export async function countNewFeedbackReports(adminId: string): Promise<number> {
  await assertAdmin(adminId);
  return prisma.feedbackReport.count({ where: { status: "new" } });
}

/** One report with everything sent with it. Administrators only. */
export async function getFeedbackReport(adminId: string, id: string): Promise<FeedbackReportView> {
  await assertAdmin(adminId);
  const report = await prisma.feedbackReport.findUnique({ where: { id }, select: REPORT_SELECT });
  if (!report) throw new AdminError("not_found", "That report no longer exists.");
  return report;
}

export interface FeedbackUpdate {
  status?: string;
  /** An empty string clears it. */
  issueUrl?: string;
  /** An empty string clears it. */
  adminNote?: string;
}

/**
 * Change a report's status, the issue it became, and the administrator's note. A field left out
 * keeps its value; an empty string clears the URL or the note. Administrators only.
 */
export async function updateFeedbackReport(
  adminId: string,
  id: string,
  update: FeedbackUpdate
): Promise<FeedbackReportView> {
  await assertAdmin(adminId);
  const data: { status?: string; issueUrl?: string | null; adminNote?: string | null } = {};
  if (update.status !== undefined) {
    if (!isFeedbackStatus(update.status)) throw new AdminError("refused", "That is not a status a report can have.");
    data.status = update.status;
  }
  if (update.issueUrl !== undefined) {
    const parsed = parseIssueUrl(update.issueUrl);
    if (!parsed.ok) {
      throw new AdminError("refused", "The issue URL must look like https://github.com/<owner>/<repo>/issues/<number>.");
    }
    data.issueUrl = parsed.url;
  }
  if (update.adminNote !== undefined) {
    const note = update.adminNote.trim();
    if (note.length > FEEDBACK_NOTE_MAX) {
      throw new AdminError("refused", `Keep the note under ${FEEDBACK_NOTE_MAX} characters.`);
    }
    data.adminNote = note.length > 0 ? note : null;
  }
  const existing = await prisma.feedbackReport.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AdminError("not_found", "That report no longer exists.");
  return prisma.feedbackReport.update({ where: { id }, data, select: REPORT_SELECT });
}

/** Where a report's picture is, for the panel's serving route. Administrators only. */
export async function getFeedbackAttachmentForServing(
  adminId: string,
  attachmentId: string
): Promise<{ fileName: string; contentType: string; storageBackend: string; storageKey: string; thumbKey: string | null } | null> {
  await assertAdmin(adminId);
  return prisma.feedbackAttachment.findUnique({
    where: { id: attachmentId },
    select: { fileName: true, contentType: true, storageBackend: true, storageKey: true, thumbKey: true },
  });
}

/**
 * The longest edge, in pixels, of the rendition an agent is handed, and the most bytes it is handed
 * as they came. A model reads a picture at about this size anyway, and a 10 MB screenshot as base64
 * is past what an MCP client takes in one answer.
 */
export const AGENT_IMAGE_MAX_EDGE = 1568;
export const AGENT_IMAGE_MAX_BYTES = 3_500_000;

/**
 * One of a report's pictures for the admin MCP tools: the file as it came when it is small enough,
 * otherwise a WebP rendition fitted inside {@link AGENT_IMAGE_MAX_EDGE}. Administrators only.
 */
export async function readFeedbackAttachmentForAgent(
  adminId: string,
  attachmentId: string
): Promise<{ attachment: FeedbackAttachmentView & { feedbackReportId: string }; mimeType: string; bytes: Buffer; reduced: boolean }> {
  await assertAdmin(adminId);
  const row = await prisma.feedbackAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      feedbackReportId: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      widthPx: true,
      heightPx: true,
      storageBackend: true,
      storageKey: true,
    },
  });
  if (!row) throw new AdminError("not_found", "That picture no longer exists.");
  const object = await getStorage(row.storageBackend).get(row.storageKey, row.contentType, "delivery");
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  const original = Buffer.concat(chunks);
  const attachment = {
    id: row.id,
    feedbackReportId: row.feedbackReportId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
  };
  const longest = Math.max(row.widthPx ?? 0, row.heightPx ?? 0);
  if (original.length <= AGENT_IMAGE_MAX_BYTES && longest > 0 && longest <= AGENT_IMAGE_MAX_EDGE) {
    return { attachment, mimeType: row.contentType, bytes: original, reduced: false };
  }
  const bytes = await sharp(original)
    .rotate()
    .resize(AGENT_IMAGE_MAX_EDGE, AGENT_IMAGE_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();
  return { attachment, mimeType: "image/webp", bytes, reduced: true };
}
