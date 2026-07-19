import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { searchContacts } from "@/lib/contacts";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const query = request.nextUrl.searchParams.get("q") ?? "";
  // Only `platform` role-filtering is exposed today (purchase platform picker, #120);
  // any other value is ignored so the endpoint stays a plain name search.
  const role = request.nextUrl.searchParams.get("role") === "platform" ? "platform" : undefined;

  try {
    const items = await searchContacts(session.user.id, collectionId, query, role);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
