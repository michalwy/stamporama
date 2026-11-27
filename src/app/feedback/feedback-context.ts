"use client";

import { FEEDBACK_ERRORS_MAX } from "@/lib/feedback-rules";

// What rides along with a report (#2720): gathered in the browser at the moment of sending, so the
// person reporting does not have to describe their own machine.

/** The page's last few script errors. Kept from the moment this module loads — which is when a
 *  screen carrying the entry point is first drawn — so an error that happened before the dialog was
 *  opened is still there to send. */
const recentErrors: string[] = [];

function remember(line: string) {
  recentErrors.push(line);
  if (recentErrors.length > FEEDBACK_ERRORS_MAX) recentErrors.shift();
}

const globalForFeedback = globalThis as unknown as { stamporamaFeedbackListening?: boolean };

if (typeof window !== "undefined" && !globalForFeedback.stamporamaFeedbackListening) {
  globalForFeedback.stamporamaFeedbackListening = true;
  window.addEventListener("error", (event) => {
    remember(event.message || "Script error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    remember(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

export interface FeedbackContext {
  route: string;
  userAgent: string;
  viewport: string;
  language: string;
  timeZone: string;
  theme: string;
  recentErrors: string[];
}

export function collectFeedbackContext(): FeedbackContext {
  return {
    // The server replaces a share link's token before anything is stored (`redactRoute`).
    route: window.location.pathname + window.location.search,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    recentErrors: [...recentErrors],
  };
}
