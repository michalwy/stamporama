"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { signInPath } from "@/lib/sign-in-redirect";
import {
  AdminError,
  deleteAccountAsAdmin,
  deleteCollectionAsAdmin,
  setRegistrationOpen,
} from "@/lib/admin";
import { updateFeedbackReport, type FeedbackUpdate } from "@/lib/feedback";

// The administrator's panel's three actions (#2719). Each resolves the session itself and hands the
// account's id to `src/lib/admin.ts`, which is where "is this an administrator" is decided — a
// server action is a public endpoint, whatever screen happens to call it.

export type AdminActionResult =
  | { status: "ok"; bytesDeleted?: boolean }
  | { status: "error"; message: string };

async function adminId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session.user.id;
}

async function run(work: (id: string) => Promise<{ bytesDeleted?: boolean } | void>): Promise<AdminActionResult> {
  const id = await adminId();
  try {
    const outcome = await work(id);
    // The panel is drawn from the server component's read, and an action refreshes nothing by
    // itself (#2426).
    revalidatePath("/admin");
    return { status: "ok", bytesDeleted: outcome?.bytesDeleted };
  } catch (error) {
    if (error instanceof AdminError) return { status: "error", message: error.message };
    console.error("[admin] action failed", error);
    return { status: "error", message: "That did not work. Nothing was changed — try again." };
  }
}

export async function setRegistrationOpenAction(open: boolean): Promise<AdminActionResult> {
  return run(async (id) => {
    await setRegistrationOpen(id, open === true);
  });
}

export async function deleteCollectionAsAdminAction(collectionId: string): Promise<AdminActionResult> {
  return run((id) => deleteCollectionAsAdmin(id, String(collectionId)));
}

export async function deleteAccountAsAdminAction(userId: string): Promise<AdminActionResult> {
  return run((id) => deleteAccountAsAdmin(id, String(userId)));
}

/** Change a feedback report's status, issue URL and note from the panel (#2720). */
export async function updateFeedbackReportAction(
  reportId: string,
  update: FeedbackUpdate
): Promise<AdminActionResult> {
  return run(async (id) => {
    await updateFeedbackReport(id, String(reportId), {
      status: typeof update.status === "string" ? update.status : undefined,
      issueUrl: typeof update.issueUrl === "string" ? update.issueUrl : undefined,
      adminNote: typeof update.adminNote === "string" ? update.adminNote : undefined,
    });
  });
}
