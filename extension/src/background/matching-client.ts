import { normalizeBaseUrl, type Profile } from "../core/profile";
import type {
  AttributeProposal,
  BackfillProposal,
  DateProposal,
  MatchResult,
} from "../core/decisions";
import type { ExtractedAttributes, ExtractedItem } from "../platform/types";

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
 *  for the missing-catalog proposals (#280), `issueDate` for the date ones (#655) and `attributes`
 *  for the stamp-attribute ones (#739) — each of which a real run also writes. */
export async function callMatch(
  profile: Profile,
  items: ExtractedItem[],
  dryRun: boolean,
  backfill: boolean,
  issueDate: boolean,
  attributes: boolean
): Promise<MatchResult[]> {
  const res = await fetch(endpoint(profile, "match"), {
    method: "POST",
    headers: authHeaders(profile),
    body: JSON.stringify({
      dryRun,
      backfill,
      issueDate,
      attributes,
      items: items.map((i) => ({
        colnectId: i.platformItemId,
        catalogRefs: i.catalogRefs,
        issuedOn: i.issuedOn,
        attributes: i.attributes,
      })),
    }),
  });
  if (res.status === 401) throw new Error("Unauthorized — check the profile token.");
  if (!res.ok) throw new Error(`Match request failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { results: MatchResult[] };
  return data.results;
}

export type ConfirmOutcome =
  | {
      ok: true;
      backfill: BackfillProposal[];
      date: DateProposal | null;
      attributes: AttributeProposal[];
    }
  | { ok: false; conflict: true; existingColnectId?: string }
  | { ok: false; conflict: false; error: string };

/** Commit a chosen match, optionally backfilling the chosen stamp from the item's printed numbers
 *  (#280) and dating it from its printed date (#655). A 409 surfaces as a conflict (existing
 *  different Colnect ID). */
export async function callConfirm(
  profile: Profile,
  colnectId: string,
  stampId: string,
  opts: {
    allowOverwrite?: boolean;
    backfill?: boolean;
    catalogRefs?: { catalog: string; number: string }[];
    issueDate?: boolean;
    issuedOn?: string;
    attributeSync?: boolean;
    attributes?: ExtractedAttributes;
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
      issueDate: opts.issueDate,
      issuedOn: opts.issuedOn,
      attributeSync: opts.attributeSync,
      attributes: opts.attributes,
    }),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      backfill?: BackfillProposal[];
      date?: DateProposal | null;
      attributes?: AttributeProposal[];
    };
    return {
      ok: true,
      backfill: data.backfill ?? [],
      date: data.date ?? null,
      attributes: data.attributes ?? [],
    };
  }
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as { existingColnectId?: string };
    return { ok: false, conflict: true, existingColnectId: data.existingColnectId };
  }
  if (res.status === 401) return { ok: false, conflict: false, error: "Unauthorized — check the profile token." };
  return { ok: false, conflict: false, error: `Confirm request failed (HTTP ${res.status}).` };
}

export type OverwriteNumberOutcome =
  | { ok: true; label: string; duplicateStampNames?: string[] }
  | { ok: false; error: string };

/**
 * Replace one of a stamp's catalog numbers with the value Colnect prints (#433). The number sent is
 * the bare one the matcher already resolved for that conflict, so the instance stores exactly what
 * the window offered. A 409 is the collection refusing a duplicate catalog identity (#85) — a
 * refusal with a reason, phrased here rather than left as a status code.
 */
export async function callOverwriteNumber(
  profile: Profile,
  stampId: string,
  catalogVendorId: string,
  number: string
): Promise<OverwriteNumberOutcome> {
  const res = await fetch(endpoint(profile, "overwrite-number"), {
    method: "POST",
    headers: authHeaders(profile),
    body: JSON.stringify({ stampId, catalogVendorId, number }),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      label?: string;
      duplicateStampNames?: string[];
    };
    return {
      ok: true,
      label: data.label ?? number,
      ...(data.duplicateStampNames ? { duplicateStampNames: data.duplicateStampNames } : {}),
    };
  }
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as { stampNames?: string[] };
    const names = data.stampNames?.join(", ");
    return {
      ok: false,
      error: `Not changed — that number is already on ${names || "another stamp"}.`,
    };
  }
  if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
  return { ok: false, error: `Overwrite request failed (HTTP ${res.status}).` };
}

export type OverwriteDateOutcome = { ok: true; label: string } | { ok: false; error: string };

/**
 * Replace a stamp's date of issue with the one the Colnect page prints (#655). The printed value is
 * sent as the matcher received it and read on the instance, so the window and the instance cannot
 * disagree about what the page said. One stamp, one field, taken deliberately — the date sync
 * itself never corrects a date we already state.
 */
export async function callOverwriteDate(
  profile: Profile,
  stampId: string,
  issuedOn: string
): Promise<OverwriteDateOutcome> {
  const res = await fetch(endpoint(profile, "overwrite-date"), {
    method: "POST",
    headers: authHeaders(profile),
    body: JSON.stringify({ stampId, issuedOn }),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { label?: string };
    return { ok: true, label: data.label ?? issuedOn };
  }
  if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
  return { ok: false, error: `Date request failed (HTTP ${res.status}).` };
}

export type OverwriteAttributesOutcome =
  | { ok: true; attributes: AttributeProposal[] }
  | { ok: false; error: string };

/**
 * Replace what a stamp states about itself with what the Colnect page prints (#739) — the date
 * overwrite five fields wider.
 *
 * Only the attributes **sent** are touched, so an unticked disagreement is expressed by leaving that
 * attribute out. The printed values travel as the matcher received them and are compared on the
 * instance, which is what lets a mapping edited in the meantime be honoured rather than baked into
 * the request — and what keeps an unmapped word from being written by a path that could not read it
 * in the first place.
 */
export async function callOverwriteAttributes(
  profile: Profile,
  stampId: string,
  attributes: ExtractedAttributes
): Promise<OverwriteAttributesOutcome> {
  const res = await fetch(endpoint(profile, "overwrite-attributes"), {
    method: "POST",
    headers: authHeaders(profile),
    body: JSON.stringify({ stampId, attributes }),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { attributes?: AttributeProposal[] };
    return { ok: true, attributes: data.attributes ?? [] };
  }
  if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
  return { ok: false, error: `Attribute request failed (HTTP ${res.status}).` };
}
