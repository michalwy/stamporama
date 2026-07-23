"use client";

import { lsGet, lsSet, lsRemove } from "./lot-view-prefs";

// Shared "remember last-used" storage for the add-copy flows (#121, #234). The condition,
// location, and disposition last chosen are remembered per collection and pre-filled at every
// add-copy entry point — the inventory add dialog (#99) and lot intake (#121) — so all of them
// read and write the same keys. Kept under the original `intake` namespace so values already
// remembered from lot intake carry over. Ids are collection-specific, hence the per-collection
// suffix.
export const LS_LAST_CONDITION = "stamporama:intake:conditionId";
export const LS_LAST_CERT = "stamporama:intake:certId";
export const LS_LAST_LOCATION = "stamporama:intake:locationId";
// Disposition stored as a comma-joined list of the active flag keys.
export const LS_LAST_DISPOSITION = "stamporama:intake:disposition";

export function readLast(key: string, collectionId: string): string {
  return lsGet(`${key}:${collectionId}`) ?? "";
}

export function writeLast(key: string, collectionId: string, value: string): void {
  if (value) lsSet(`${key}:${collectionId}`, value);
  else lsRemove(`${key}:${collectionId}`);
}

export interface AddCopyDisposition {
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
}

const DISPOSITION_KEYS = ["inCollection", "forSale", "forTrade"] as const;

export interface AddCopyDefaults {
  conditionId: string;
  locationId: string;
  /** null when nothing has been remembered yet — callers apply their own cold-start default. */
  disposition: AddCopyDisposition | null;
}

/**
 * Last-used add-copy defaults for this collection, with ids that no longer exist dropped
 * (deleted condition / non-assignable or deleted location fall back to none). `disposition`
 * is null when nothing was ever remembered so callers can pick their own initial state.
 */
export function readAddCopyDefaults(
  collectionId: string,
  conditions: ReadonlyArray<{ id: string }>,
  locations: ReadonlyArray<{ id: string; assignable: boolean }>
): AddCopyDefaults {
  const cond = readLast(LS_LAST_CONDITION, collectionId);
  const loc = readLast(LS_LAST_LOCATION, collectionId);
  const raw = readLast(LS_LAST_DISPOSITION, collectionId);
  const active = new Set(raw.split(",").filter(Boolean));
  return {
    conditionId: conditions.some((c) => c.id === cond) ? cond : "",
    locationId: locations.some((l) => l.id === loc && l.assignable) ? loc : "",
    disposition: raw
      ? {
          inCollection: active.has("inCollection"),
          forSale: active.has("forSale"),
          forTrade: active.has("forTrade"),
        }
      : null,
  };
}

/** Remember the condition, location, and disposition just used, shared across every entry point. */
export function writeAddCopyDefaults(
  collectionId: string,
  values: { conditionId: string; locationId: string; disposition: AddCopyDisposition }
): void {
  writeLast(LS_LAST_CONDITION, collectionId, values.conditionId);
  writeLast(LS_LAST_LOCATION, collectionId, values.locationId);
  writeLast(
    LS_LAST_DISPOSITION,
    collectionId,
    DISPOSITION_KEYS.filter((k) => values.disposition[k]).join(",")
  );
}
