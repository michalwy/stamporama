"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getColnectListMappings,
  setColnectListMapping,
  ColnectListMappingValueError,
  type ColnectListMappingData,
} from "@/lib/colnect-list-sync";
import {
  ColnectReportValueError,
  getColnectReportLists,
  setColnectReportDone,
  setColnectReportIgnored,
  type ColnectReportList,
} from "@/lib/colnect-list-report";
import {
  ColnectAdoptError,
  applyColnectAdoption,
  applyColnectAdoptionForRow,
  previewColnectAdoption,
  type ColnectAdoptPass,
} from "@/lib/colnect-list-adopt";
import type { ColnectReportFilters } from "@/lib/colnect-list-report";
import {
  ColnectApplyError,
  getColnectApplyWorklist,
  type ColnectApplyWorklist,
} from "@/lib/colnect-list-apply";
import {
  ColnectLocalFixError,
  applyColnectLocalFix,
  previewColnectLocalFix,
  type ColnectLocalFixPreview,
} from "@/lib/colnect-list-fix";
import type {
  ColnectListSource,
  ColnectListSourceOfTruth,
  ColnectLocalFix,
} from "@/lib/colnect-list-sync-rules";
import {
  createColnectMapping,
  updateColnectMapping,
  deleteColnectMapping,
  getColnectMappings,
  getColnectConditionMappings,
  setColnectConditionMapping,
  getColnectPlatform,
  listPlatformContacts,
  setColnectPlatform,
  ColnectAbbrevTakenError,
  ColnectConditionValueError,
  type ColnectMappingData,
  type ColnectConditionMappingData,
} from "@/lib/colnect";

export type ColnectActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getColnectMappingsAction(
  collectionId: string
): Promise<ColnectMappingData[]> {
  const session = await getSession();
  return getColnectMappings(session.user.id, collectionId);
}

/** Every condition with the Colnect grade it maps to (#404), for the Settings panel. */
export async function getColnectConditionMappingsAction(
  collectionId: string
): Promise<ColnectConditionMappingData[]> {
  const session = await getSession();
  return getColnectConditionMappings(session.user.id, collectionId);
}

/**
 * Map one condition to a Colnect grade, or unmap it with an empty value (#404). One condition at a
 * time, because the panel's control *is* one select per row — there is no draft to save.
 */
export async function setColnectConditionMappingAction(
  stampConditionId: string,
  colnectValue: string
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectConditionMapping(session.user.id, stampConditionId, colnectValue || null);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectConditionValueError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to save the condition mapping. Please try again." };
  }
}

/** The platform contact marked as Colnect (#406), and every platform that could be — the picker
 *  reads both at once, since a picker showing only the current answer cannot change it. */
export async function getColnectPlatformAction(collectionId: string): Promise<{
  selectedId: string | null;
  platforms: { id: string; name: string }[];
}> {
  const session = await getSession();
  const [selected, platforms] = await Promise.all([
    getColnectPlatform(session.user.id, collectionId),
    listPlatformContacts(session.user.id, collectionId),
  ]);
  return { selectedId: selected?.id ?? null, platforms };
}

/**
 * Point the Colnect settings at one platform contact, or clear it with an empty id (#406). One
 * write per change, like the condition mapping beside it: the select *is* the control. Exclusive —
 * the domain layer clears whoever held it, so this can never leave two.
 */
export async function setColnectPlatformAction(
  collectionId: string,
  contactId: string
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectPlatform(session.user.id, collectionId, contactId || null);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the Colnect platform. Please try again." };
  }
}

/** Every standard Colnect list with what it mirrors (#684), for the Settings panel — all four,
 *  configured or not, since the set is fixed and the screen lists it whole. */
export async function getColnectListMappingsAction(
  collectionId: string
): Promise<ColnectListMappingData[]> {
  const session = await getSession();
  return getColnectListMappings(session.user.id, collectionId);
}

/**
 * Configure one Colnect list (#684). One list and one field at a time, the condition mapping's
 * idiom beside it: each control on the panel *is* the write, so there is no draft to lose and no
 * way for a change to one field to carry a stale opinion about another.
 */
