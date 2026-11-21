"use client";

import { useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ShownIssuesWantGapPreview } from "@/app/actions/wants";
import type { WantPriority } from "@/lib/want-rules";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { WantAcceptanceFields } from "./want-acceptance-fields";
import { WantPriorityChoice } from "./want-priority-choice";
import { rememberProfileFor } from "@/app/c/[collectionSlug]/shared/use-acceptance-profiles";
import { useToast } from "@/app/toast-provider";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { useInvalidateWants } from "./use-wants-query";
import { SpecialisedChecklistsToggle } from "@/app/c/[collectionSlug]/shared/specialised-checklists";
import { isWantDepth, WANT_DEPTH_NOUN, type WantDepth } from "@/lib/want-depth-rules";
import {
  LS_LAST_WANT_DEPTH,
  readLast,
  writeLast,
} from "@/app/c/[collectionSlug]/shared/add-copy-defaults";
import {
  acceptanceKey,
  MESSAGE_STYLE,
  useRunAcceptance,
  WantDepthField,
} from "./use-add-issue-wants-action";

/**
 * *Add missing to want list* over **every issue the Issues list is showing** (#2664) — the selected
 * area with its sub-areas as the list includes them, the years and every other filter in force.
 *
 * The one-issue add (#548) at the scale a collector starts an area at: the same gap (the stamps on
 * the issues' checklists with no counted copy and no open want on the chosen terms), the same
 * questions — terms, priority, depth, specialised checklists — each asked once for the whole run.
 * What it does not offer is the one-issue dialog's per-checklist ticks: over a hundred issues they
 * would be a list nobody reads, and the specialised switch already says which kind is wanted.
 *
 * The run is named by `scopeQuery`, the very query string the list's rows were read with
 * (`issue-list-params.ts`), so the server covers the issues the collector is looking at and not a
 * second reading of the filters. The figures are read before anything is written and recomputed when
 * the collector confirms.
 */
