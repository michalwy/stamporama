"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  getCompletenessReport,
  getChecklistMissingStamps,
  type CompletenessReport,
} from "@/lib/completeness-screen";
import { readYearFilter } from "@/lib/list-area-year-filter";
import {
  COMPLETENESS_DISPOSITION_CHIPS,
  type CompletenessDispositionChip,
} from "@/lib/completeness-screen-rules";
import { readIncludeSpecialised } from "@/lib/specialised-checklists-preference";

// Server actions for the Completeness screen (#2266). Both reads honour the specialised-checklists
// switch (#1617) through the cookie the screens write, as every completeness read does.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** What the screen asks: the rail's selection, and which copies count. */
export interface CompletenessRequest {
  /** The chosen areas with their sub-areas already resolved; absent is every area. */
  areaIds?: string[];
  /** The rail's `year` value — a year, `none`, a decade or a span. */
  year?: string;
  conditionIds: string[];
  dispositions: CompletenessDispositionChip[];
}

function knownChips(chips: readonly string[]): CompletenessDispositionChip[] {
  return COMPLETENESS_DISPOSITION_CHIPS.filter((c) => chips.includes(c));
}

/** The summary and the incomplete checklists for the chosen area, years, conditions and chips. */
export async function getCompletenessReportAction(
  collectionId: string,
  request: CompletenessRequest
): Promise<CompletenessReport> {
  const session = await getSession();
  return getCompletenessReport(session.user.id, collectionId, {
    areaIds: request.areaIds,
    ...readYearFilter(request.year),
    conditionIds: request.conditionIds,
    dispositions: knownChips(request.dispositions),
    includeSpecialised: await readIncludeSpecialised(collectionId),
  });
}

/** The stamps one checklist lacks under the chosen conditions and chips, named by catalogue number. */
export async function getChecklistMissingStampsAction(
  collectionId: string,
  checklistId: string,
  request: Pick<CompletenessRequest, "conditionIds" | "dispositions">
): Promise<string[]> {
  const session = await getSession();
  return getChecklistMissingStamps(session.user.id, collectionId, checklistId, {
    conditionIds: request.conditionIds,
    dispositions: knownChips(request.dispositions),
  });
}
