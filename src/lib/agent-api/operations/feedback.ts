import "server-only";
import { AdminError } from "../../admin-access";
import {
  getFeedbackReport,
  listFeedbackReports,
  readFeedbackAttachmentForAgent,
  updateFeedbackReport,
  type FeedbackReportView,
} from "../../feedback";
import { FEEDBACK_STATUSES, feedbackExcerpt, isFeedbackStatus } from "../../feedback-rules";
import { forbidden, invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import { optionalString, requiredString } from "../params";
import { ImageAnswer, type Operation, type OperationContext } from "../types";

// The administrator's feedback tools (#2720): the reports sent with "Report a problem", read and
// triaged by an agent. They are **not** in `OPERATIONS` — they are about the instance, not about the
// token's collection — and reach only a credential whose account is an administrator
// (`admin-registry.ts`). The functions they call check that again themselves.

/** An `AdminError` as this surface speaks: a stable code and a sentence saying what to do next. */
async function asAdmin<T>(work: () => Promise<T>, notFoundHint = "Call list_feedback for the reports that exist."): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof AdminError)) throw error;
    if (error.code === "forbidden") throw forbidden(error.message);
    if (error.code === "not_found") {
      throw notFound(`${error.message} ${notFoundHint}`);
    }
    throw invalidRequest(error.message);
  }
}

interface AgentFeedbackRow {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: string;
  readonly status: string;
  /** `app` — a signed-in collector; `shared` — a visitor of a page shared with a customer. */
  readonly source: string;
  readonly excerpt: string;
  readonly issueUrl?: string;
  /** How many pictures were sent with it, when any were. */
  readonly attachments?: number;
}

function toRow(report: FeedbackReportView): AgentFeedbackRow {
  return {
    id: report.id,
    createdAt: report.createdAt.toISOString(),
    kind: report.kind,
    status: report.status,
    source: report.source,
    excerpt: feedbackExcerpt(report.message, 200),
    ...(report.issueUrl ? { issueUrl: report.issueUrl } : {}),
    ...(report.attachments.length > 0 ? { attachments: report.attachments.length } : {}),
  };
}

/** One report in full. Absent fields were not sent; the account is an id, never a name or address. */
function toDetail(report: FeedbackReportView) {
  const optional = {
    issueUrl: report.issueUrl,
    adminNote: report.adminNote,
    accountId: report.userId,
    collectionId: report.collectionId,
    contactGiven: report.contact ? true : null,
    sharedPage: report.sharedPage,
    userAgent: report.userAgent,
    viewport: report.viewport,
    language: report.language,
    timeZone: report.timeZone,
    theme: report.theme,
    recentErrors: report.recentErrors,
  };
  return {
    id: report.id,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    kind: report.kind,
    status: report.status,
    source: report.source,
    message: report.message,
    route: report.route,
    appVersion: report.appVersion,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null)),
    // The pictures sent with it (#2727), described — get_feedback_attachment hands over each one.
    attachments: report.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.fileName,
      type: attachment.contentType,
      bytes: attachment.sizeBytes,
      ...(attachment.widthPx !== null && attachment.heightPx !== null
        ? { widthPx: attachment.widthPx, heightPx: attachment.heightPx }
        : {}),
    })),
  };
}

export const listFeedbackOperation: Operation = {
  name: "list_feedback",
  method: "GET",
  path: "/admin/feedback",
  description:
    "Instance administrators only. List the reports people sent with “Report a problem” — from inside the app and from pages shared with customers — newest first. Pass `status` to narrow them; triage starts with `status=new`.",
  writes: false,
  instance: true,
  parameters: [
    {
      name: "status",
      in: "query",
      type: "string",
      required: false,
      description: "Only reports in this status. Omit it for every status.",
      values: FEEDBACK_STATUSES,
    },
  ],
  result: {
    kind: "list",
    description:
      "One row per report: its id, when it was sent, its kind (problem, idea, question), status, source, the start of the message, and the issue URL once it has one. Read a report in full with get_feedback.",
  },
  handler: async (context: OperationContext, params) => {
    const status = optionalString(params, "status");
    if (status !== null && !isFeedbackStatus(status)) {
      throw invalidRequest(`"${status}" is not a report status.`, FEEDBACK_STATUSES);
    }
    const window = parseListWindow(params);
    const { reports, total } = await asAdmin(() =>
      listFeedbackReports(context.ownerId, { status: status ?? undefined, ...window })
    );
    return listResponse(reports.map(toRow), total, window);
  },
};

