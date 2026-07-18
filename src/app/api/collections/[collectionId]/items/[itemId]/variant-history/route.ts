import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getItemVariantHistory } from "@/lib/items";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; itemId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;

  try {
    const history = await getItemVariantHistory(session.user.id, itemId);
    return NextResponse.json({ history });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
