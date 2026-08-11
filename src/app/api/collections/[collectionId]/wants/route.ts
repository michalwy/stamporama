import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listWantsPaginated } from "@/lib/wants";
import { parseWantListFilters } from "./want-filters";

/** One page of the want list (#532), cursor-scrolled like every other large list here. A want list
 * is a shopping list for a whole collecting plan and runs to thousands of rows, so every filter is
 * a `where` on the server rather than a pass over rows already in the browser. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  try {
    const result = await listWantsPaginated(
      session.user.id,
      collectionId,
      parseWantListFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
