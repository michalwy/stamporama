import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSaleLotsPaginated } from "@/lib/sale-lots";
import { isLotKind, isLotState } from "@/lib/sale-lot-rules";

// Paginated sale-lot list for the Lots screen (ADR-0012, #164). Filters by kind + explicit
// state; the derived sale status is computed per row by the domain layer.
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
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;
  const kindParam = sp.get("kind");
  const kind = kindParam && isLotKind(kindParam) ? kindParam : undefined;
  const stateParam = sp.get("state");
  const state = stateParam && isLotState(stateParam) ? stateParam : undefined;
  const hideGrouped = sp.get("hideGrouped") === "1";

  try {
    const result = await listSaleLotsPaginated(session.user.id, collectionId, {
      offset,
      kind,
      state,
      hideGrouped,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
