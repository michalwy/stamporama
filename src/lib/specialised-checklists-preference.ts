import "server-only";
import { cookies } from "next/headers";
import { readSpecialisedChecklistsCookie, specialisedChecklistsCookieName } from "./checklist-kind";

/**
 * Whether this browser has specialised checklists switched on for this collection (#1617) — the
 * screens' one switch, read by every page, route and action that lists, offers or counts checklists.
 * The domain functions take the answer as a plain boolean and never read the cookie themselves: the
 * agent API states it per call (`include_specialised`), and a domain rule should not change with the
 * transport it was reached through.
 */
export async function readIncludeSpecialised(collectionId: string): Promise<boolean> {
  const store = await cookies();
  return readSpecialisedChecklistsCookie(store.get(specialisedChecklistsCookieName(collectionId))?.value);
}

/**
 * A Copies filter set with the switch its *Complete* filter judges by (#1884) — the header's chips
 * count specialised checklists only while it is on, so the filter has to as well, or it would keep
 * an issue whose chips on screen say otherwise. Read only when the filter is set.
 */
export async function withCompletenessSwitch<
  T extends { complete?: unknown; completeIncludesSpecialised?: boolean },
>(collectionId: string, filters: T): Promise<T> {
  return filters.complete
    ? { ...filters, completeIncludesSpecialised: await readIncludeSpecialised(collectionId) }
    : filters;
}
