import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getDashboardSection } from "@/lib/dashboard";
import { isDashboardSectionId } from "@/lib/dashboard-rules";

// One section of the operational Dashboard (#1808). One route per section, so each section loads —
// and shows its skeleton — on its own, the Overview's pattern (#649); the section is a path segment
// rather than five files because the five share everything but the providers behind them.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; section: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, section } = await params;
  if (!isDashboardSectionId(section)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    return NextResponse.json(await getDashboardSection(session.user.id, collectionId, section));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
