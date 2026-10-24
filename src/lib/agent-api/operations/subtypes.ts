import "server-only";
import { prisma } from "../../db";
import { createStampSubtype, updateStampSubtype } from "../../subtypes";
import { invalidRequest } from "../errors";
import { optionalBoolean, requiredString } from "../params";
import { resolveVocabularyValue, type SubtypeVocabularyEntry } from "../vocabulary";
import type { Operation, OperationContext, ParsedParams } from "../types";

// The subtype dictionary (#2139): add a subtype and correct its name, so an assistant entering a
// specialised catalogue can name a kind of variant the collection has no subtype for yet without
// stopping to ask the collector to add it in Settings.
//
// **Every write is the Settings panel's own** — `createStampSubtype` and `updateStampSubtype` — and a
// new subtype is at the end of the collector's order and never the default, as the panel adds one.
// What this module adds is the one rule an agent needs and the panel leaves to the eye: **a name the
// collection already has is refused**, compared as the vocabulary resolver compares names, so a
// subtype added here is always one `add_stamp_variants` and `update_stamp` can name unambiguously.
//
// **Deleting, reordering, choosing the default and flipping *acts as variant* stay in Settings**
// (#2139): each changes how stamps already classified are valued or created, which is a decision for
// the screen. A new subtype's *acts as variant* is set once, at creation, as the panel's add form
// sets it. `tests/unit/agent-api-operation-boundary.test.ts` keeps those writes out of every
// operation module. Translated names are the translation operations' (#1452).

/** A subtype as `subtypes` in `get_collection_vocabulary` gives it, less the translated label. */
async function subtypeById(context: OperationContext, subtypeId: string): Promise<SubtypeVocabularyEntry> {
  const row = await prisma.stampSubtype.findFirstOrThrow({
    where: { id: subtypeId, collectionId: context.collectionId },
    select: { id: true, name: true, actsAsVariant: true, isDefault: true },
  });
  return { id: row.id, name: row.name, actsAsVariant: row.actsAsVariant, isDefault: row.isDefault };
}

async function loadSubtypes(context: OperationContext) {
  return prisma.stampSubtype.findMany({
    where: { collectionId: context.collectionId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Refuse a name another subtype of the collection already has. Case and the spaces around it do not
 * make a name new, because they do not to the resolver: two subtypes both answering to `perforation`
 * would make every later call naming either of them ambiguous.
 */
function assertSubtypeNameFree(
  subtypes: readonly { id: string; name: string }[],
  name: string,
  exceptId?: string
): void {
  const wanted = name.trim().toLocaleLowerCase();
  const holder = subtypes.find((row) => row.id !== exceptId && row.name.trim().toLocaleLowerCase() === wanted);
  if (holder) {
    throw invalidRequest(
      `This collection already has a subtype named "${holder.name}" (id "${holder.id}"). Use it, or choose another name.`,
      [holder.id]
    );
  }
}

export async function addSubtype(context: OperationContext, params: ParsedParams): Promise<SubtypeVocabularyEntry> {
  const name = requiredString(params, "name");
  assertSubtypeNameFree(await loadSubtypes(context), name);
  // The panel's add form ticks *acts as variant* until the collector unticks it.
  const actsAsVariant = optionalBoolean(params, "acts_as_variant") ?? true;
  const id = await createStampSubtype(context.ownerId, context.collectionId, { name, actsAsVariant });
  return subtypeById(context, id);
}

export const createSubtypeOperation: Operation = {
  name: "create_subtype",
  method: "POST",
  path: "/subtypes",
  description:
    "Add a subtype — a kind of variant, such as a shade, a perforation variety or a plate flaw — to the collection, as the Settings panel adds one: at the end of the collector's order and never the default. It can be named at once by `add_stamp_variants` and `update_stamp`. A name the collection already has, whatever its case, is refused with that subtype. Check `subtypes` in `get_collection_vocabulary` first.",
  writes: true,
  parameters: [
    {
      name: "name",
      in: "body",
      type: "string",
      required: true,
      description: "The subtype's name in the collection's own language — `Colour variety`, `Plate flaw`. Unique in the collection.",
    },
    {
      name: "acts_as_variant",
      in: "body",
      type: "boolean",
      required: false,
      description:
        "Whether a stamp of this subtype is a variant of its base stamp: its base stamp then becomes an umbrella valued at its lowest variant, and owning any variant completes it. false for an entry of its own under a stamp — an error, a plate flaw, a forgery. Defaults to true, as the panel's add form does; afterwards only the collector changes it, in Settings.",
    },
  ],
  result: {
    kind: "object",
    description: "The new subtype as `subtypes` in `get_collection_vocabulary` gives it: `id`, `name`, `actsAsVariant` and `isDefault`.",
  },
  handler: async (context, params) => addSubtype(context, params),
};

export async function editSubtype(context: OperationContext, params: ParsedParams): Promise<SubtypeVocabularyEntry> {
  const subtypes = await loadSubtypes(context);
  const subtypeId = resolveVocabularyValue(requiredString(params, "subtype_id"), subtypes, {
    vocabulary: "subtype",
    parameter: "subtype_id",
  });
  const name = requiredString(params, "name");
  assertSubtypeNameFree(subtypes, name, subtypeId);
  // Translations are left as they are: `updateStampSubtype` rewrites only the languages it is handed.
  await updateStampSubtype(context.ownerId, subtypeId, { name });
  return subtypeById(context, subtypeId);
}

export const updateSubtypeOperation: Operation = {
  name: "update_subtype",
  method: "PATCH",
  path: "/subtypes/{subtype_id}",
  description:
    "Correct a subtype's name, as the Settings panel does. Every stamp of the subtype keeps it and reads under the new name. A name another subtype already has, whatever its case, is refused with that subtype. Its translated names are `set_translations`'; deleting, reordering, choosing the default and whether it acts as a variant stay with the collector, in Settings.",
  writes: true,
  parameters: [
    {
      name: "subtype_id",
      in: "path",
      type: "string",
      required: true,
      description: "The subtype, by its id from `subtypes` in `get_collection_vocabulary` or by its current name.",
    },
    {
      name: "name",
      in: "body",
      type: "string",
      required: true,
      description: "The subtype's corrected name in the collection's own language.",
    },
  ],
  result: {
    kind: "object",
    description: "The subtype as it now stands, in the shape `subtypes` in `get_collection_vocabulary` gives it.",
  },
  handler: async (context, params) => editSubtype(context, params),
};
