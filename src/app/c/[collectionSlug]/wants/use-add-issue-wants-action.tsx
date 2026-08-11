"use client";

import { useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { IssueWantGapChecklist, WantAcceptanceInput } from "@/lib/wants";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { WantAcceptanceFields } from "./want-acceptance-fields";
import { useToast } from "@/app/toast-provider";
import { useInvalidateStamps } from "@/app/c/[collectionSlug]/stamps/use-stamps-query";
import { useInvalidateIssues } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import { useInvalidateWants } from "./use-wants-query";

/**
 * "Add missing to want list" for a whole issue (#548), from the issue list's row menu and its
 * promoted quick actions.
 *
 * The same generator the completeness card runs one checklist at a time (#532; ADR-0032 §6) —
 * wide-open wants for the stamps with no copy held and no open want, written once and editable
 * afterwards. What is new is only *the scope*: an issue is where a collector decides "I am going
 * after this set", and doing it stamp by stamp was the friction.
 *
 * An issue may hold several goals since #531, so **the checklists are picked, not assumed**: with
 * one the dialog simply confirms, with several it lists them ticked and the collector unticks what
 * they are not shopping for. Stamps on no checklist are never wanted here — those are the issue's
 * optional extras, which is exactly what being on none says.
 *
 * The confirmation states a count, so the preview is a read of its own rather than the numbers the
 * row already carries: what the row shows is how large the goal is, and what this writes is how
 * much of it is missing *and not already on the list*. The write recomputes both server-side — the
 * count is what the collector agrees to, not what is trusted.
 */
export function useAddIssueWantsAction({
  collectionId,
  issueId,
  checklistCount,
}: {
  collectionId: string;
  issueId: string;
  /** The issue's checklists, counted — the row already knows, and an issue with none has nothing
   *  to want. */
  checklistCount: number;
}): { action: RowAction; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);

  const action: RowAction = {
    key: "add-issue-wants",
    label: "Add missing to want list…",
    icon: "wants",
    disabled: checklistCount === 0,
    // #273: a blocked entry says why, rather than greying out in silence. An issue with no
    // checklist has stated no goal, and a want list is a list of goals.
    hint: checklistCount === 0 ? "This issue has no checklists" : undefined,
    onSelect: () => setOpen(true),
  };

  const dialog = open ? (
    <AddIssueWantsDialog
      collectionId={collectionId}
      issueId={issueId}
      onClose={() => setOpen(false)}
    />
  ) : null;

  return { action, dialog };
}

