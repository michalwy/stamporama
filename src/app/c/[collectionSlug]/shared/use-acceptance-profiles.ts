"use client";

import { useQuery } from "@tanstack/react-query";
import type { AcceptanceProfileData } from "@/lib/acceptance-profiles";
import { acceptanceSetsEqual, type AcceptanceSets } from "@/lib/want-rules";
import { LS_LAST_ACCEPTANCE_PROFILE, readLast, writeLast } from "./add-copy-defaults";

/**
 * The collection's named acceptance profiles (#533; ADR-0032 §9), for the editors that apply one.
 *
 * Its own hook rather than a prop, for the reason `useCollectionConditions` is one: the dictionary
 * is small, per-collection and rarely changes, and the two places that apply a profile — the want
 * form and the intake review's narrow step — are rendered from screens that have no other reason to
 * load it.
 *
 * An **empty list is the ordinary state**, not a missing setup: nothing here is required, and the
 * picker simply does not appear until a profile exists.
 */
export function useAcceptanceProfiles(
  collectionId: string,
  /** `enabled: false` for the editor that *defines* profiles — it renders the same acceptance
   *  fields and has no use for the picker, so it should not fetch the list either. */
  options?: { enabled?: boolean }
) {
  return useQuery<AcceptanceProfileData[]>({
    queryKey: ["acceptance-profiles", collectionId],
    queryFn: async () => {
      const { getAcceptanceProfilesAction } = await import("@/app/actions/acceptance-profiles");
      return getAcceptanceProfilesAction(collectionId);
    },
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

// ── The last profile used ────────────────────────────────────────────────────
//
// Wants are entered in runs — a dealer's list, an evening with a catalogue — and the run is almost
// always on one set of terms. So the profile a want was **saved** on is remembered per collection
// and leads the next add, exactly as the last subtype leads the next child stamp (#342) and the
// last condition leads the next copy (#121).
//
// Saved, not *picked*: a profile chosen, looked at and then cancelled is not what the collector
// went with, and the terms are what matters here rather than the dropdown having been touched.
// Which is also why what is remembered is derived from the sets on submit rather than tracked as a
// selection — the want form has no other notion of "the current profile" (ADR-0032 §9), and a
// second one would be a thing to keep in step.

/**
 * The remembered profile, or null — nothing remembered yet, or the profile has since been deleted
 * or edited away. A stale id falls back to no profile rather than to a guess, the way a deleted
 * condition drops out of the add-copy defaults.
 */
export function readRememberedProfile(
  collectionId: string,
  profiles: readonly AcceptanceProfileData[]
): AcceptanceProfileData | null {
  const id = readLast(LS_LAST_ACCEPTANCE_PROFILE, collectionId);
  return profiles.find((p) => p.id === id) ?? null;
}

/**
 * Remember whichever profile these terms are — and **forget** when they are none.
 *
 * Clearing matters as much as writing: a want deliberately entered on custom terms says the run has
 * moved on, and leaving the old profile behind would seed the next want with terms the collector
 * has just chosen not to use.
 */
export function rememberProfileFor(
  collectionId: string,
  profiles: readonly AcceptanceProfileData[],
  acceptance: AcceptanceSets
): void {
  const match = profiles.find((p) => acceptanceSetsEqual(p, acceptance));
  writeLast(LS_LAST_ACCEPTANCE_PROFILE, collectionId, match?.id ?? "");
}
