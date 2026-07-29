import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getIssueCatalogPrefixes } from "@/lib/issue-prefix";

/**
 * Every per-issue catalog prefix override in the collection (#377), unpaginated. Every list screen
 * that renders a catalog chip needs the whole map up front — a stamp's prefix depends on its issue,
 * not only its area — and the table only holds rows for issues that actually override something.
 *
 * A static segment ahead of `[issueId]`, so it takes precedence over the per-issue routes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  try {
    const prefixes = await getIssueCatalogPrefixes(session.user.id, collectionId);
    return NextResponse.json({ prefixes });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
