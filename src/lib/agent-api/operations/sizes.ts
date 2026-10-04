import "server-only";
import { prisma } from "../../db";
import { compareCatalogSortKeys } from "../../catalog-sort-key";
import { stampSizeFields } from "../../stamp-attributes";
import { formatStampSize, type StampSizeFields } from "../../stamp-size";
import {
  applyStampSize,
  applyStampSizePreset,
  createStampSizePreset,
  getStampSizePresets,
  StampSizePresetPairTakenError,
  updateStampSizePreset,
  type StampSizePresetSubject,
} from "../../stamp-size-presets";
import { writeMeasuredStampSize } from "../../stamp-measured-size";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalBoolean, optionalString, requiredString, stringList } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import {
  parseAgentSizeMm,
  presetVocabularyEntry,
  sizeApply,
  sizePreset,
  stampSizeReading,
  type AgentSizeApply,
  type AgentSizePreset,
  type AgentStampSize,
  type SizeChecklist,
  type SizePresetRow,
} from "../size-reads";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import { loadStampLabels, resolveStampRefs, stampNoOf } from "./stamp-refs";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";
import { includeSpecialisedParam, INCLUDE_SPECIALISED_PARAMETER } from "./checklist-type-params";
import { shownChecklistWhere } from "../../checklist-kind";

// Stamp sizes and size presets (#1415): read a stamp's size and where it comes from, keep the
// collection's presets, set one stamp's size, and apply a preset or a typed size to an issue, a
// checklist or a list of stamps — so a size an assistant reads in a catalogue or a dealer's list is
// not retyped stamp by stamp.
//
// **Every write is the app's own**, and that is the whole of the safety argument: a preset is
// created and corrected by `stamp-size-presets.ts` under the Settings panel's rules (#804), one
// stamp is sized by `writeMeasuredStampSize` — the album editor's one-box write (#1309), whose
// *a stated size is never replaced silently* is a gate on the server — and an apply is
// `applyStampSizePreset` / `applyStampSize`, the dialog's write (#806), with its preview, its
// skip-by-default and its variant subtree. Nothing here decides which stamps a write reaches.
//
// **Deleting a preset is not offered** (#1415). It was not asked for and removing one is a decision
// better made on the screen; `tests/unit/agent-api-operation-boundary.test.ts` keeps
// `deleteStampSizePreset` out of every operation module.
//
// **Stamps are named by id or by catalogue number**, the number resolved through #1037's resolver and
// nothing else, and a number that does not name exactly one stamp is refused with its candidates.

/** How many stamps one call may name. A series is sized through its issue or checklist, not a list. */
export const MAX_NAMED_STAMPS = 100;

const STAMP_PARAMETER_DESCRIPTION =
  "The stamp: its id, its short number (`st 123`), or a catalogue number that names only it — `Mi 123a`, as `resolve_catalog_numbers` reads one. A number reaching several stamps is refused with their ids.";

// ── Presets ────────────────────────────────────────────────────────────────

async function loadPresets(context: OperationContext): Promise<SizePresetRow[]> {
  return getStampSizePresets(context.ownerId, context.collectionId);
}

