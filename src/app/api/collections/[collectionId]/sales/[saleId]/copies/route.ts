import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSaleCopies } from "@/lib/sales";

// Every copy across a whole sale, for the packing view's "group by lot off" flat / by-issue
// stream (ADR-0012, #166). Loaded only when that view is opened.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; saleId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { saleId } = await params;
  try {
    const items = await listSaleCopies(session.user.id, saleId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
