import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getContactPage } from "@/lib/contact-page";
import { DEFAULT_CONTACT_PERIOD, isContactPeriod } from "@/lib/contact-page-rules";

/** A contact's own page (#1708): the contact, and its role sections over the period asked for. The
 * period is the client's (remembered per collection), so the page reads through here rather than
 * being rendered on the server. An unknown period reads as the default rather than failing. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; contactId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, contactId } = await params;
  const periodParam = request.nextUrl.searchParams.get("period");
  const period = isContactPeriod(periodParam) ? periodParam : DEFAULT_CONTACT_PERIOD;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const page = await getContactPage(session.user.id, contactId, period, today);
    if (!page || page.contact.collectionId !== collectionId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
