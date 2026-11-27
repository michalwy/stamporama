import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createFeedbackReport } from "@/lib/feedback";
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

/** A signed-in collector's own bound: generous for a person, a wall for a loop. */
const SIGNED_IN_LIMIT = 30;

function refuse(status: number, message: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ ok: false, message }, { status, headers });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Send the report as JSON.");
  }
  const parsed = parseFeedbackSubmission(body);
  if (!parsed.ok) return refuse(400, parsed.message);

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
    await createFeedbackReport({ userId }, parsed.submission);
  } catch (error) {
    console.error("[feedback] could not store a report", error);
    return refuse(500, "The report could not be stored. Try again in a moment.");
  }
  // Tell the coordinator there is something to triage (#2721). Not awaited and unable to throw:
  // the report is stored, and that is what this request answers for.
  fireFeedbackNotification();
  return NextResponse.json({ ok: true });
}
