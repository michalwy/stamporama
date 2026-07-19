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
  // Role-filtering for the purchase pickers (#120): `seller` for the supplier field,
  // `platform` for the platform field. Any other value is ignored so the endpoint stays a
  // plain name search for its other callers.
  const roleParam = request.nextUrl.searchParams.get("role");
  const role =
    roleParam === "platform" ? "platform" : roleParam === "seller" ? "seller" : undefined;

  try {
    const items = await searchContacts(session.user.id, collectionId, query, role);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