export async function setColnectListMappingAction(
  collectionId: string,
  lt: number,
  patch: {
    source?: ColnectListSource;
    sourceOfTruth?: ColnectListSourceOfTruth;
    enabled?: boolean;
  }
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectListMapping(session.user.id, collectionId, lt, patch);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectListMappingValueError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to save the list setting. Please try again." };
  }
}

/** Every Colnect list this collection syncs, with the export its side of the report comes from
 *  (#686) — the selector and the header read it together, since a list with no import yet has a
 *  screen to draw and no report. */
export async function getColnectReportListsAction(
  collectionId: string
): Promise<ColnectReportList[]> {
  const session = await getSession();
  return getColnectReportLists(session.user.id, collectionId);
}

/**
 * Claim one difference already fixed on Colnect, or take the claim back (#686).
 *
 * Hidden until the next import and no longer: the app never talks to Colnect, so this is a claim
 * about the other side's state and only a fresh export can check it.
 */
export async function setColnectReportDoneAction(
  collectionId: string,
  lt: number,
  colnectId: string,
  kind: string,
  done: boolean
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectReportDone(session.user.id, collectionId, lt, colnectId, kind, done);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectReportValueError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to mark that row. Please try again." };
  }
}

/**
 * Accept one difference as a standing divergence, or withdraw the acceptance (#686).
 *
 * Hangs off the mapping, so it outlives every import: a judgement about this collection does not
 * expire because a file was read again.
 */
export async function setColnectReportIgnoredAction(
  collectionId: string,
  lt: number,
  colnectId: string,
  kind: string,
  ignored: boolean,
  note?: string | null
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectReportIgnored(
      session.user.id,
      collectionId,
      lt,
      colnectId,
      kind,
      ignored,
      note
    );
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectReportValueError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to save that decision. Please try again." };
  }
}

/**
 * What a local-side fix would touch, before it touches it (#687).
 *
 * A separate call from the write, and the dialog renders it: several copies of one stamp qualify
 * routinely, and *unflag this stamp* silently meaning *unflag four copies* is how a report loses
 * trust. It resolves the copies afresh from the live predicate rather than taking any from the
 * client, which is also why it can refuse — a row read a minute ago may no longer be one.
 */
export async function previewColnectLocalFixAction(
  collectionId: string,
  lt: number,
  colnectId: string,
  bucket: string,
  fix: ColnectLocalFix,
  colnectGrade: string | null
): Promise<
  { status: "success"; preview: ColnectLocalFixPreview } | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    const preview = await previewColnectLocalFix(
      session.user.id,
      collectionId,
      lt,
      colnectId,
      bucket,
      fix,
      colnectGrade
    );
    return { status: "success", preview };
  } catch (err) {
    if (err instanceof ColnectLocalFixError) return { status: "error", message: err.message };
    return { status: "error", message: "Could not work out what that fix would change." };
  }
}

/**
 * Apply one local-side fix (#687) — the half of a discrepancy that is this side's fault.
 *
 * It writes nothing else: no done mark and no accepted divergence, because the row leaves the report
 * on the next read for the only honest reason, which is that the predicate changed.
 */
export async function applyColnectLocalFixAction(
  collectionId: string,
  lt: number,
  colnectId: string,
  bucket: string,
  fix: ColnectLocalFix,
  colnectGrade: string | null
): Promise<{ status: "success"; changed: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const result = await applyColnectLocalFix(
      session.user.id,
      collectionId,
      lt,
      colnectId,
      bucket,
      fix,
      colnectGrade
    );
    return { status: "success", changed: result.changed };
  } catch (err) {
    if (err instanceof ColnectLocalFixError) return { status: "error", message: err.message };
    return { status: "error", message: "Failed to apply that fix. Please try again." };
  }
}

type ColnectAdoptState =
  | { status: "success"; pass: ColnectAdoptPass }
  | { status: "error"; message: string };

/**
 * What the next adoption pass would write, writing nothing (#688).
 *
 * The dialog renders this first and only then offers the run, because a wish list of twenty-five
 * thousand entries is not something to start blind: most of it will resolve to no stamp, and saying
 * so beforehand is the difference between a bulk action and a surprise.
 */
