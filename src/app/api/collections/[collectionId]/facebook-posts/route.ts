import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listFacebookPostsPaginated } from "@/lib/facebook-posts";
import { isFacebookPostStage } from "@/lib/facebook-post-rules";

// The list of a collection's multi-lot Facebook posts (#1850), newest first. `group` is a
// comma-separated set of group ids and `stage` one stage; an unrecognised stage is dropped rather than
// refused, as the other lists drop an unknown status. `untitled=1` keeps the posts with no title (#1862).
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
  const groupIds = (sp.get("group") || "").split(",").filter(Boolean);
  const stageParam = sp.get("stage") ?? "";
  const stage = isFacebookPostStage(stageParam) ? stageParam : undefined;
  const untitled = sp.get("untitled") === "1";

  try {
    const result = await listFacebookPostsPaginated(session.user.id, collectionId, {
      offset,
      groupIds,
      stage,
      untitled,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
