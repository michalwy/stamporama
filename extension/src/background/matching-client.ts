import { normalizeBaseUrl, type Profile } from "../core/profile";
import type { BackfillProposal, MatchResult } from "../core/decisions";
import type { ExtractedItem } from "../platform/types";

// The instance-facing HTTP client, run from the background service worker so host_permissions exempt
// it from CORS. Talks to the Colnect matcher endpoints (#250), authenticating with the active
// profile's bearer token.

function endpoint(profile: Profile, path: string): string {
  return `${normalizeBaseUrl(profile.apiBaseUrl)}/api/collections/${profile.collectionId}/colnect/${path}`;
}

function authHeaders(profile: Profile): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${profile.token}` };
}

/** Run a batch through the matcher. `dryRun` computes decisions without persisting; `backfill` asks
 *  for the missing-catalog proposals (#280), which a real run also writes. */
export async function callMatch(
  profile: Profile,
  items: ExtractedItem[],
  dryRun: boolean,
  backfill: boolean
): Promise<MatchResult[]> {
  const res = await fetch(endpoint(profile, "match"), {
    method: "POST",
    headers: authHeaders(profile),
    body: JSON.stringify({
      dryRun,
      backfill,
      items: items.map((i) => ({ colnectId: i.platformItemId, catalogRefs: i.catalogRefs })),
    }),
  });
  if (res.status === 401) throw new Error("Unauthorized — check the profile token.");
  if (!res.ok) throw new Error(`Match request failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { results: MatchResult[] };
  return data.results;
}

export type ConfirmOutcome =
  | { ok: true; backfill: BackfillProposal[] }
  | { ok: false; conflict: true; existingColnectId?: string }
  | { ok: false; conflict: false; error: string };

/** Commit a chosen match, optionally backfilling the chosen stamp from the item's printed numbers
 *  (#280). A 409 surfaces as a conflict (existing different Colnect ID). */
export async function callConfirm(
  profile: Profile,
  colnectId: string,
  stampId: string,
  opts: {
    allowOverwrite?: boolean;
    backfill?: boolean;
    catalogRefs?: { catalog: string; number: string }[];
  } = {}
): Promise<ConfirmOutcome> {
  const res = await fetch(endpoint(profile, "confirm"), {
    method: "POST",
    headers: authHeaders(profile),
    body: JSON.stringify({
      colnectId,
      stampId,
      allowOverwrite: opts.allowOverwrite,
      backfill: opts.backfill,
      catalogRefs: opts.catalogRefs,
    }),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { backfill?: BackfillProposal[] };
    return { ok: true, backfill: data.backfill ?? [] };
  }
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as { existingColnectId?: string };
    return { ok: false, conflict: true, existingColnectId: data.existingColnectId };
  }
  if (res.status === 401) return { ok: false, conflict: false, error: "Unauthorized — check the profile token." };
  return { ok: false, conflict: false, error: `Confirm request failed (HTTP ${res.status}).` };
}
