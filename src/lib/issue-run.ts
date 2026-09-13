import {
  catalogValueEntry,
  catalogValueSubjectKey,
  type IntakeCatalogValue,
} from "./intake-catalog-value";

/**
 * *Identify ticked tiles as the stamps of a checklist, in turn* (#1220, #1225) — the pure half.
 *
 * A card often holds a set: several, or all, of one checklist's stamps. #596 identifies a selection
 * as **one** stamp, which is the wrong answer for a set; walking each tile through the picker is
 * right but says the same thing — *this set, the next value* — once per stamp. So the collector
 * ticks the tiles in the order the set reads, picks the checklist once, and the tiles take its
 * stamps **in turn**. What remains is correcting the ones that skip a value.
 *
 * **The unit is a checklist, not an issue** (#1225). #1220 built the run on an issue's main stamps in
 * catalogue order, and both halves were wrong for how a collection is organised: an issue often has
 * several checklists (imperforate beside perforated, collected and so identified independently), and
 * a checklist's order is set by hand (#764). The checklist is what picks the right set, so there is
 * no *main stamps only* rule left to stand in for it.
 *
 * Everything that decides *which tile gets which stamp* and *which answer a copy is created with*
 * lives here, because both are read by two sides: the dialog draws them while the collector works,
 * and the write reads the very same resolution so the copy is what the screen said it would be.
 */

// ── The checklist ────────────────────────────────────────────────────────────────────────────────

/**
 * The checklist a run is built on, as the run reads it.
 *
 * `stampIds` **is the sequence**: every stamp the checklist holds, variants included, in the order
 * its own screen shows (#764's `sortOrder`, the stamp id behind it) — so a checklist whose order was
 * never dragged into shape reads in the order it was backfilled or appended in, exactly as it is
 * drawn there. There is never a separate order just for the run.
 *
 * `issues` are the issues it covers: its own issue, or — for a checklist that spans issues — every
 * issue one of its stamps is on. A tile can be corrected to any stamp of those.
 */
export interface RunChecklist {
  id: string;
  name: string;
  /** Null for a checklist that spans issues. */
  issueId: string | null;
  stampIds: string[];
  issues: { id: string; name: string | null; year: number | null; collectionAreaId: string }[];
}

// ── The choices ──────────────────────────────────────────────────────────────────────────────────

/** An issue member as the run reads it — the fields `StampNodeData` already carries. */
export interface RunMember {
  stampId: string;
  parentId: string | null;
  /** Effective `actsAsVariant` (ADR-0010 §3). */
  actsAsVariant: boolean;
  catalogNumbers: readonly { catalogVendorId: string; number: string }[];
}

/**
 * The members in the order the issue's tree draws them: each root, then its subtree, depth first,
 * keeping the order the members arrived in (the manual order, #549) within every sibling group.
 * A member whose parent is not in the issue is a root, as `buildStampTree` has it.
 */
