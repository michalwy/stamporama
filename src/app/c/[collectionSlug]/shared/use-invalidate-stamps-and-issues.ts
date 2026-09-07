"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { stampKeys } from "@/app/c/[collectionSlug]/stamps/use-stamps-query";
import { issueKeys } from "@/app/c/[collectionSlug]/issues/use-issues-query";

/**
 * **A write to a stamp or to an issue invalidates both caches, and this is the only place that
 * decides so** (#918).
 *
 * The two lists are not independent views of independent data, which is the fact the per-call-site
 * arrangement kept losing. A stamp row carries its issue's name, year and checklists
 * (`StampIssueMembership` in `src/lib/stamps.ts`), so an issue write stales the Stamps list; an
 * issue's tree carries its stamps and their `IssueMember.sortOrder`, so a stamp write stales the
 * Issues tree. Answering one direction without the other is how nine call sites came to hold five
 * different answers, of which six were "neither" (#914, #918).
 *
 * `issueKeys.all` is a **prefix** of the members key, and TanStack matches query keys by prefix, so
 * this covers `invalidateMembers` too — a call site that already invalidates members separately is
 * doing no harm and no work.
 *
 * Invalidating a cache nothing has mounted is free: `invalidateQueries` marks matching entries
 * stale and refetches only the active ones. So the Offers screen calling this costs nothing for the
 * Issues tree it is not showing, and that is what makes one unconditional call viable in place of
 * nine judgements about which caches a screen happens to hold.
 *
 * **Call it on success, not on submit.** `StampFormDialog` cannot do this for its callers: its
 * `onSubmit` returns `void` and runs before the server action does, so the dialog knows only that
 * Save was pressed — invalidating there would refetch after a failed save. The call belongs where
 * the action's result is read, which is the call site.
 *
 * `tests/unit/stamp-form-dialog-invalidation.test.ts` fails when a file that opens `StampFormDialog`
 * never calls this.
 */
export function useInvalidateStampsAndIssues() {
  const queryClient = useQueryClient();
  const invalidateStampsAndIssues = useCallback(
    (collectionId: string) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: stampKeys.all(collectionId) }),
        queryClient.invalidateQueries({ queryKey: issueKeys.all(collectionId) }),
      ]),
    [queryClient]
  );
  return { invalidateStampsAndIssues };
}