export const getFeedbackOperation: Operation = {
  name: "get_feedback",
  method: "GET",
  path: "/admin/feedback/{feedback_id}",
  description:
    "Instance administrators only. Read one feedback report with everything sent with it: the whole message, the screen's address (a share link's token is already replaced by `[token]`), the app version, browser, window size, language, time zone, theme, the page's recent script errors, the ids of the account and collection it came from, and the pictures sent with it (`attachments`; look at one with get_feedback_attachment).",
  writes: false,
  instance: true,
  parameters: [
    {
      name: "feedback_id",
      in: "path",
      type: "string",
      required: true,
      description: "The report's id, from list_feedback.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The report. `accountId` and `collectionId` are internal ids — never copy them, or anything else that identifies a person, into a public issue. `contactGiven` says only that an anonymous visitor left a way to reach them; the administrator reads it in the admin panel.",
  },
  handler: async (context: OperationContext, params) =>
    toDetail(await asAdmin(() => getFeedbackReport(context.ownerId, requiredString(params, "feedback_id")))),
};

export const getFeedbackAttachmentOperation: Operation = {
  name: "get_feedback_attachment",
  method: "GET",
  path: "/admin/feedback-attachments/{attachment_id}",
  description:
    "Instance administrators only. Look at one picture sent with a feedback report — most often a screenshot of the screen the report is about. Answers the picture itself, after a line describing it; a large one is handed over reduced to fit 1568 pixels on its longest edge.",
  writes: false,
  instance: true,
  parameters: [
    {
      name: "attachment_id",
      in: "path",
      type: "string",
      required: true,
      description: "The picture's id, from the `attachments` of get_feedback.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The picture, and beside it its report's id, its name, type and size as sent, and whether what is shown was reduced. A screenshot may show personal data: describe what it shows, never copy names, addresses or other personal details from it into a public issue.",
  },
  handler: async (context: OperationContext, params) => {
    const id = requiredString(params, "attachment_id");
    const read = await asAdmin(
      () => readFeedbackAttachmentForAgent(context.ownerId, id),
      "Call get_feedback for the pictures a report has."
    );
    return new ImageAnswer(
      {
        id: read.attachment.id,
        feedbackId: read.attachment.feedbackReportId,
        name: read.attachment.fileName,
        type: read.attachment.contentType,
        bytes: read.attachment.sizeBytes,
        ...(read.attachment.widthPx !== null && read.attachment.heightPx !== null
          ? { widthPx: read.attachment.widthPx, heightPx: read.attachment.heightPx }
          : {}),
        reduced: read.reduced,
      },
      read.mimeType,
      read.bytes.toString("base64")
    );
  },
};

export const updateFeedbackOperation: Operation = {
  name: "update_feedback",
  method: "PATCH",
  path: "/admin/feedback/{feedback_id}",
  description:
    "Instance administrators only. Set a feedback report's status, the GitHub issue it became, and an internal note. An omitted field keeps its value; an empty string clears the issue URL or the note. After filing or finding the issue for a report, set `status` to `triaged` and `issue_url` to the issue.",
  writes: true,
  instance: true,
  parameters: [
    {
      name: "feedback_id",
      in: "path",
      type: "string",
      required: true,
      description: "The report's id, from list_feedback.",
    },
    {
      name: "status",
      in: "body",
      type: "string",
      required: false,
      description:
        "`new` — nobody has read it; `triaged` — it has an issue or an answer; `resolved` — what it asked for is done; `dismissed` — nothing will be done.",
      values: FEEDBACK_STATUSES,
    },
    {
      name: "issue_url",
      in: "body",
      type: "string",
      required: false,
      description: "The issue the report became: https://github.com/<owner>/<repo>/issues/<number>. An empty string clears it.",
    },
    {
      name: "admin_note",
      in: "body",
      type: "string",
      required: false,
      description: "An internal note for the administrator, never shown to the sender. An empty string clears it.",
    },
  ],
  result: { kind: "object", description: "The report as it now stands." },
  handler: async (context: OperationContext, params) => {
    const status = optionalString(params, "status");
    if (status !== null && !isFeedbackStatus(status)) {
      throw invalidRequest(`"${status}" is not a report status.`, FEEDBACK_STATUSES);
    }
    const issueUrl = optionalString(params, "issue_url");
    const adminNote = optionalString(params, "admin_note");
    if (status === null && issueUrl === null && adminNote === null) {
      throw invalidRequest("Send at least one of `status`, `issue_url` and `admin_note`.");
    }
    return toDetail(
      await asAdmin(() =>
        updateFeedbackReport(context.ownerId, requiredString(params, "feedback_id"), {
          status: status ?? undefined,
          issueUrl: issueUrl ?? undefined,
          adminNote: adminNote ?? undefined,
        })
      )
    );
  },
};
