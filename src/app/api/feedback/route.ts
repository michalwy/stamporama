import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { FeedbackAttachmentError, createFeedbackReport } from "@/lib/feedback";
import {
  FEEDBACK_FILES_MESSAGES,
  MAX_FEEDBACK_REQUEST_BYTES,
  checkFeedbackFiles,
} from "@/lib/feedback-attachment-rules";
import { fireFeedbackNotification } from "@/lib/feedback-notify";
import {
  ANONYMOUS_PER_ADDRESS,
  ANONYMOUS_TOTAL,
  ANONYMOUS_WINDOW_MS,
  parseFeedbackSubmission,
} from "@/lib/feedback-rules";
import { clientAddress, rateLimit } from "@/lib/rate-limit";

// `POST /api/feedback` (#2720) — where "Report a problem" sends, from inside the app and from the
// pages shared with customers.
//
// **It takes a request with no session, on purpose**: a customer looking at a shared page has no
// account. What an anonymous request may do is add one row of bounded text, and how often is
// bounded twice — per address and for all anonymous senders together — so the worst a script can
// do is fill a window's allowance. A signed-in collector is limited by their account being theirs.
//
// A report from a shared page is only *counted* as one when the address it names is a shared page;
// an anonymous request naming any other page is refused, since nothing else is reachable signed out.
//
// **Pictures ride along as multipart** (#2727): the report as JSON in the `report` field, and up to
// five images in `file`, 10 MB each — from a visitor as from a collector (the owner, 2026-11-28). A
// report without pictures may still be sent as plain JSON. The proxy does not run on this path
// (`src/proxy.ts`), because Next buffers a body for the proxy only up to 10 MB and cuts the rest.

/** A signed-in collector's own bound: generous for a person, a wall for a loop. */
const SIGNED_IN_LIMIT = 30;

function refuse(status: number, message: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ ok: false, message }, { status, headers });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_FEEDBACK_REQUEST_BYTES) return refuse(413, FEEDBACK_FILES_MESSAGES.too_large);

  let body: unknown;
  let files: File[] = [];
  const multipart = (request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
  try {
    if (multipart) {
      const form = await request.formData();
      const report = form.get("report");
      body = typeof report === "string" ? JSON.parse(report) : null;
      files = form.getAll("file").filter((value): value is File => value instanceof File);
    } else {
      body = await request.json();
    }
  } catch {
    return refuse(400, "Send the report as JSON, or as a form with the report in `report`.");
  }
  const parsed = parseFeedbackSubmission(body);
  if (!parsed.ok) return refuse(400, parsed.message);
  const counted = checkFeedbackFiles(files);
  if (!counted.ok) {
    return refuse(counted.problem === "too_large" ? 413 : 400, FEEDBACK_FILES_MESSAGES[counted.problem]);
  }

  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user.id ?? null;

  if (!userId && !parsed.submission.sharedPage) {
    return refuse(401, "Sign in to send a report from here.");
  }

  const address = clientAddress(request.headers);
  const limited = userId
    ? rateLimit(`feedback:user:${userId}`, SIGNED_IN_LIMIT, ANONYMOUS_WINDOW_MS)
    : rateLimit(`feedback:address:${address}`, ANONYMOUS_PER_ADDRESS, ANONYMOUS_WINDOW_MS);
  const flooded = !userId && limited.ok && !rateLimit("feedback:anonymous", ANONYMOUS_TOTAL, ANONYMOUS_WINDOW_MS).ok;
  if (!limited.ok || flooded) {
    return refuse(429, "Too many reports. Try again later.", {
      "Retry-After": String(limited.retryAfter || 60),
    });
  }

  // The hidden field a person never sees was filled in: answer as if it had worked, store nothing.
  if (parsed.honeypot) return NextResponse.json({ ok: true });

  try {
    const inputs = await Promise.all(
      files.map(async (file) => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }))
    );
    await createFeedbackReport({ userId }, parsed.submission, inputs);
  } catch (error) {
    if (error instanceof FeedbackAttachmentError) return refuse(422, error.message);
    console.error("[feedback] could not store a report", error);
    return refuse(500, "The report could not be stored. Try again in a moment.");
  }
  // Tell the coordinator there is something to triage (#2721). Not awaited and unable to throw:
  // the report is stored, and that is what this request answers for.
  fireFeedbackNotification();
  return NextResponse.json({ ok: true });
}
