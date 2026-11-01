import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listProposalsPaginated } from "@/lib/proposals";
import { isProposalStatus } from "@/lib/proposal-rules";

// The list of a collection's proposals (#2287), newest first. `status` is a comma-separated set of
// statuses, an unrecognised one dropped rather than refused, as the other lists drop one.
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
  const statuses = (sp.get("status") || "").split(",").filter(isProposalStatus);

  try {
    const result = await listProposalsPaginated(session.user.id, collectionId, { offset, statuses, pageSize: 50 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
