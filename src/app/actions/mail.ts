"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { markFailedMailSeen, sendTestMail } from "@/lib/mail/messages";

// Settings → Email (#1372). The provider itself is chosen at deployment, so nothing here writes
// configuration: the tab sends a test message and reads what did not arrive.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** Send the test message now and report the provider's answer — delivered, or its own error. */
export async function sendTestMailAction(
  collectionId: string
): Promise<{ status: "success"; to: string } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const result = await sendTestMail(session.user.id, collectionId);
    return result.status === "sent" ? { status: "success", to: result.to } : result;
  } catch {
    return { status: "error", message: "The test message could not be sent. Please try again." };
  }
}

/** Opening the tab reads the notification about mail that was not delivered. */
export async function markFailedMailSeenAction(
  collectionId: string
): Promise<{ status: "success" } | { status: "error" }> {
  const session = await getSession();
  try {
    await markFailedMailSeen(session.user.id, collectionId);
    return { status: "success" };
  } catch {
    return { status: "error" };
  }
}
