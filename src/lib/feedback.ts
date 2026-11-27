import "server-only";
import { prisma } from "./db";
import { AdminError, assertAdmin } from "./admin-access";
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
  submission: FeedbackSubmission
): Promise<{ id: string }> {
  const collection =
    sender.userId && submission.collectionSlug
      ? await prisma.collection.findUnique({
          where: { ownerId_slug: { ownerId: sender.userId, slug: submission.collectionSlug } },
          select: { id: true },
        })
      : null;
  const source: FeedbackSource = submission.sharedPage ? "shared" : "app";
  return prisma.feedbackReport.create({
    data: {
      source,
      kind: submission.kind,
      message: submission.message,
      // A signed-in collector is reachable through their account; the field is the visitor's.
      contact: sender.userId ? null : submission.contact,
      userId: sender.userId,
      collectionId: collection?.id ?? null,
      route: submission.route,
      sharedPage: submission.sharedPage,
      appVersion: getAppVersion(),
      userAgent: submission.userAgent,
      viewport: submission.viewport,
      language: submission.language,
      timeZone: submission.timeZone,
      theme: submission.theme,
      recentErrors: submission.recentErrors,
    },
    select: { id: true },
  });
}

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
