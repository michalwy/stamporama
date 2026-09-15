import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listProfitAndLossSales } from "@/lib/profit-and-loss";
import { parseDateRange } from "@/lib/profit-and-loss-rules";

// The profit and loss screen's by-sale list (#1305): every sale in the range with its own profit
// figure, newest first, offset-paginated for the shared infinite scroll.
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
  const offsetParam = sp.get("offset");
  const offset = offsetParam ? parseInt(offsetParam, 10) || 0 : 0;

  try {
    return NextResponse.json(
      await listProfitAndLossSales(
        session.user.id,
        collectionId,
        parseDateRange(sp.get("from"), sp.get("to")),
        offset,
        50
      )
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
