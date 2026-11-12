import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  checkPresetName,
  cleanListView,
  comparePresetNames,
  parseListView,
  parseRefs,
  referencedIds,
  refLabelKey,
  type ListKey,
  type ListView,
  type ListViewRefKind,
  type RefLabels,
} from "./list-views";

// Filter presets (#2487) — the database half. The view itself, and every rule about what it holds,
// is `list-views.ts`; this file stores it per collection and per list, and answers one question the
// browser cannot: which of the records a preset names are still in the collection.
//
// **The labels.** A preset naming a record deleted since applies without it and says so — and the
// record is gone, so its name has to have been kept: `labels` holds, at every save and update, the
// name each referenced record had then.

export class ListPresetNameTakenError extends Error {
  constructor() {
    super("A preset with this name already exists on this list.");
  }
}

export class ListPresetInvalidNameError extends Error {}

export interface ListPresetData {
  id: string;
  name: string;
  /** The view with every record that no longer exists taken out — what applying lays down. */
  view: ListView;
  /** A line per record taken out, for the note applying shows. */
  dropped: string[];
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The preset's collection, when the caller owns it. */
async function ownedPreset(ownerId: string, presetId: string) {
  const preset = await prisma.listPreset.findUnique({
    where: { id: presetId },
    select: { id: true, collectionId: true, list: true, collection: { select: { ownerId: true } } },
  });
  if (!preset || preset.collection.ownerId !== ownerId) {
    throw new Error("Preset not found or access denied.");
  }
  return preset;
}

/** An issue or a stamp can be nameless; the note then says only what kind of record went. */
type Named = { id: string; name: string | null };

/** The records of one kind among `ids` that still count — by id, with their names. */
async function lookUp(
  collectionId: string,
  kind: ListViewRefKind,
  ids: string[]
): Promise<Named[]> {
  const where = { collectionId, id: { in: ids } };
  const select = { id: true, name: true } as const;
  switch (kind) {
    case "area":
      return prisma.collectionArea.findMany({ where, select });
    case "tag":
      return prisma.tag.findMany({ where, select });
    case "platform":
      return prisma.platform.findMany({ where, select });
    case "offerPlatform":
      // A switched-off platform leaves the pickers (#1955), and the filters asking about offers on a
      // platform ignore it — so a preset naming one would narrow by nothing the list honours.
      return prisma.platform.findMany({ where: { ...where, enabled: true }, select });
    case "condition":
      return prisma.stampCondition.findMany({ where, select });
    case "format":
      return prisma.stampFormat.findMany({ where, select });
    case "subtype":
      return prisma.stampSubtype.findMany({ where, select });
    case "issueFormat":
      return prisma.stampIssueFormat.findMany({ where, select });
    case "color":
      return prisma.stampColor.findMany({ where, select });
    case "watermark":
      return prisma.stampWatermark.findMany({ where, select });
    case "paper":
      return prisma.stampPaper.findMany({ where, select });
    case "printing":
      return prisma.stampPrinting.findMany({ where, select });
    case "certificateStatus":
      return prisma.certificateStatus.findMany({ where, select });
    case "fault":
      return prisma.fault.findMany({ where, select });
    case "location":
      return prisma.location.findMany({ where, select });
    case "contact":
      return prisma.contact.findMany({ where, select });
    case "issue":
      return prisma.issue.findMany({ where, select });
    case "stamp":
      return prisma.stamp.findMany({ where, select });
    case "facebookGroup":
      return prisma.facebookGroup.findMany({ where: { ...where, archivedAt: null }, select });
    case "supply":
      return prisma.packingSupply.findMany({ where, select });
  }
}

async function lookUpAll(
  collectionId: string,
  wanted: Map<ListViewRefKind, Set<string>>
): Promise<Map<ListViewRefKind, Map<string, string | null>>> {
  const found = new Map<ListViewRefKind, Map<string, string | null>>();
  await Promise.all(
    [...wanted].map(async ([kind, ids]) => {
      const rows = await lookUp(collectionId, kind, [...ids]);
      found.set(kind, new Map(rows.map((r) => [r.id, r.name])));
    })
  );
  return found;
}

/** The names the referenced records have now — kept with the preset for the note. */
async function labelsFor(
  collectionId: string,
  view: ListView,
  refs: Record<string, ListViewRefKind>
): Promise<RefLabels> {
  const found = await lookUpAll(collectionId, referencedIds(view, refs));
  const labels: RefLabels = {};
  for (const [kind, names] of found) {
    for (const [id, name] of names) if (name) labels[refLabelKey(kind, id)] = name;
  }
  return labels;
}

function nameOrThrow(raw: string): string {
  const checked = checkPresetName(raw);
  if ("error" in checked) throw new ListPresetInvalidNameError(checked.error);
  return checked.name;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** One list's presets, by name, each with what applying it would drop. */
export async function listListPresets(
  ownerId: string,
  collectionId: string,
  list: ListKey
): Promise<ListPresetData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.listPreset.findMany({
    where: { collectionId, list },
    select: { id: true, name: true, view: true, refs: true, labels: true },
  });
  const parsed = rows.map((r) => ({
    id: r.id,
    name: r.name,
    view: parseListView(r.view),
    refs: parseRefs(r.refs),
    labels: (r.labels && typeof r.labels === "object" ? r.labels : {}) as RefLabels,
  }));
  const wanted = new Map<ListViewRefKind, Set<string>>();
  for (const p of parsed) {
    for (const [kind, ids] of referencedIds(p.view, p.refs)) {
      let set = wanted.get(kind);
      if (!set) wanted.set(kind, (set = new Set()));
      for (const id of ids) set.add(id);
    }
  }
  const found = await lookUpAll(collectionId, wanted);
  return parsed
    .map((p) => {
      const { view, dropped } = cleanListView(
        p.view,
        p.refs,
        (kind, id) => found.get(kind)?.has(id) ?? false,
        p.labels
      );
      return { id: p.id, name: p.name, view, dropped };
    })
    .sort((a, b) => comparePresetNames(a.name, b.name));
}

/** Saves the view as a new preset on the list. */
export async function createListPreset(
  ownerId: string,
  collectionId: string,
  list: ListKey,
  data: { name: string; view: unknown; refs: unknown }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const name = nameOrThrow(data.name);
  const view = parseListView(data.view);
  const refs = parseRefs(data.refs);
  const labels = await labelsFor(collectionId, view, refs);
  try {
    return await prisma.listPreset.create({
      data: {
        collectionId,
        list,
        name,
        view: view as unknown as Prisma.InputJsonValue,
        refs,
        labels,
      },
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ListPresetNameTakenError();
    throw err;
  }
}

/** Overwrites a preset's view with the one on screen (*Update*). */
export async function updateListPresetView(
  ownerId: string,
  presetId: string,
  data: { view: unknown; refs: unknown }
): Promise<void> {
  const preset = await ownedPreset(ownerId, presetId);
  const view = parseListView(data.view);
  const refs = parseRefs(data.refs);
  const labels = await labelsFor(preset.collectionId, view, refs);
  await prisma.listPreset.update({
    where: { id: presetId },
    data: { view: view as unknown as Prisma.InputJsonValue, refs, labels },
  });
}

export async function renameListPreset(
  ownerId: string,
  presetId: string,
  rawName: string
): Promise<void> {
  await ownedPreset(ownerId, presetId);
  const name = nameOrThrow(rawName);
  try {
    await prisma.listPreset.update({ where: { id: presetId }, data: { name } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ListPresetNameTakenError();
    throw err;
  }
}

export async function deleteListPreset(ownerId: string, presetId: string): Promise<void> {
  await ownedPreset(ownerId, presetId);
  await prisma.listPreset.delete({ where: { id: presetId } });
}