export function treeOrder<T extends RunMember>(members: readonly T[]): T[] {
  const ids = new Set(members.map((m) => m.stampId));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const m of members) {
    if (m.parentId && ids.has(m.parentId)) {
      const list = children.get(m.parentId) ?? [];
      list.push(m);
      children.set(m.parentId, list);
    } else {
      roots.push(m);
    }
  }
  const out: T[] = [];
  const walk = (node: T) => {
    out.push(node);
    for (const child of children.get(node.stampId) ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** The stamps a tile can be corrected to, in the order they are offered. */
export interface RunChoices<T extends RunMember> {
  /** The checklist's own stamps, in the sequence's order — offered first. Flat, as a checklist is. */
  onChecklist: T[];
  /** Every other stamp of the issues the checklist covers, one group per issue in the order given,
   * as that issue's tree draws them. `depth` counts only the ancestors drawn in the same group, so a
   * variant whose base is on the checklist is not indented under a row that is not there. */
  others: { issueId: string; nodes: { node: T; depth: number }[] }[];
}

/**
 * **Correcting a tile still reaches any stamp** (#1225): a tile that turns out to be the perforated
 * one in an imperforate run must have somewhere to go. The checklist's stamps come first, because
 * they are what the tile most likely is; then the rest of each issue the checklist covers.
 *
 * A stamp is offered once — a stamp on two covered issues stays in the first group it appears in —
 * and a sequence id no issue carries (a stamp still being read) is simply not offered yet.
 */
export function runChoices<T extends RunMember>(
  sequence: readonly string[],
  issues: readonly { issueId: string; members: readonly T[] }[]
): RunChoices<T> {
  const byId = new Map<string, T>();
  for (const issue of issues) {
    for (const m of issue.members) if (!byId.has(m.stampId)) byId.set(m.stampId, m);
  }
  const offered = new Set<string>();
  const onChecklist: T[] = [];
  for (const id of sequence) {
    const node = byId.get(id);
    if (!node || offered.has(id)) continue;
    offered.add(id);
    onChecklist.push(node);
  }
  const others = issues.map((issue) => {
    const rest = treeOrder(issue.members).filter((m) => !offered.has(m.stampId));
    for (const m of rest) offered.add(m.stampId);
    const shown = new Map(rest.map((m) => [m.stampId, m]));
    const nodes = rest.map((node) => {
      let depth = 0;
      let parentId = node.parentId;
      const seen = new Set<string>();
      while (parentId && shown.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        depth += 1;
        parentId = shown.get(parentId)?.parentId ?? null;
      }
      return { node, depth };
    });
    return { issueId: issue.issueId, nodes };
  });
  return { onChecklist, others };
}

/** Every offered stamp's id, in the order {@link runChoices} offers them — the order the run's price
 * list reads in (#1223), so the list follows the checklist exactly as the tiles do. */
export function runStampOrder(choices: RunChoices<RunMember>): string[] {
  return [
    ...choices.onChecklist.map((m) => m.stampId),
    ...choices.others.flatMap((group) => group.nodes.map((n) => n.node.stampId)),
  ];
}

// ── Assigning ────────────────────────────────────────────────────────────────────────────────────

/** One tile of the run, as the dialog draws it and the write is handed it. */
export interface RunAssignment {
  tileId: string;
  /** Null while the tile has no stamp — the more-tiles-than-stamps case. */
  stampId: string | null;
  /** Whether the collector chose this stamp, rather than the tile taking its turn. */
  corrected: boolean;
}

/**
 * Give each tile of the run its stamp: the first tile the first stamp of the sequence, the second
 * the second, and so on — **except where the collector has corrected one**, which keeps its answer.
 *
 * `tileIds` is the run in the order the tiles were **ticked**, with any taken out of it already gone:
 * the tiles still in the run take the stamps in turn, so taking out a stray piece ticked by mistake
 * moves the ones after it up rather than leaving a stamp unused. A correction does not cascade — the
 * tile after a corrected one keeps its own turn, and a slip that lands two tiles on one stamp is
 * shown rather than silently resolved (see {@link repeatedStamps}).
 *
 * **Fewer tiles than stamps** is the ordinary case (*several of the set*): the tiles take the first
 * stamps. **More tiles than stamps** leaves the extra ones with no stamp, and nothing is created
 * until each is given one or taken out ({@link runBlockers}).
 *
 * Re-derived rather than stored, so a stamp added to the checklist in the middle of the pass reaches
 * the tiles still taking their turn.
 */
export function assignInTurn(
  tileIds: readonly string[],
  sequence: readonly string[],
  corrections: ReadonlyMap<string, string> = new Map()
): RunAssignment[] {
  return tileIds.map((tileId, i) => {
    const corrected = corrections.get(tileId);
    return corrected != null
      ? { tileId, stampId: corrected, corrected: true }
      : { tileId, stampId: sequence[i] ?? null, corrected: false };
  });
}

/** The stamps assigned to more than one tile. Allowed — duplicates are real — and shown, so a slip
 * is noticed before it becomes two copies of one value and none of its neighbour. */
export function repeatedStamps(assignments: readonly RunAssignment[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const a of assignments) {
    if (!a.stampId) continue;
    if (seen.has(a.stampId)) repeated.add(a.stampId);
    seen.add(a.stampId);
  }
  return repeated;
}

/** The tiles that stop the pass: still in the run with no stamp. Empty is the only state in which
 * anything is created. */
export function runBlockers(assignments: readonly RunAssignment[]): string[] {
  return assignments.filter((a) => !a.stampId).map((a) => a.tileId);
}

// ── The copy details ─────────────────────────────────────────────────────────────────────────────

/**
 * What the condition step asks, in the shape a run answers it: once for all tiles, and per tile
 * where one differs. `""` is *none* for every optional field — no certificate, a single, no location
 * — exactly as the condition step's own fields read, so an override can say *this one has no
 * certificate* while the rest carry one.
 *
 * The ref rides with the location it is a place in, and the three disposition flags are one answer:
 * overriding either is overriding the whole of it, since half a place or half a disposition is not
 * something the collector decides separately.
 */
export interface RunCopyDetails {
  conditionId: string;
  certificateStatusId: string;
  formatId: string;
  /** Which lot, on an order with several (#586); ignored for a card that belongs to no order. */
  lotId: string;
  location: { locationId: string; locationRef: string };
  disposition: { inCollection: boolean; forSale: boolean; forTrade: boolean };
}

export type RunDetailField = keyof RunCopyDetails;

/** The fields in the order the step draws them. */
export const RUN_DETAIL_FIELDS: readonly RunDetailField[] = [
  "conditionId",
  "certificateStatusId",
  "formatId",
  "lotId",
  "location",
  "disposition",
];

/** A tile's own answers: only the fields it overrides are present. */
export type RunCopyOverrides = Partial<RunCopyDetails>;

/**
 * What one tile's copy is created with: **its own value wherever it has one, the shared value
 * everywhere else.**
 *
 * An override is the tile's for good — the shared value changing afterwards does not reach it, which
 * is the whole reason it is stored as a value and not as a difference. Presence decides, never
 * content: an override to *no certificate* is `""`, and reading an empty value as *not overridden*
 * would put the run's certificate back on the one piece that was said to have none.
 */
export function resolveRunCopyDetails(
  shared: RunCopyDetails,
  overrides: RunCopyOverrides | null | undefined
): RunCopyDetails {
  const own = overrides ?? {};
  const pick = <K extends RunDetailField>(field: K): RunCopyDetails[K] =>
    own[field] !== undefined ? (own[field] as RunCopyDetails[K]) : shared[field];
  return {
    conditionId: pick("conditionId"),
    certificateStatusId: pick("certificateStatusId"),
    formatId: pick("formatId"),
    lotId: pick("lotId"),
    location: pick("location"),
    disposition: pick("disposition"),
  };
}

/** The fields a tile overrides, in drawing order — what its row says it holds of its own. */
export function overriddenFields(overrides: RunCopyOverrides | null | undefined): RunDetailField[] {
  if (!overrides) return [];
  return RUN_DETAIL_FIELDS.filter((field) => overrides[field] !== undefined);
}

// ── The write's input ─────────────────────────────────────────────────────────────────────────────

/** One tile of a run: the stamp it takes, and the copy details it holds of its own. */
export interface IssueRunTile {
  tileId: string;
  /** Null is a tile left without a stamp — refused, since no copy is created from one. */
  stampId: string | null;
  overrides?: RunCopyOverrides | null;
}

export interface IssueRunIdentification {
  /** The checklist the run is built on (#1225). */
  checklistId: string;
  /** The answers given once for every tile. */
  shared: RunCopyDetails;
  /** The run, in the order the tiles were ticked — the order the copies are created and numbered in. */
  tiles: readonly IssueRunTile[];
}

// ── Catalogue values ─────────────────────────────────────────────────────────────────────────────

/** One catalogue price a run can record: a stamp at a condition × certificate (#593's subject). */
export interface RunPriceSubject {
  /** `catalogValueSubjectKey` — what a typed value is kept under. */
  key: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
}

/**
 * The prices a run can record, once each, in the order of the run.
 *
 * **Keyed on stamp × condition × certificate, never on the tile** — a catalogue price is a fact about
 * the stamp in that condition, so two tiles of one stamp in one condition are one figure, typed on
 * either. A tile with no stamp yet, or no condition to record against, has nothing to price. The
 * format is deliberately not in the key: the figure is the single's, as in #593.
 */
export function runPriceSubjects(
  assignments: readonly RunAssignment[],
  resolved: readonly RunCopyDetails[]
): RunPriceSubject[] {
  const seen = new Set<string>();
  const out: RunPriceSubject[] = [];
  for (const [i, a] of assignments.entries()) {
    const d = resolved[i];
    if (!a.stampId || !d?.conditionId) continue;
    const key = catalogValueSubjectKey(a.stampId, d.conditionId, d.certificateStatusId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      stampId: a.stampId,
      conditionId: d.conditionId,
      certificateStatusId: d.certificateStatusId || null,
    });
  }
  return out;
}

/** One line of the run's price list (#1223): a subject, and the tiles of the run it is the value for. */
export interface RunPriceLine extends RunPriceSubject {
  /** In the order they were ticked — the first is the one whose picture the line shows. */
  tileIds: string[];
}

/**
 * The run's catalogue values as **one list, typed down** (#1223): a line per subject — never per
 * tile, so Tab never visits one figure twice — in the order the set reads.
 *
 * **The set's order** is `stampOrder` — {@link runStampOrder}: the checklist's own order, then the
 * other stamps a tile was corrected to, as they are offered (#1225). The lines of one stamp follow
 * the order the collection lists its conditions in, and within a condition *no certificate* comes
 * before the certificates, in theirs. A stamp not in `stampOrder` (still being read) and a condition
 * or certificate not in its list keep the order of the run, after the ones that are.
 */
export function runPriceLines(
  assignments: readonly RunAssignment[],
  resolved: readonly RunCopyDetails[],
  stampOrder: readonly string[],
  conditionOrder: readonly string[],
  certificateOrder: readonly string[]
): RunPriceLine[] {
  const subjects = runPriceSubjects(assignments, resolved);
  const tilesByKey = new Map<string, string[]>();
  for (const [i, a] of assignments.entries()) {
    const d = resolved[i];
    if (!a.stampId || !d?.conditionId) continue;
    const key = catalogValueSubjectKey(a.stampId, d.conditionId, d.certificateStatusId);
    tilesByKey.set(key, [...(tilesByKey.get(key) ?? []), a.tileId]);
  }
  const rankIn = (order: ReadonlyMap<string, number>, id: string) =>
    order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const stampRank = new Map(stampOrder.map((id, i) => [id, i]));
  const conditionRank = new Map(conditionOrder.map((id, i) => [id, i]));
  // No certificate first, then the certificates in the collection's own order.
  const certificateRank = new Map(certificateOrder.map((id, i) => [id, i + 1]));
  const certificateRankOf = (id: string | null) => (id ? rankIn(certificateRank, id) : 0);
  return subjects
    .map((subject, runIndex) => ({ subject, runIndex }))
    .sort(
      (a, b) =>
        rankIn(stampRank, a.subject.stampId) - rankIn(stampRank, b.subject.stampId) ||
        rankIn(conditionRank, a.subject.conditionId) -
          rankIn(conditionRank, b.subject.conditionId) ||
        certificateRankOf(a.subject.certificateStatusId) -
          certificateRankOf(b.subject.certificateStatusId) ||
        a.runIndex - b.runIndex
    )
    .map(({ subject }) => ({ ...subject, tileIds: tilesByKey.get(subject.key) ?? [] }));
}

/**
 * Where Tab goes from a value of the price list (#1223): the next value, or with Shift the previous
 * one — and **off the last value, the confirm action**, never Cancel (#726's bug, met again here
 * because the footer draws Back before Identify). `null` leaves the key to the browser: Shift+Tab off
 * the first value, and Tab off the last while confirming is not possible and so cannot hold focus.
 */
export function priceListTabTarget(
  keys: readonly string[],
  from: string,
  shift: boolean,
  canConfirm: boolean
): { key: string } | "confirm" | null {
  const index = keys.indexOf(from);
  if (index === -1) return null;
  const next = shift ? index - 1 : index + 1;
  if (next >= keys.length) return canConfirm ? "confirm" : null;
  return next < 0 ? null : { key: keys[next] };
}

/**
 * The prices to write before the copies are created: one row per subject whose field says something
 * new, judged by #593's own `catalogValueEntry` — blank, an untouched prefill (compared as a number),
 * a field still loading and a stamp with no primary catalogue all write nothing.
 *
 * `valueOf` answers what the field for a subject holds, or null where there is no field.
 */
export function changedRunPrices(
  subjects: readonly RunPriceSubject[],
  valueOf: (key: string) => IntakeCatalogValue | null
): Array<{
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  entries: Array<{ catalogNameId: string; amount: string }>;
}> {
  const out = [];
  for (const subject of subjects) {
    const value = valueOf(subject.key);
    const entry = value ? catalogValueEntry(value) : null;
    if (!entry) continue;
    out.push({
      stampId: subject.stampId,
      conditionId: subject.conditionId,
      certificateStatusId: subject.certificateStatusId,
      entries: [entry],
    });
  }
  return out;
}
