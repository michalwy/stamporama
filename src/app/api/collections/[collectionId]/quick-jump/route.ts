import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { parseQuickJump } from "@/lib/quick-jump";
import { quickJumpMissMessage, resolveQuickJump } from "@/lib/quick-jump-server";

// `GET …/quick-jump?q=<what was typed>` (#431).
//
// The box sends what the collector typed and gets back an address or a sentence. Parsing happens
// here as well as in the box — the box parses to know whether to ask at all, this parses because a
// route never trusts its query — and both call the one pure parser, so the two answers cannot drift.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;
  const target = parseQuickJump(sp.get("q") ?? "");

  if (!target) {
    // Not a jump at all — a distinct answer from "no such row", because the two need different
    // words in front of the collector.
    return NextResponse.json({ href: null, message: null }, { status: 200 });
  }

  const result = await resolveQuickJump(session.user.id, collectionId, target);
  if (!result) {
    return NextResponse.json({ href: null, message: quickJumpMissMessage(target) }, { status: 200 });
  }
  return NextResponse.json({ href: result.href, message: null }, { status: 200 });
}