export function AddShownIssuesWantsDialog({
  collectionId,
  scopeQuery,
  onClose,
}: {
  collectionId: string;
  scopeQuery: string;
  onClose: () => void;
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { acceptance, setAcceptance, profiles } = useRunAcceptance(collectionId);
  const [priority, setPriority] = useState<WantPriority>("normal");
  // The one-issue add's remembered depth: one question, one memory.
  const [depth, setDepth] = useState<WantDepth>(() => {
    const remembered = readLast(LS_LAST_WANT_DEPTH, collectionId);
    return isWantDepth(remembered) ? remembered : "main";
  });
  const noun = WANT_DEPTH_NOUN[depth];
  const [menuOpen, setMenuOpen] = useState(false);

  const { invalidate: invalidateWants } = useInvalidateWants();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();

  const { data: gap, isLoading, isFetching, isError } = useQuery<ShownIssuesWantGapPreview>({
    // A snapshot to be confirmed, re-read on every open — the one-issue dialog's reasoning, with
    // the list's narrowing in the key beside the terms and the depth.
    queryKey: ["shown-issues-want-gap", collectionId, scopeQuery, acceptanceKey(acceptance), depth] as const,
    queryFn: async () => {
      const { previewShownIssuesMissingWantsAction } = await import("@/app/actions/wants");
      return previewShownIssuesMissingWantsAction(collectionId, scopeQuery, acceptance, depth);
    },
    placeholderData: (prev) => prev,
    staleTime: 0,
    gcTime: 0,
  });

  const toCreate = gap?.toCreate ?? 0;
  const alreadyWanted = gap ? gap.missing - gap.toCreate : 0;
  const hasTerms =
    acceptance.conditionIds.length > 0 ||
    acceptance.certificateStatusIds.length > 0 ||
    acceptance.formatIds.length > 0;

  function confirm() {
    startTransition(async () => {
      setError(undefined);
      const { addShownIssuesMissingToWantListAction } = await import("@/app/actions/wants");
      const result = await addShownIssuesMissingToWantListAction(
        collectionId,
        scopeQuery,
        acceptance,
        priority,
        depth
      );
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      rememberProfileFor(collectionId, profiles ?? [], acceptance);
      writeLast(LS_LAST_WANT_DEPTH, collectionId, depth);
      onClose();
      void invalidateWants(collectionId);
      void invalidateStampsAndIssues(collectionId);
      toast({
        message:
          result.created === 0
            ? `Nothing to add — every missing ${noun.one} is already on the want list`
            : `${result.created} ${result.created === 1 ? "want" : "wants"} added, one per missing ${noun.one}`,
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
      dismissable={!menuOpen}
    >
      <DialogBody>
        <div style={{ marginBottom: "0.75rem" }}>
          <SpecialisedChecklistsToggle />
        </div>
        {isLoading ? (
          <p style={MESSAGE_STYLE}>Checking what the issues on the list are missing…</p>
        ) : isError || !gap ? (
          <p style={MESSAGE_STYLE}>Could not read what the issues on the list are missing.</p>
        ) : gap.issueCount === 0 ? (
          <p style={MESSAGE_STYLE}>The list shows no issues, so there is nothing to want.</p>
        ) : (
          <>
            <WantDepthField value={depth} onChange={setDepth} disabled={isPending} />
            {/* The run's reach first — how many issues, how many with a gap, how many add nothing
                for want of a checklist — then what it writes. */}
            <p style={MESSAGE_STYLE}>{issuesSentence(gap)}</p>
            <p style={{ ...MESSAGE_STYLE, marginTop: "0.5rem" }}>
              {toCreate === 0
                ? gap.missing === 0
                  ? hasTerms
                    ? `Nothing is missing — you hold a copy of every ${noun.one} on their checklists that these terms would take.`
                    : `Nothing is missing — every ${noun.one} on their checklists is in the collection.`
                  : `All ${gap.missing} missing ${gap.missing === 1 ? `${noun.one} is` : `${noun.many} are`} already on the want list${hasTerms ? " on these terms" : ""}.`
                : `${toCreate} ${toCreate === 1 ? "want" : "wants"} will be created, one per missing ${noun.one}${
                    alreadyWanted > 0
                      ? `; ${alreadyWanted} more ${alreadyWanted === 1 ? "is" : "are"} already wanted${hasTerms ? " on these terms" : ""}`
                      : ""
                  }.`}
            </p>
            <span
              style={{
                display: "block",
                marginTop: "0.5rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Only stamps on the issues&apos; own checklists are wanted; checklists that span issues
              are not part of the run.
            </span>

            <div style={{ marginTop: "1rem" }}>
              <LabelWithError>Terms</LabelWithError>
              <WantAcceptanceFields
                collectionId={collectionId}
                value={acceptance}
                onChange={setAcceptance}
                disabled={isPending}
                onPopoverOpenChange={setMenuOpen}
                menuZIndex={200}
                extra={
                  <div style={{ minWidth: 0 }}>
                    <LabelWithError>Priority</LabelWithError>
                    <WantPriorityChoice value={priority} onChange={setPriority} disabled={isPending} />
                  </div>
                }
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
        // As on the one-issue add: nothing to write is a disabled button, and a count still being
        // re-read is not one to confirm.
        disabled={isPending || isFetching || toCreate === 0}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={confirm}
      />
    </DialogShell>
  );
}

/** "48 issues on the list, 12 of them missing something; 3 have no checklist and add nothing." */
export function issuesSentence(gap: {
  issueCount: number;
  issuesWithGaps: number;
  issuesWithoutChecklist: number;
}): string {
  const issues = `${gap.issueCount} ${gap.issueCount === 1 ? "issue" : "issues"} on the list`;
  const withGaps =
    gap.issueCount === 1
      ? gap.issuesWithGaps === 0
        ? "missing nothing"
        : "missing something"
      : gap.issuesWithGaps === 0
        ? "none of them missing anything"
        : `${gap.issuesWithGaps} of them missing something`;
  const without =
    gap.issuesWithoutChecklist === 0
      ? ""
      : gap.issueCount === 1
        ? "; it has no checklist, so it adds nothing"
        : `; ${gap.issuesWithoutChecklist} ${gap.issuesWithoutChecklist === 1 ? "has" : "have"} no checklist and add${gap.issuesWithoutChecklist === 1 ? "s" : ""} nothing`;
  return `${issues}, ${withGaps}${without}.`;
}
