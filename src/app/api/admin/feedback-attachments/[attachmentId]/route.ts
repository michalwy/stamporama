import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin-access";
import { streamAttachment } from "@/lib/attachment-route";
import { getFeedbackAttachmentForServing } from "@/lib/feedback";

// **A feedback report's picture** (#2727), for the admin panel's report view: `?variant=thumb` its
// thumbnail, without it the file as it came, inline under its own name. **An administrator's
// session only** — a report belongs to no collection, so no Assistant token reaches it here; the
// admin MCP tools hand an agent the picture itself (`get_feedback_attachment`). For anyone else the
// picture does not exist.

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { attachmentId } = await params;
  return streamAttachment(request, await getFeedbackAttachmentForServing(session.user.id, attachmentId));
}
