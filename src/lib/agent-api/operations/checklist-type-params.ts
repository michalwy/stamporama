import { CHECKLIST_KINDS, isChecklistKind, type ChecklistKind } from "../../checklist-kind";
import { invalidRequest } from "../errors";
import { optionalBoolean, optionalString } from "../params";
import type { ParameterLocation, ParameterSpec, ParsedParams } from "../types";

// A checklist's type through the agent API (#1617, ADR-0031 §11): the two parameters every
// operation that takes or reads one shares, so an agent meets one spelling of each everywhere.
//
// The type is the app's `kind` under the word the collector's form shows — *Type: Standard or
// Specialised* — and `include_specialised` is the screens' switch stated per call. Its default is
// the app's: only standard checklists are listed, offered and counted. A read naming one checklist
// by id answers whatever its type.

/** What the type is for, said once so every description that mentions it says the same. */
export const CHECKLIST_TYPE_MEANING =
  "`standard` is a set collected in everyday work (a series perforated and imperforate as two checklists); `specialised` is a finer goal kept for album building or a specialised collection — every colour variant of one stamp, say — and is left out of every list, choice and count unless `include_specialised` is sent";

export function checklistTypeParameter(
  location: ParameterLocation,
  description: string
): ParameterSpec {
  return {
    name: "type",
    in: location,
    type: "string",
    required: false,
    values: CHECKLIST_KINDS,
    description,
  };
}

export const INCLUDE_SPECIALISED_PARAMETER: ParameterSpec = {
  name: "include_specialised",
  in: "query",
  type: "boolean",
  required: false,
  description:
    "true to take specialised checklists into account too — finer goals such as every colour variant of one stamp. Left out, only standard checklists are listed and counted, as the app shows them by default.",
};

/** The `type` sent, checked against the vocabulary. Null when none was sent. */
export function checklistTypeParam(params: ParsedParams): ChecklistKind | null {
  const value = optionalString(params, "type");
  if (value === null) return null;
  if (!isChecklistKind(value)) {
    throw invalidRequest(`"type" is "${value}"; send one of ${CHECKLIST_KINDS.join(", ")}.`);
  }
  return value;
}

/** `include_specialised` as sent, false when it was not. */
export function includeSpecialisedParam(params: ParsedParams): boolean {
  return optionalBoolean(params, "include_specialised") ?? false;
}
