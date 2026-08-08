import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getStampMarketValues } from "@/lib/market-values";

// What the market paid for a stamp, per `condition × certificate × format` key that has evidence
// (#456; ADR-0022 §7). Computed on demand from the closed lots already recorded — nothing is
// stored, so editing a lot's final price changes the next answer.
//
// `stampId` repeats for a set of stamps; a stamp with no evidence is simply absent from the answer,
// since a key with no datapoints shows no market value at all (§6). Unpaginated: a stamp has a
// handful of keys and each a handful of lots. A static segment, so it takes precedence over the
// dynamic stamp routes beside it.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const stampIds = request.nextUrl.searchParams.getAll("stampId").filter(Boolean);
  // No stamp named is answered as "nothing to show" rather than as an error — this is a read.
  if (stampIds.length === 0) {
    return NextResponse.json({ values: {} });
  }

  try {
    const byStamp = await getStampMarketValues(session.user.id, collectionId, stampIds);
    return NextResponse.json({ values: Object.fromEntries(byStamp) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
