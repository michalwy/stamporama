import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readConversationLog } from "@/lib/conversation-log";

/** A contact's conversation log (#2149) for the *Conversation* card: every entry with `contactId`,
 * or with `saleId` only those about that sale, and the contact's sales an entry may name. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const contactId = request.nextUrl.searchParams.get("contactId");
  const saleId = request.nextUrl.searchParams.get("saleId");
  if (!contactId) return NextResponse.json({ error: "contactId is required" }, { status: 400 });

  try {
    const log = await readConversationLog(session.user.id, collectionId, contactId, saleId);
    if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(log);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
