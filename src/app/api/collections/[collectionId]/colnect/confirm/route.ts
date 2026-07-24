import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { confirmColnectMatch, ColnectMatchConflictError } from "@/lib/colnect";

// Commit a user-chosen Colnect match (#250, part of #155): write `Stamp.colnectId` for a stamp the
// user picked from a `needs-confirm` result. Returns 409 with the existing ID when the write would
// overwrite a different Colnect ID and `allowOverwrite` was not set.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { colnectId, stampId, allowOverwrite } = (body ?? {}) as {
    colnectId?: unknown;
    stampId?: unknown;
    allowOverwrite?: unknown;
  };
  if (typeof colnectId !== "string" || !colnectId.trim() || typeof stampId !== "string" || !stampId) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    await confirmColnectMatch(session.user.id, collectionId, {
      colnectId: colnectId.trim(),
      stampId,
      allowOverwrite: allowOverwrite === true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ColnectMatchConflictError) {
      return NextResponse.json(
        { error: "conflict", existingColnectId: err.existingColnectId },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