function AddIssueWantsDialog({
  collectionId,
  issueId,
  onClose,
}: {
  collectionId: string;
  issueId: string;
  onClose: () => void;
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  // Null until the preview lands, then every checklist that has something to add. A checklist with
  // nothing missing starts unticked: it is shown — the collector asked about this issue and "that
  // one is complete" is an answer — but ticking it would promise a want it cannot write.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // The terms every want of this run is written on, wide open by default — "anything will do", the
  // one thing a gap on its own can honestly say. Naming them here is what makes a second run over
  // the same set meaningful: *used, for sale* and *mint, for me* are two different intents about
  // one stamp, and only terms can tell them apart.
  const [acceptance, setAcceptance] = useState<WantAcceptanceInput>(ANY_ACCEPTANCE);
  // Any of the three axis menus being open — the shell must not take Escape from them (#361).
  const [menuOpen, setMenuOpen] = useState(false);

  const { invalidate: invalidateWants } = useInvalidateWants();
  const { invalidateList: invalidateStamps } = useInvalidateStamps();
  const { invalidateList: invalidateIssues } = useInvalidateIssues();

  const { data: gaps, isLoading, isFetching, isError } = useQuery<IssueWantGapChecklist[]>({
    // Its own namespace: this is a snapshot taken to be confirmed, not a list the screen renders,
    // and it must be re-read each time the dialog opens rather than served from a stale cache.
    // **The terms are part of the key**: both halves of the gap are judged through them — a used
    // copy in the album does not answer a want for mint, and an open want for mint is not what a
    // want for used would duplicate — so a change of terms is a different question, not a filter.
    queryKey: ["issue-want-gap", collectionId, issueId, acceptanceKey(acceptance)] as const,
    queryFn: async () => {
      const { previewIssueMissingWantsAction } = await import("@/app/actions/wants");
      return previewIssueMissingWantsAction(collectionId, issueId, acceptance);
    },
    // Keeps the last answer on screen while the next terms are counted, so the dialog does not
    // blink back to "Checking…" on every tick of a condition box.
    placeholderData: (prev) => prev,
    staleTime: 0,
    gcTime: 0,
  });

  const selected =
    picked ?? new Set((gaps ?? []).filter((g) => g.toCreateStampIds.length > 0).map((g) => g.checklistId));
  const chosen = (gaps ?? []).filter((g) => selected.has(g.checklistId));
  // Unioned over the selection, never summed: a stamp on two checklists of one issue is one want,
  // and adding the two counts would promise more rows than the write produces.
  const toCreate = new Set(chosen.flatMap((g) => g.toCreateStampIds)).size;
  const missing = new Set(chosen.flatMap((g) => g.missingStampIds)).size;
  const alreadyWanted = missing - toCreate;
  const hasTerms =
    acceptance.conditionIds.length > 0 ||
    acceptance.certificateStatusIds.length > 0 ||
    acceptance.formatIds.length > 0;

  function toggle(checklistId: string) {
    setPicked(() => {
      const next = new Set(selected);
      if (next.has(checklistId)) next.delete(checklistId);
      else next.add(checklistId);
      return next;
    });
  }

  function confirm() {
    startTransition(async () => {
      setError(undefined);
      const { addIssueMissingToWantListAction } = await import("@/app/actions/wants");
      const result = await addIssueMissingToWantListAction(
        collectionId,
        issueId,
        [...selected],
        acceptance
      );
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onClose();
      // The want chip rides on the catalogue read models as well as the want list itself, so all
      // three caches go — the rule `useAddWantAction` states: whatever a value is copied onto has
      // to be invalidated with it.
      void invalidateWants(collectionId);
      void invalidateStamps(collectionId);
      void invalidateIssues(collectionId);
      toast({
        message:
          result.created === 0
            ? "Nothing to add — every missing stamp is already on the want list"
            : `${result.created} ${result.created === 1 ? "want" : "wants"} added, one per missing stamp`,
        ...(result.created > 0
          ? { href: `/c/${collectionSlug}/wants`, linkLabel: "Open want list" }
          : {}),
      });
    });
  }

  return (
    <DialogShell
      title="Add missing to want list"
      onClose={() => !isPending && onClose()}
      maxWidth="34rem"
      // An axis menu open above the panel owns Escape — closing the dialog under it would take
      // the terms with it (#361).
      dismissable={!menuOpen}
    >
      <DialogBody>
        {isLoading ? (
          <p style={MESSAGE_STYLE}>Checking what this issue is missing…</p>
        ) : isError || !gaps ? (
          <p style={MESSAGE_STYLE}>Could not read what this issue is missing.</p>
        ) : gaps.length === 0 ? (
          <p style={MESSAGE_STYLE}>
            This issue has no checklists, so nothing is required of it yet.
          </p>
        ) : (
          <>
            {gaps.length > 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.75rem" }}>
                {gaps.map((g) => (
                  <label
                    key={g.checklistId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.875rem",
                      cursor: isPending ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(g.checklistId)}
                      onChange={() => toggle(g.checklistId)}
                      disabled={isPending}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>{g.name}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      {g.toCreateStampIds.length > 0
                        ? `${g.toCreateStampIds.length} to add`
                        : g.missingStampIds.length > 0
                          ? "all already wanted"
                          : "complete"}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <span style={{ ...MESSAGE_STYLE, display: "block" }}>
              {toCreate === 0
                ? missing === 0
                  ? hasTerms
                    ? "Nothing is missing — you hold a copy of every stamp of the selection that these terms would take."
                    : "Nothing is missing — every stamp of the selection is in the collection."
                  : `All ${missing} missing ${missing === 1 ? "stamp is" : "stamps are"} already on the want list${hasTerms ? " on these terms" : ""}.`
                : `${toCreate} ${toCreate === 1 ? "want" : "wants"} will be created, one per missing stamp${
                    alreadyWanted > 0
                      ? `; ${alreadyWanted} more ${alreadyWanted === 1 ? "is" : "are"} already wanted${hasTerms ? " on these terms" : ""}`
                      : ""
                  }.`}
            </span>
            <span
              style={{
                display: "block",
                marginTop: "0.5rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              {hasTerms
                ? "Both figures are read on these terms: a copy that does not meet them is not one you hold, and a want on other terms is not this one."
                : "Each is created wide open — anything will do. Narrow the terms below to want a set in a particular shape, or edit each one afterwards on the want list."}
            </span>

            {/* The terms lead nothing and follow everything: the counts above are what the
                collector came for, and this is the control that changes what they mean. Same
                editor as the want form — profile picker included (#533) — because "add the whole
                set as MNH" is the same sentence typed once instead of twelve times. */}
            <div style={{ marginTop: "1rem" }}>
              <LabelWithError>Terms</LabelWithError>
              <WantAcceptanceFields
                collectionId={collectionId}
                value={acceptance}
                onChange={setAcceptance}
                disabled={isPending}
                onPopoverOpenChange={setMenuOpen}
                menuZIndex={200}
              />
            </div>
          </>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={
          isPending
            ? "Adding…"
            : toCreate === 0
              ? "Add"
              : `Add ${toCreate} ${toCreate === 1 ? "want" : "wants"}`
        }
        // Nothing to write is a **disabled** button, not a pending one: the dialog has already said
        // why in words, and a press that reports "added 0" is a round trip to learn what is on
        // screen. It is also never enabled over a count still being re-read, since the number on
        // the button is the promise being confirmed.
        disabled={isPending || isFetching || toCreate === 0}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={confirm}
      />
    </DialogShell>
  );
}

const MESSAGE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-primary)",
  lineHeight: 1.6,
};

/** Wide open — the default, and what the completeness card's own button has always written. */
const ANY_ACCEPTANCE: WantAcceptanceInput = {
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
};

/** The terms as a cache key. Sorted, because a set is not an order and re-ticking two boxes the
 *  other way round is the same question — the server compares sets too (`acceptanceSetsEqual`). */
function acceptanceKey(a: WantAcceptanceInput): string {
  const axis = (ids: (string | null)[]) => [...ids].map((id) => id ?? "~").sort().join(",");
  return `${axis(a.conditionIds)}|${axis(a.certificateStatusIds)}|${axis(a.formatIds)}`;
}
