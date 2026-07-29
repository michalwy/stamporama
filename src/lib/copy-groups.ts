// Duplicate grouping for the Copies list (#372) — the pure half. No React, no Prisma, so the
// server read, the client panel and the unit tests share one derivation.
//
// A **duplicate group** is a bag of interchangeable copies: the stock you would list on Colnect as
// one offer with a quantity, since it refuses more than one offer for the same stamp in the same
// condition. Hence the key's fixed part, `stamp × condition`. Condition is not optional — a group
// mixing conditions would produce an offer that cannot be posted.
//
// The two remaining axes a copy carries — physical **format** (ADR-0020) and **certificate** — are
// *configurable*: off means the field does not split the group (any value), on means it joins the
// key. With both on the key is exactly the key catalogue valuation is computed on
// (`valuateItemRows`), so every group then has one unambiguous per-copy figure.
//
// Grouping is **not filtering**. The sidebar's condition / format / certificate filters narrow
// *which copies you look at*; these toggles decide *what counts as the same item*. Both compose.

/** Which of the optional axes join the grouping key. Both off is the plain Colnect rule. */
export interface CopyGroupAxes {
  format: boolean;
  certificate: boolean;
}

export const DEFAULT_GROUP_AXES: CopyGroupAxes = { format: false, certificate: false };

/** The dimensions a copy is grouped on. `formatId`/`certificateStatusId` are null both when the
 * copy carries no such value *and* when the axis is off — {@link copyGroupKey} zeroes an axis that
 * is not part of the key, so a key never claims a value it did not group on. */
export interface CopyGroupKey {
  stampId: string;
  conditionId: string;
  formatId: string | null;
  certificateStatusId: string | null;
}

/** The minimum a copy must carry to be grouped. Satisfied structurally by `ItemListItem`. */
export interface GroupableCopy {
  stampId: string;
  conditionId: string;
  formatId: string | null;
  certificateStatusId: string | null;
}

/** The sentinel standing in for "no value on this axis" inside an encoded key. A cuid never
 * collides with it, and it must be distinguishable from an axis that is simply not part of the
 * key — which {@link encodeCopyGroupKey} writes as an empty segment. */
const NONE = "none";

/** The group a copy belongs to under `axes`. An axis that is off is zeroed rather than carried, so
 * two copies differing only on it produce the same key. */
export function copyGroupKey(copy: GroupableCopy, axes: CopyGroupAxes): CopyGroupKey {
  return {
    stampId: copy.stampId,
    conditionId: copy.conditionId,
    formatId: axes.format ? copy.formatId : null,
    certificateStatusId: axes.certificate ? copy.certificateStatusId : null,
  };
}

/**
 * Stable string form of a group key — the React key, the map key, and the token the row action
 * passes back to address the group's members. Encodes the axes too, so a key taken while Format was
 * joined cannot be read back as one that grouped every format together.
 */
export function encodeCopyGroupKey(key: CopyGroupKey, axes: CopyGroupAxes): string {
  return [
    key.stampId,
    key.conditionId,
    axes.format ? (key.formatId ?? NONE) : "",
    axes.certificate ? (key.certificateStatusId ?? NONE) : "",
  ].join("|");
}

/** Read an encoded key back. Returns null on anything malformed — a stale link narrows to nothing
 * otherwise, and an empty screen is unguessable. */
export function decodeCopyGroupKey(
  encoded: string
): { key: CopyGroupKey; axes: CopyGroupAxes } | null {
  const parts = encoded.split("|");
  if (parts.length !== 4) return null;
  const [stampId, conditionId, format, certificate] = parts;
  if (!stampId || !conditionId) return null;
  return {
    key: {
      stampId,
      conditionId,
      formatId: format === "" ? null : format === NONE ? null : format,
      certificateStatusId: certificate === "" ? null : certificate === NONE ? null : certificate,
    },
    axes: { format: format !== "", certificate: certificate !== "" },
  };
}

/** The axes currently set to *any* — the ones a group can be **mixed** on. With an axis joined to
 * the key, a mixed marker cannot occur by construction. */
export function anyAxes(axes: CopyGroupAxes): ("format" | "certificate")[] {
  const out: ("format" | "certificate")[] = [];
  if (!axes.format) out.push("format");
  if (!axes.certificate) out.push("certificate");
  return out;
}

/** Whether a group's members actually disagree on each *any* axis. Derived, never a rule of its
 * own: an axis that is part of the key is reported `false` without looking at the members. */
export function mixedAxes(
  members: GroupableCopy[],
  axes: CopyGroupAxes
): { format: boolean; certificate: boolean } {
  return {
    format: !axes.format && distinct(members.map((m) => m.formatId)).length > 1,
    certificate:
      !axes.certificate && distinct(members.map((m) => m.certificateStatusId)).length > 1,
  };
}

/**
 * The **outliers** of a group: copies differing from the group's *most common* value on an axis
 * that is currently *any*. Deliberately not a fixed "format ≠ single / has a certificate" test — a
 * stock of ten certified blocks and one plain single has the single as the outlier, not the other
 * way round. A tie leaves the whole group unmarked: with no majority there is nothing to be an
 * outlier from.
 *
 * Returns the ids to flag; the picker highlights them so they can be unchecked and listed
 * separately, rather than silently dropping them from a listing the collector meant to make.
 */
export function outlierCopyIds<T extends GroupableCopy & { id: string }>(
  members: T[],
  axes: CopyGroupAxes
): Set<string> {
  const out = new Set<string>();
  if (members.length < 2) return out;
  for (const axis of anyAxes(axes)) {
    const valueOf = (m: GroupableCopy) =>
      axis === "format" ? m.formatId : m.certificateStatusId;
    const modal = modalValue(members.map(valueOf));
    if (modal === undefined) continue; // no majority — nothing is the exception here
    for (const m of members) {
      if (valueOf(m) !== modal) out.add(m.id);
    }
  }
  return out;
}

/** The single most common value, or `undefined` when the top count is shared (a tie) or the values
 * already agree (nothing stands out). */
function modalValue(values: (string | null)[]): string | null | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string | null, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size < 2) return undefined;
  let best: string | null = null;
  let bestCount = -1;
  let tied = false;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

function distinct(values: (string | null)[]): (string | null)[] {
  return [...new Set(values)];
}
