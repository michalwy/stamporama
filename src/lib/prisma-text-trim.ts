// The database's own guard on the whitespace around typed text (#1357): every string a write
// carries is trimmed on the way in, whatever path it came by.
//
// **Pure.** No Prisma import — this walks plain values, and is unit-tested on them. `db.ts` hands
// it the arguments of every write through a Prisma client extension.
//
// ## Why here as well as in the field
//
// The field is where the collector sees the rule applied (`shared/text-input.tsx`), and it is the
// half that makes what is on screen match what is stored. It is not the half that can promise
// *every* field: a value also arrives from a form submitted before the field was ever blurred, from
// a CSV catalogue import, from a Colnect list, from the agent API. One place that every write
// passes is what makes "no field is left out" a fact rather than an intention, and with Prisma that
// place is a `query` extension over `$allModels`.
//
// ## What it walks, and what it refuses to
//
// Only the **write payload** — `data` for a create or an update, `create` and `update` for an
// upsert. Never `where`, `select`, `include`, `orderBy` or `cursor`: a read is the caller's
// question and this rule has no business rewriting it.
//
// Inside that payload it descends through **Prisma's own write operators** and nothing else. An
// object whose keys are all operators (`{ create: … }`, `{ upsert: { where, create, update } }`) is
// an instruction and is walked; an object with any other key is a **`Json` column's value** and is
// left exactly as it is. That is the whole reason for the operator test. The four `Json` columns in
// the schema — `AlbumPrintedPage.snapshot`, `PlatformCategoryLesson.value`,
// `Offer.allegroCategoryParameters`, `CollectionValueSnapshot.rates` — each hold an object of the
// app's own making, not text a collector typed, and one of them is a **printed sheet's snapshot**
// compared byte for byte against a freshly computed one by `album-divergence.ts`. Trimming a string
// inside it would report a card as diverged forever. `tests/unit/prisma-text-trim.test.ts` reads
// the schema and fails if that set of `Json` columns ever changes, so the reasoning is re-read
// rather than inherited.
//
// An **array under a column's name** is left alone for the same reason: it is either a `Json` array
// or one of the six `String[]` columns, all of which hold ids (`conditionIds`, `photoPlanOrder`,
// `setIds`, …). An id has no whitespace to remove, so nothing is lost by not looking.

import { trimTextInput } from "./text-input";

/** Keys that may appear in a relation write or an atomic scalar update. An object all of whose keys
 *  are on this list is an instruction to Prisma; anything else is a value. No column in the schema
 *  is named like one of these, which `prisma-text-trim.test.ts` checks. */
const OPERATOR_KEYS = new Set([
  "create",
  "createMany",
  "connectOrCreate",
  "connect",
  "disconnect",
  "delete",
  "deleteMany",
  "update",
  "updateMany",
  "upsert",
  "set",
  "push",
  "increment",
  "decrement",
  "multiply",
  "divide",
  "where",
  "data",
  "skipDuplicates",
]);

/** The operator keys whose value carries writable columns, and so is walked on. The rest name rows
 *  (`connect`, `delete`) or arithmetic, and carry nothing typed. */
const PAYLOAD_KEYS = new Set([
  "create",
  "createMany",
  "connectOrCreate",
  "update",
  "updateMany",
  "upsert",
  "data",
]);

type Dict = Record<string, unknown>;

/** A `{}` literal, as opposed to a `Date`, a `Decimal`, a `Buffer` or an array — each of which
 *  reaches a write as a value and must be passed through by reference. */
function isPlainObject(value: unknown): value is Dict {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True when every key is one of Prisma's write operators — the test that tells an instruction from
 *  a `Json` column's object. An empty object states nothing either way and is left alone. */
function isWriteInstruction(value: unknown): value is Dict {
  return (
    isPlainObject(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => OPERATOR_KEYS.has(key))
  );
}

/** Map over an object's entries, returning the original when no entry changed, so an untouched
 *  payload reaches Prisma as the very object the caller built. */
function mapEntries(node: Dict, fn: (key: string, value: unknown) => unknown): Dict {
  let changed = false;
  const out: Dict = {};
  for (const [key, value] of Object.entries(node)) {
    const next = fn(key, value);
    if (next !== value) changed = true;
    out[key] = next;
  }
  return changed ? out : node;
}

/** Map over an array, returning the original when no element changed. */
function mapItems(items: unknown[], fn: (item: unknown) => unknown): unknown[] {
  let changed = false;
  const out = items.map((item) => {
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}

/**
 * A map of column names to the values being written: trim the strings, walk on into nested writes,
 * and leave everything else exactly as it came.
 */
function trimColumns(node: unknown): unknown {
  if (!isPlainObject(node)) return node;
  return mapEntries(node, (_key, value) => {
    if (typeof value === "string") return trimTextInput(value);
    if (isWriteInstruction(value)) return trimInstruction(value);
    // A `Json` column's object or array, or a `String[]` of ids. Neither is typed prose.
    return value;
  });
}

/**
 * An object of Prisma write operators: walk on through the ones that carry columns. A string
 * directly under `set` or `push` is the long form of writing a scalar (`{ name: { set: " x " } }`),
 * so it is trimmed like the short form.
 */
function trimInstruction(node: Dict): Dict {
  return mapEntries(node, (key, value) => {
    if ((key === "set" || key === "push") && typeof value === "string") return trimTextInput(value);
    if (!PAYLOAD_KEYS.has(key)) return value;
    return trimPayload(value);
  });
}

/**
 * The value under a payload key. It is either a map of columns, another instruction — `update` on a
 * to-many relation is `{ where, data }`, `upsert` is `{ where, create, update }` — or a list of
 * either. The operator test is what tells the two apart.
 */
function trimPayload(value: unknown): unknown {
  if (Array.isArray(value)) return mapItems(value, trimPayload);
  if (isWriteInstruction(value)) return trimInstruction(value);
  return trimColumns(value);
}

/**
 * The write half of a Prisma operation's arguments, with the whitespace around every string it
 * carries removed. `where`, `select` and every other read-side key is returned untouched, and the
 * original object comes back by reference when nothing needed changing.
 */
export function trimWriteArgs(args: unknown): unknown {
  if (!isPlainObject(args)) return args;
  return mapEntries(args, (key, value) =>
    // `data` covers create/update/createMany/updateMany; `create` and `update` are upsert's own.
    key === "data" || key === "create" || key === "update" ? trimPayload(value) : value
  );
}

/** The Prisma operations that write. Everything else — a read, a count, a raw query — is passed
 *  through untouched, so this rule can never change the answer to a question. */
export const WRITING_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