export async function readSizePresets(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentSizePreset>> {
  const presets = await loadPresets(context);
  const window = parseListWindow(params);
  return listResponse(
    presets.slice(window.offset, window.offset + window.limit).map(sizePreset),
    presets.length,
    window
  );
}

export const listSizePresetsOperation: Operation = {
  name: "list_size_presets",
  method: "GET",
  path: "/size-presets",
  description:
    "The collection's stamp size presets — sizes the collector keeps so they can be put on many stamps at once — in the collector's own order. Call this before applying a size, to use a preset that already states it rather than typing the figures again.",
  writes: false,
  parameters: [],
  result: {
    kind: "list",
    description:
      "One row per preset: `widthMm` × `heightMm` in millimetres, an optional `name`, and `label`, the way the app writes it (`25 × 30 mm · Germania`). Two presets never state the same pair. A preset is copied onto stamps when applied, never referenced: nothing records which stamps were sized from which preset.",
  },
  handler: async (context, params) => readSizePresets(context, params),
};

function refuseTakenPair(existing: SizePresetRow): never {
  throw invalidRequest(
    `A ${sizePreset(existing).label} preset is already saved, and two presets never state the same pair. Use it — send its id "${existing.id}" as "preset" — or correct it with \`update_size_preset\`.`,
    [existing.id]
  );
}

const SIZE_FIGURE = (name: "width_mm" | "height_mm", required: boolean, what: string): ParameterSpec => ({
  name,
  in: "body",
  type: "string",
  required,
  description: `${what} in millimetres, to a tenth at most, as a string: "21.5".`,
});

export async function addSizePreset(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentSizePreset> {
  const widthMm = parseAgentSizeMm(requiredString(params, "width_mm"), "width_mm");
  const heightMm = parseAgentSizeMm(requiredString(params, "height_mm"), "height_mm");
  const presets = await loadPresets(context);
  const taken = presets.find((p) => p.widthMm === widthMm && p.heightMm === heightMm);
  if (taken) refuseTakenPair(taken);
  try {
    return sizePreset(
      await createStampSizePreset(context.ownerId, context.collectionId, {
        widthMm,
        heightMm,
        name: optionalString(params, "name"),
      })
    );
  } catch (err) {
    // Lost a race with the same pair saved since the check above.
    if (err instanceof StampSizePresetPairTakenError) {
      const now = (await loadPresets(context)).find(
        (p) => p.widthMm === widthMm && p.heightMm === heightMm
      );
      if (now) refuseTakenPair(now);
    }
    throw err;
  }
}

export const createSizePresetOperation: Operation = {
  name: "create_size_preset",
  method: "POST",
  path: "/size-presets",
  description:
    "Save a stamp size as a preset, so it can be applied to a series now and to another later. The pair is the preset's identity: a pair already saved is refused with the preset that states it. Saving a preset sizes no stamp — apply it with `apply_stamp_size`.",
  writes: true,
  parameters: [
    SIZE_FIGURE("width_mm", true, "The width"),
    SIZE_FIGURE("height_mm", true, "The height"),
    {
      name: "name",
      in: "body",
      type: "string",
      required: false,
      description: "What the collector would call it — `Germania`, `Definitives 1950`. Optional: a preset without one is named by its pair.",
    },
  ],
  result: { kind: "object", description: "The preset as saved, at the end of the collector's order." },
  handler: async (context, params) => addSizePreset(context, params),
};

export async function editSizePreset(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentSizePreset> {
  const presetId = requiredString(params, "preset_id");
  const presets = await loadPresets(context);
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) {
    throw notFound(
      `No size preset with id "${presetId}" is in this token's collection. Use \`list_size_presets\` to find the right id.`
    );
  }

  const width = optionalString(params, "width_mm");
  const height = optionalString(params, "height_mm");
  const name = optionalString(params, "name");
  const clearName = stringList(params, "clear").includes("name");
  if (name !== null && clearName) {
    throw invalidRequest('"name" is both sent and named in "clear". Send one or the other.');
  }
  if (width === null && height === null && name === null && !clearName) {
    throw invalidRequest('Nothing to change: send "width_mm", "height_mm", "name", or "clear": ["name"].');
  }

  const widthMm = width !== null ? parseAgentSizeMm(width, "width_mm") : preset.widthMm;
  const heightMm = height !== null ? parseAgentSizeMm(height, "height_mm") : preset.heightMm;
  const taken = presets.find((p) => p.id !== presetId && p.widthMm === widthMm && p.heightMm === heightMm);
  if (taken) refuseTakenPair(taken);

  try {
    // `updateStampSizePreset` writes the pair and the name together, so each is restated: what was
    // sent, or what is there.
    await updateStampSizePreset(context.ownerId, presetId, {
      widthMm,
      heightMm,
      name: clearName ? null : (name ?? preset.name),
    });
  } catch (err) {
    if (err instanceof StampSizePresetPairTakenError) {
      const now = (await loadPresets(context)).find(
        (p) => p.id !== presetId && p.widthMm === widthMm && p.heightMm === heightMm
      );
      if (now) refuseTakenPair(now);
    }
    throw err;
  }
  const updated = (await loadPresets(context)).find((p) => p.id === presetId);
  return sizePreset(updated ?? { ...preset, widthMm, heightMm });
}

export const updateSizePresetOperation: Operation = {
  name: "update_size_preset",
  method: "PATCH",
  path: "/size-presets/{preset_id}",
  description:
    "Correct a preset: its width, its height, its name, or any of them — only what is sent changes. Correcting a preset does not correct the stamps already sized from it; they keep the figures they were given, and applying the corrected preset with `overwrite` is what changes them. Presets cannot be deleted through this API.",
  writes: true,
  parameters: [
    {
      name: "preset_id",
      in: "path",
      type: "string",
      required: true,
      description: "The preset's id, from `list_size_presets`.",
    },
    SIZE_FIGURE("width_mm", false, "The corrected width"),
    SIZE_FIGURE("height_mm", false, "The corrected height"),
    {
      name: "name",
      in: "body",
      type: "string",
      required: false,
      description: "The preset's new name.",
    },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: 'Send ["name"] to take the name off, so the preset is named by its pair again.',
      values: ["name"],
    },
  ],
  result: { kind: "object", description: "The preset as it now stands." },
  handler: async (context, params) => editSizePreset(context, params),
};

// ── One stamp ──────────────────────────────────────────────────────────────

export async function readStampSize(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentStampSize> {
  const [stampId] = await resolveStampRefs(context, [requiredString(params, "stamp")], "stamp");
  const [header, stamp, checklists] = await Promise.all([
    loadCollectionHeader(context),
    prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { widthMm: true, heightMm: true } }),
    prisma.checklist.findMany({
      where: {
        collectionId: context.collectionId,
        stamps: { some: { stampId } },
        // The stamp's specialised checklists only when asked (#1617), as everywhere a read names them.
        ...shownChecklistWhere(includeSpecialisedParam(params)),
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        stamps: {
          select: {
            stamp: {
              select: { id: true, widthMm: true, heightMm: true, primaryCatalogSortKey: true },
            },
          },
        },
      },
    }),
  ]);

  // In catalog sort order, which is the press run — `album-plan.ts`'s own ordering, so this reads
  // the figure an album page built from that checklist draws.
  const sizeChecklists: SizeChecklist[] = checklists.map((checklist) => ({
    checklistId: checklist.id,
    name: checklist.name,
    kind: checklist.kind,
    entries: checklist.stamps
      .map((entry) => entry.stamp)
      .sort(
        (a, b) =>
          compareCatalogSortKeys(a.primaryCatalogSortKey, b.primaryCatalogSortKey) ||
          a.id.localeCompare(b.id)
      )
      .map((row) => ({ stampId: row.id, ...stampSizeFields(row) })),
  }));
  const own = stampSizeFields(stamp);

  // Twice, cheaply: the first pass says which neighbours lend a figure, so only their numbers are read.
  const draft = stampSizeReading(
    { stampId, stampNo: 0, catalogNumbers: [], name: null, path: "" },
    own,
    sizeChecklists,
    () => undefined
  );
  const lenders = (draft.inherited ?? []).map((row) => row.fromStampId);
  const labels = await loadStampLabels(context, [stampId, ...lenders]);
  const self = labels.get(stampId);
  return stampSizeReading(
    {
      stampId,
      stampNo: stampNoOf(labels, stampId),
      catalogNumbers: self?.catalogNumbers ?? [],
      name: self?.name ?? null,
      path: collectionPath(header, `/stamps/${stampId}`),
    },
    own,
    sizeChecklists,
    (id) => labels.get(id)?.catalogNumbers[0]
  );
}