export async function previewColnectAdoptionAction(
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters
): Promise<ColnectAdoptState> {
  const session = await getSession();
  try {
    return { status: "success", pass: await previewColnectAdoption(session.user.id, collectionId, lt, filters) };
  } catch (err) {
    if (err instanceof ColnectAdoptError) return { status: "error", message: err.message };
    return { status: "error", message: "Could not work out what that would adopt." };
  }
}

/** Adopt one pass of the Extra-on-Colnect bucket into wants (#688). */
export async function applyColnectAdoptionAction(
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters
): Promise<ColnectAdoptState> {
  const session = await getSession();
  try {
    return { status: "success", pass: await applyColnectAdoption(session.user.id, collectionId, lt, filters) };
  } catch (err) {
    if (err instanceof ColnectAdoptError) return { status: "error", message: err.message };
    return { status: "error", message: "The adoption failed. Please try again." };
  }
}

/** Adopt one row from its own menu (#688) — the same resolution, narrowed to one Colnect id. */
export async function adoptColnectRowAction(
  collectionId: string,
  lt: number,
  colnectId: string
): Promise<ColnectAdoptState> {
  const session = await getSession();
  try {
    return {
      status: "success",
      pass: await applyColnectAdoptionForRow(session.user.id, collectionId, lt, colnectId),
    };
  } catch (err) {
    if (err instanceof ColnectAdoptError) return { status: "error", message: err.message };
    return { status: "error", message: "Could not add that to the want list. Please try again." };
  }
}

/**
 * What the Assistant would carry out on Colnect for this list (#689).
 *
 * Read before the confirmation, and the confirmation states its counts in both directions: a bulk
 * removal from a public list is visible to every partner reading it, and is not something to start
 * by accident. It is also where a stale export loses its removals — see
 * `COLNECT_APPLY_MAX_SNAPSHOT_AGE_DAYS`.
 */
export async function getColnectApplyWorklistAction(
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters
): Promise<
  { status: "success"; worklist: ColnectApplyWorklist } | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return {
      status: "success",
      worklist: await getColnectApplyWorklist(session.user.id, collectionId, lt, filters),
    };
  } catch (err) {
    if (err instanceof ColnectApplyError) return { status: "error", message: err.message };
    return { status: "error", message: "Could not work out what to apply on Colnect." };
  }
}

function parseFields(formData: FormData): { colnectAbbrev: string; catalogVendorId: string } {
  return {
    colnectAbbrev: ((formData.get("colnectAbbrev") as string | null) ?? "").trim(),
    catalogVendorId: ((formData.get("catalogVendorId") as string | null) ?? "").trim(),
  };
}

export async function createColnectMappingAction(
  collectionId: string,
  formData: FormData
): Promise<ColnectActionState> {
  const session = await getSession();
  const { colnectAbbrev, catalogVendorId } = parseFields(formData);
  if (!colnectAbbrev) return { status: "error", message: "Colnect abbreviation is required." };
  if (!catalogVendorId) return { status: "error", message: "Pick a local catalog to map to." };
  try {
    await createColnectMapping(session.user.id, collectionId, { colnectAbbrev, catalogVendorId });
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectAbbrevTakenError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to create mapping. Please try again." };
  }
}

export async function updateColnectMappingAction(
  mappingId: string,
  formData: FormData
): Promise<ColnectActionState> {
  const session = await getSession();
  const { colnectAbbrev, catalogVendorId } = parseFields(formData);
  if (!colnectAbbrev) return { status: "error", message: "Colnect abbreviation is required." };
  if (!catalogVendorId) return { status: "error", message: "Pick a local catalog to map to." };
  try {
    await updateColnectMapping(session.user.id, mappingId, { colnectAbbrev, catalogVendorId });
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectAbbrevTakenError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to update mapping. Please try again." };
  }
}

export async function deleteColnectMappingAction(
  mappingId: string
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await deleteColnectMapping(session.user.id, mappingId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete mapping. Please try again." };
  }
}
