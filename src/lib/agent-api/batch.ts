// The pure half every batch form of a single write shares (#2173, #2174, #2175): how many items one
// call carries, how one item is spelled, and the answer each item gets.
//
// **A batch is the single call said many times, and nothing more.** `set_stamp_colnect_ids`,
// `update_stamps` and `create_issues` each apply their single operation's rules to every item, in
// the order sent, and **one refused item never stops the others** (#1540's rule for price cells,
// #2149's for conversation entries). So an item is answered on its own — by its `index`, its place in
// the list, 0-based — with the single call's own answer, or `refused` with the sentence the single
// call would have refused it with, and the ids that sentence names in `accepted`.
//
// **An item is one string**, because a parameter on this surface is a scalar or a string list and
// nothing richer (#706). A short item is `name=value` pairs separated by `;`, as a price cell is
// (`stamp=Mi 309AP; colnect_id=1133075`); an issue is a field per line, as a conversation entry is,
// since an issue carries several lists and a catalogue's numbers carry commas of their own.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { invalidRequest, isApiError } from "./errors";
import type { ParameterSpec } from "./types";

/** Refuse a batch that carries nothing, or more than one call takes. */
export function checkBatchSize(
  entries: readonly string[],
  parameter: string,
  max: number,
  noun: string,
  example: string
): void {
  if (entries.length === 0) {
    throw invalidRequest(`"${parameter}" must carry at least one ${noun}, such as ${example}.`);
  }
  if (entries.length > max) {
    throw invalidRequest(
      `"${parameter}" carries ${entries.length} ${noun}s; one call takes at most ${max}. Send the rest in a second call.`
    );
  }
}

/**
 * One item's `name=value` pairs, separated by `;`, or the reason it is not one. Each pair is split on
 * its first `=`, so a value — a Colnect address — may carry one of its own.
 */
export function parsePairFields<F extends string>(
  entry: string,
  fields: readonly F[],
  example: string
): { ok: true; fields: Map<F, string> } | { ok: false; reason: string } {
  const out = new Map<F, string>();
  for (const part of entry.split(";")) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    const name = eq < 0 ? "" : part.slice(0, eq).trim().toLocaleLowerCase();
    const value = eq < 0 ? "" : part.slice(eq + 1).trim();
    if (!name || !value) {
      return { ok: false, reason: `"${part.trim()}" is not \`name=value\`. Write it as ${example}.` };
    }
    if (!(fields as readonly string[]).includes(name)) {
      return { ok: false, reason: `"${name}" is not a field here; an entry takes ${fields.join(" and ")}. Write it as ${example}.` };
    }
    if (out.has(name as F)) return { ok: false, reason: `The entry names "${name}" twice.` };
    out.set(name as F, value);
  }
  const missing = fields.filter((name) => !out.has(name));
  if (missing.length > 0) {
    return { ok: false, reason: `The entry has no ${missing.join(" and no ")}. Write it as ${example}.` };
  }
  return { ok: true, fields: out };
}

/**
 * One item written a field per line, `name=value`, as the body its single operation takes: a field
 * the operation declares as a list is repeated, a line each, and every other field is named once.
 * The values stay text — the single operation's own parser types and checks them, so an item means
 * exactly what the same fields sent to that operation mean.
 */
export function parseLineFields(
  entry: string,
  specs: readonly ParameterSpec[],
  example: string
): { ok: true; body: Record<string, string | string[]> } | { ok: false; reason: string } {
  const lists = new Set(specs.filter((spec) => spec.type === "string[]").map((spec) => spec.name));
  const names = new Set(specs.filter((spec) => spec.in === "body").map((spec) => spec.name));
  const body: Record<string, string | string[]> = {};
  for (const line of entry.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const eq = line.indexOf("=");
    const name = eq < 0 ? "" : line.slice(0, eq).trim().toLocaleLowerCase();
    const value = eq < 0 ? "" : line.slice(eq + 1).trim();
    if (!names.has(name)) {
      return {
        ok: false,
        reason: `"${line.trim()}" does not start with a field. A line is \`name=value\`, the name one of ${[...names].join(", ")} — ${example}.`,
      };
    }
    if (!value) return { ok: false, reason: `"${name}" is given no value. Leave the line out instead.` };
    if (lists.has(name)) {
      body[name] = [...((body[name] as string[] | undefined) ?? []), value];
    } else if (name in body) {
      return {
        ok: false,
        reason: `The entry names "${name}" twice; it takes one value. Only ${[...lists].join(", ")} are repeated, a line each.`,
      };
    } else {
      body[name] = value;
    }
  }
  return { ok: true, body };
}

/** An item the batch could not apply, and why. */
export interface BatchRefusal {
  readonly index: number;
  readonly status: "refused";
  readonly reason: string;
  /** The ids or values the reason names, where the single call would have handed them back. */
  readonly accepted?: readonly string[];
}

export function refused(index: number, reason: string, accepted?: readonly string[]): BatchRefusal {
  return { index, status: "refused", reason, ...(accepted && accepted.length > 0 ? { accepted } : {}) };
}

/**
 * The refusal the single call would have answered with, for an `ApiError` it threw. Anything else is
 * a defect and its message is not relayed (`errorResponseBody`'s rule): the item is refused with a
 * sentence the agent can act on, and the caller logs the error. Earlier items are already written,
 * so failing the whole call would hide what was.
 */
export function refusalOf(index: number, err: unknown): BatchRefusal {
  if (isApiError(err)) return refused(index, err.message, err.accepted);
  return refused(
    index,
    "It failed inside Stamporama and nothing of it was written. Send it again alone with the single operation; if that fails too, report it."
  );
}

/** How many answers carry each status — every status named, so a zero is stated rather than absent. */
export function countStatuses<S extends string>(
  answers: readonly { readonly status: string }[],
  statuses: readonly S[]
): Record<S, number> {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<S, number>;
  for (const answer of answers) {
    if (answer.status in counts) counts[answer.status as S] += 1;
  }
  return counts;
}