export const getStampSizeOperation: Operation = {
  name: "get_stamp_size",
  method: "GET",
  path: "/stamp-size",
  description:
    "One stamp's size and where it comes from: stated on the stamp itself, or inherited — borrowed at read time from the nearest stamp on the same checklist that states one, which is what an album page draws for it. Call this before setting a size, or to tell the collector which sizes are only borrowed.",
  writes: false,
  parameters: [
    { name: "stamp", in: "query", type: "string", required: true, description: STAMP_PARAMETER_DESCRIPTION },
    INCLUDE_SPECIALISED_PARAMETER,
  ],
  result: {
    kind: "object",
    description:
      "Only the stamp's standard checklists are read for an inherited figure unless `include_specialised` is sent; each `inherited` row states its `checklistType`. `source` is `stated` when the stamp states both figures itself, `inherited` when it does not and a checklist it is on lends one, and `none` otherwise. `widthMm` / `heightMm` are always the stamp's **own** figures, and either may stand alone: half a size is not a size, so a stamp stating only a width is `inherited` or `none`. `inherited` has one row per checklist that lends a figure — a stamp on two checklists can borrow two — naming the stamp it is borrowed from. An inherited figure is nobody's measurement; setting the stamp's own size ends the borrowing. Nothing records whether a stated size was measured, typed or applied from a preset.",
  },
  handler: async (context, params) => readStampSize(context, params),
};

