import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { markColnectApplied } from "@/lib/colnect-list-apply";

// "These differences have been carried out on Colnect" (#689), reported by the Assistant as the run
// lands them.
//
// A **route** rather than a server action, and session-or-token authorized like every other one the
// extension calls (`route-auth.ts`): the reporter is the background service worker, which holds the
// profile's bearer token and reaches this instance cross-site.
//
// **Batched, and small batches.** The run is paced at roughly one write every other second, so a
// request beside each of them would double the traffic to this instance for nothing — but marking
// only at the end would leave a crashed run's report describing a Colnect that has already moved.
// A handful at a time is the point where the report and the run cannot meaningfully disagree.
//
// The claim itself is the ordinary one (#686): it hangs off the snapshot, so the next import checks
// it against a fresh reading of Colnect rather than believing it for ever.

interface Body {
  lt?: unknown;
  marks?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const lt = Number(body?.lt);
  if (!Number.isFinite(lt)) {
    return NextResponse.json({ error: "Which list?" }, { status: 400 });
  }
  if (!Array.isArray(body?.marks)) {
    return NextResponse.json({ error: "Nothing to mark." }, { status: 400 });
  }

  // Each mark is read for the two fields it must have and nothing else; one that is malformed is
  // dropped rather than failing the batch, because the batch is a slice of a run that has already
  // written to Colnect and refusing it would lose a true claim over a bad neighbour.
  const marks = body.marks.flatMap((entry) => {
    const mark = entry as { colnectId?: unknown; kind?: unknown };
    return typeof mark?.colnectId === "string" && typeof mark?.kind === "string"
      ? [{ colnectId: mark.colnectId, kind: mark.kind }]
      : [];
  });

  try {
    const result = await markColnectApplied(ownerId, collectionId, lt, marks);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not mark those rows." }, { status: 404 });
  }
}
