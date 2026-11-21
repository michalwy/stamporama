import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listIssuesPaginated, type IssueSortBy } from "@/lib/issues";
import { readIssueListScopeParams } from "@/lib/issue-list-params";
import { readIncludeSpecialised } from "@/lib/specialised-checklists-preference";

const VALID_SORT_BY = new Set<IssueSortBy>(["year", "name", "catalogNumber"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

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
  // The narrowing — read by the one function the run over the shown issues reads it with (#2664).
  const scope = readIssueListScopeParams(sp);
  const displayConditionId = sp.get("displayConditionId") || undefined;
  const displayFormatId = sp.get("displayFormatId") || undefined;
  const sortByParam = sp.get("sortBy") as IssueSortBy | null;
  const sortBy = sortByParam && VALID_SORT_BY.has(sortByParam) ? sortByParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir = sortDirParam && VALID_SORT_DIR.has(sortDirParam) ? (sortDirParam as "asc" | "desc") : undefined;

  try {
    const result = await listIssuesPaginated(session.user.id, collectionId, {
      offset,
      ...scope,
      displayConditionId,
      displayFormatId,
      sortBy,
      sortDir,
      pageSize: 50,
      includeSpecialised: await readIncludeSpecialised(collectionId),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