export async function writeStampSize(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  status: "written" | "unchanged";
  stampId: string;
  stampNo: number;
  catalogNumbers: string[];
  widthMm: number;
  heightMm: number;
  replaced?: { widthMm?: number; heightMm?: number };
}> {
  const [stampId] = await resolveStampRefs(context, [requiredString(params, "stamp")], "stamp");
  const size = {
    widthMm: parseAgentSizeMm(requiredString(params, "width_mm"), "width_mm"),
    heightMm: parseAgentSizeMm(requiredString(params, "height_mm"), "height_mm"),
  };
  const overwrite = optionalBoolean(params, "overwrite") ?? false;
  const before = stampSizeFields(
    await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { widthMm: true, heightMm: true } })
  );

  const result = await writeMeasuredStampSize(context.ownerId, stampId, size, overwrite);
  if (result.status === "confirm") throw refuseStated(result.current, "stamp");

  const labels = await loadStampLabels(context, [stampId]);
  const hadSize = before.widthMm !== null || before.heightMm !== null;
  return {
    status: result.status === "saved" ? "written" : "unchanged",
    stampId,
    stampNo: stampNoOf(labels, stampId),
    catalogNumbers: labels.get(stampId)?.catalogNumbers ?? [],
    widthMm: result.size.widthMm,
    heightMm: result.size.heightMm,
    ...(result.status === "saved" && hadSize ? { replaced: ownFigures(before) } : {}),
  };
}

function ownFigures(fields: StampSizeFields): { widthMm?: number; heightMm?: number } {
  return {
    ...(fields.widthMm !== null ? { widthMm: fields.widthMm } : {}),
    ...(fields.heightMm !== null ? { heightMm: fields.heightMm } : {}),
  };
}

function refuseStated(current: StampSizeFields, parameter: string) {
  return invalidRequest(
    `This ${parameter} already states ${formatStampSize(current) ?? "a size"}, and a stated size may be a careful measurement, so it is never replaced silently: nothing was written. If the collector wants it replaced, call again with "overwrite": true.`
  );
}

