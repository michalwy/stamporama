import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionStructure } from "@/lib/collection-structure";
import {
  DEFAULT_ROW_DIMENSION,
  isStructureDimension,
} from "@/lib/collection-structure-rules";
import { readItemFilters } from "../item-filters";

/**
 * The collection structure screen (#1401): the screen's own address — the Copies list's filter names
 * — plus the dimensions and the two subtree switches, answered with the counts. The list routes'
 * parser is handed to the read, so the screen's filters are read by the very function that reads
 * the list's.
 */
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
  const rows = sp.get("rows");
  const columns = sp.get("cols");

  try {
    const structure = await getCollectionStructure(
      session.user.id,
      collectionId,
      {
        url: sp,
        rows: isStructureDimension(rows) ? rows : DEFAULT_ROW_DIMENSION,
        columns: isStructureDimension(columns) ? columns : null,
        // Absent is the switches' own default: include what is underneath (#385).
        includeSubAreas: sp.get("includeSubAreas") !== "false",
        includeSubLocations: sp.get("includeSubLocations") !== "false",
      },
      readItemFilters
    );
    return NextResponse.json(structure);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
