// Duplicate grouping for the Copies list (#372) — the pure half. No React, no Prisma, so the
// server read, the client panel and the unit tests share one derivation.
//
// A **duplicate group** is a bag of copies of one stamp. The key's only fixed part is the stamp;
// the three other axes a copy carries — **condition**, physical **format** (ADR-0020) and
// **certificate** — are *configurable*: off means the field does not split the group (any value),
// on means it joins the key. With all three on the key is exactly the key catalogue valuation is
// computed on (`valuateItemRows`), so every group then has one unambiguous per-copy figure.
//
// Condition was fixed until #1537. #372 keyed every group on `stamp × condition` because Colnect
// refuses more than one offer for the same stamp in the same condition, so a group mixing
// conditions read as an offer that could not be posted. But the grouping answers a second question
// too — *do I hold this stamp in several conditions?* — and that one was spread across a group per
// condition. So condition became a switch like the other two, **off by default**, and the Colnect
// rule is met where an offer is actually made: a minority condition is an outlier left out of the
// quick select-all, the listing flow's *one single-copy set each* is unchanged, and the Colnect
// reading of the key survives as {@link COLNECT_GROUP_AXES}, which is what the offer collision
// check (#513) compares on.
//
// Grouping is **not filtering**. The sidebar's condition / format / certificate filters narrow
// *which copies you look at*; these toggles decide *what counts as the same item*. Both compose.

/** Which of the optional axes join the grouping key. */
export interface CopyGroupAxes {
  condition: boolean;
  format: boolean;
  certificate: boolean;
}

/** The Copies list's default (#1537): one group per stamp, whatever the copies' condition. */
export const DEFAULT_GROUP_AXES: CopyGroupAxes = {
  condition: false,
  format: false,
  certificate: false,
};

/** The key as Colnect reads it: one quantity offer per stamp × condition (#372), format and
 * certificate not splitting it. What the offer collision check compares on. */
export const COLNECT_GROUP_AXES: CopyGroupAxes = {
  condition: true,
  format: false,
  certificate: false,
};

/** One of the axes a group can be split on, or left mixed. */
export type CopyGroupAxis = keyof CopyGroupAxes;

/** The dimensions a copy is grouped on. `formatId`/`certificateStatusId` are null both when the
 * copy carries no such value *and* when the axis is off — {@link copyGroupKey} zeroes an axis that
 * is not part of the key, so a key never claims a value it did not group on. A copy always carries
 * a condition, so `conditionId` is null only when that axis is off. */
export interface CopyGroupKey {
  stampId: string;
  conditionId: string | null;
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
    conditionId: axes.condition ? copy.conditionId : null,
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
    axes.condition ? (key.conditionId ?? NONE) : "",
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
  const [stampId, condition, format, certificate] = parts;
  if (!stampId) return null;
  return {
    key: {
      stampId,
      conditionId: condition === "" || condition === NONE ? null : condition,
      formatId: format === "" ? null : format === NONE ? null : format,
      certificateStatusId: certificate === "" ? null : certificate === NONE ? null : certificate,
    },
    axes: {
      condition: condition !== "",
      format: format !== "",
      certificate: certificate !== "",
    },
  };
}

/** The axes currently set to *any* — the ones a group can be **mixed** on. With an axis joined to
 * the key, a mixed marker cannot occur by construction. */
export function anyAxes(axes: CopyGroupAxes): CopyGroupAxis[] {
  const out: CopyGroupAxis[] = [];
  if (!axes.condition) out.push("condition");
  if (!axes.format) out.push("format");
  if (!axes.certificate) out.push("certificate");
  return out;
}

/** Whether a group's members actually disagree on each *any* axis. Derived, never a rule of its
 * own: an axis that is part of the key is reported `false` without looking at the members. */
export function mixedAxes(
  members: GroupableCopy[],
  axes: CopyGroupAxes
): Record<CopyGroupAxis, boolean> {
  return {
    condition: !axes.condition && distinct(members.map((m) => m.conditionId)).length > 1,
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
    const valueOf = (m: GroupableCopy) => axisValue(m, axis);
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

function axisValue(copy: GroupableCopy, axis: CopyGroupAxis): string | null {
  switch (axis) {
    case "condition":
      return copy.conditionId;
    case "format":
      return copy.formatId;
    case "certificate":
      return copy.certificateStatusId;
  }
}

function distinct(values: (string | null)[]): (string | null)[] {
  return [...new Set(values)];
}