export const setStampSizeOperation: Operation = {
  name: "set_stamp_size",
  method: "POST",
  path: "/stamp-size",
  description:
    "Set one stamp's size — both figures, in millimetres — the way the album editor sets one box's. A stamp that already states a different size, whole or half, is refused unless `overwrite` is sent: a stated size may be a measurement. Only this stamp is written, not its variants; to size a series, or a stamp with its variants, use `apply_stamp_size`.",
  writes: true,
  parameters: [
    { name: "stamp", in: "body", type: "string", required: true, description: STAMP_PARAMETER_DESCRIPTION },
    SIZE_FIGURE("width_mm", true, "The width"),
    SIZE_FIGURE("height_mm", true, "The height"),
    {
      name: "overwrite",
      in: "body",
      type: "boolean",
      required: false,
      description:
        "Replace a size the stamp already states. Defaults to false; send true only when the collector has said the stated figure is wrong.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`status` is `written`, or `unchanged` when the stamp already stated exactly this. `replaced` carries the figures a write replaced. The size is stored as an ordinary stated size.",
  },
  handler: async (context, params) => writeStampSize(context, params),
};

// ── Applying to many ───────────────────────────────────────────────────────

async function applyFromParams(
  context: OperationContext,
  params: ParsedParams,
  preview: boolean
): Promise<AgentSizeApply> {
  // The subject: exactly one of the three.
  const issueId = optionalString(params, "issue_id");
  const checklistId = optionalString(params, "checklist_id");
  const stampRefs = stringList(params, "stamps");
  const named = [issueId !== null, checklistId !== null, stampRefs.length > 0].filter(Boolean).length;
  if (named !== 1) {
    throw invalidRequest(
      'Name exactly one set of stamps: "issue_id", "checklist_id", or "stamps".',
      ["issue_id", "checklist_id", "stamps"]
    );
  }

  // The size: a preset, or both figures.
  const presetRef = optionalString(params, "preset");
  const width = optionalString(params, "width_mm");
  const height = optionalString(params, "height_mm");
  if (presetRef !== null ? width !== null || height !== null : width === null || height === null) {
    throw invalidRequest(
      'Name the size one way: "preset", or both "width_mm" and "height_mm".',
      ["preset", "width_mm", "height_mm"]
    );
  }
  const overwrite = optionalBoolean(params, "overwrite") ?? false;

  let subject: StampSizePresetSubject;
  if (issueId !== null) {
    const issue = await prisma.issue.findFirst({
      where: { id: issueId, collectionId: context.collectionId },
      select: { id: true },
    });
    if (!issue) {
      throw notFound(
        `No issue with id "${issueId}" is in this token's collection. Use \`search_collection\` or \`get_stamp\` to find the right id.`
      );
    }
    subject = { kind: "issue", issueId };
  } else if (checklistId !== null) {
    const checklist = await prisma.checklist.findFirst({
      where: { id: checklistId, collectionId: context.collectionId },
      select: { id: true },
    });
    if (!checklist) {
      throw notFound(
        `No checklist with id "${checklistId}" is in this token's collection. \`get_issue\` lists an issue's checklists with their ids.`
      );
    }
    subject = { kind: "checklist", checklistId };
  } else {
    if (stampRefs.length > MAX_NAMED_STAMPS) {
      throw invalidRequest(
        `"stamps" names ${stampRefs.length} stamps and at most ${MAX_NAMED_STAMPS} are taken in one call. Size a whole series through its "issue_id" or "checklist_id", or split the list.`
      );
    }
    subject = { kind: "stamps", stampIds: await resolveStampRefs(context, stampRefs, "stamps") };
  }

  if (presetRef !== null) {
    const presets = await loadPresets(context);
    const presetId = resolveVocabularyValue(presetRef, presets.map(presetVocabularyEntry), {
      vocabulary: "size preset",
      parameter: "preset",
    });
    const preset = presets.find((p) => p.id === presetId)!;
    const result = await applyStampSizePreset(context.ownerId, {
      presetId,
      subject,
      overwriteStated: overwrite,
      preview,
    });
    return sizeApply(result, { overwrite, preview, preset: sizePreset(preset).label });
  }

  const result = await applyStampSize(context.ownerId, {
    collectionId: context.collectionId,
    widthMm: parseAgentSizeMm(width!, "width_mm"),
    heightMm: parseAgentSizeMm(height!, "height_mm"),
    subject,
    overwriteStated: overwrite,
    preview,
  });
  return sizeApply(result, { overwrite, preview });
}

/** The apply's parameters, declared once and placed in the query for the preview, the body for the write. */
function applyParameters(where: "query" | "body"): ParameterSpec[] {
  return [
    {
      name: "preset",
      in: where,
      type: "string",
      required: false,
      description:
        "The size, as a preset: its id, its name, or its pair as `list_size_presets` labels it. Send this or both `width_mm` and `height_mm`.",
    },
    { ...SIZE_FIGURE("width_mm", false, "The size's width, when no preset is named,"), in: where },
    { ...SIZE_FIGURE("height_mm", false, "The size's height, when no preset is named,"), in: where },
    {
      name: "issue_id",
      in: where,
      type: "string",
      required: false,
      description: "Size every stamp filed under this issue. Name one of `issue_id`, `checklist_id` or `stamps`.",
    },
    {
      name: "checklist_id",
      in: where,
      type: "string",
      required: false,
      description: "Size every stamp on this checklist; `get_issue` lists an issue's checklists.",
    },
    {
      name: "stamps",
      in: where,
      type: "string[]",
      required: false,
      description: `Size these stamps, each an id, a short number (\`st 123\`) or a catalogue number naming only it — at most ${MAX_NAMED_STAMPS}. Every entry must resolve to one stamp or nothing is done.${where === "query" ? " Repeat the parameter once per stamp, since a comma separates entries." : ""}`,
    },
    {
      name: "overwrite",
      in: where,
      type: "boolean",
      required: false,
      description:
        "Also replace sizes stamps already state. Defaults to false, which writes only to stamps stating no figure at all; send true only when the collector has said to.",
    },
  ];
}

const APPLY_REACH =
  "The set reaches the named stamps and every variant under them at any depth, as the app's apply dialog does.";

export const previewStampSizeApplyOperation: Operation = {
  name: "preview_stamp_size_apply",
  method: "GET",
  path: "/stamp-sizes/apply",
  description: `Say what \`apply_stamp_size\` would do, writing nothing: how many stamps have no size and would take this one, and how many already state one and would be left alone — or replaced, with \`overwrite\`. ${APPLY_REACH} Call it first and tell the collector the counts before applying.`,
  writes: false,
  parameters: applyParameters("query"),
  result: {
    kind: "object",
    description:
      "`total` stamps reached: `withoutSize` state no figure, `withStatedSize` state at least one (`withPartialSize` of them only one). `willWrite` is how many the apply would write. `summary` is the app's own sentences for it.",
  },
  handler: async (context, params) => applyFromParams(context, params, true),
};

export const applyStampSizeOperation: Operation = {
  name: "apply_stamp_size",
  method: "POST",
  path: "/stamp-sizes/apply",
  description: `Put one size — a preset, or a width and height — on an issue, a checklist or a list of stamps. ${APPLY_REACH} Stamps that already state a size, whole or half, are left alone unless \`overwrite\` is sent. The figures are copied: correcting the preset later does not change these stamps. Run \`preview_stamp_size_apply\` with the same parameters first.`,
  writes: true,
  parameters: applyParameters("body"),
  result: {
    kind: "object",
    description:
      "The counts as they stood at the write, and `written`, the rows actually written — the preview's `willWrite` unless the stamps changed in between. `summary` is the app's own sentences.",
  },
  handler: async (context, params) => applyFromParams(context, params, false),
};
