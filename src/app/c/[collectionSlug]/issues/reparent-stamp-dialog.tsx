"use client";

import { useMemo, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
  LabelWithError,
} from "@/app/dialog-shell";
import { buildStampTree, type StampTreeNodeData } from "@/app/c/[collectionSlug]/shared/issue-view";
import { stampNodeLabel } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { useIssueMembers } from "./use-issues-query";
import type { StampNodeData } from "@/lib/issues";

// Where a stamp hangs in its issue's tree (#656), corrected — the finer-grained neighbour of #54's
// "move this stamp to another issue". A stamp filed at the top level that turns out to be a variant
// of another, or one filed under the wrong base, is refiled here.
//
// The parent is picked from **this issue's own stamps**, which is the rule a parent already obeys
// (`addStampToIssue` refuses one from anywhere else), and the list is the issue's tree flattened —
// indented, so the shape being joined is readable in a plain select. Two stamps are missing from it
// on purpose: the one being moved, and everything below it. A stamp filed under its own variant is
// a ring, and the server refuses it; not offering it is how the collector finds that out before
// pressing anything.
//
// **— No parent —** leads the list rather than being an afterthought at the end of it: it is the
// answer that undoes a misfiling, and without it the action would only ever be reversible by
// deleting the stamp.

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

/** The same select box the issue screen's other dialogs use. */
const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

const NOTE_STYLE: React.CSSProperties = {
  marginTop: "0.75rem",
  marginBottom: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** One option of the flattened tree: the stamp, and how deep it sits. */
interface ParentOption {
  node: StampNodeData;
  depth: number;
}

/**
 * The issue's tree as a list of options, in reading order, skipping `excludeId` and everything under
 * it — a stamp cannot become a child of its own descendant, and the whole branch goes with it.
 */
function parentOptions(
  tree: StampTreeNodeData[],
  excludeId: string,
  depth = 0
): ParentOption[] {
  const out: ParentOption[] = [];
  for (const { node, children } of tree) {
    if (node.stampId === excludeId) continue;
    out.push({ node, depth });
    out.push(...parentOptions(children, excludeId, depth + 1));
  }
  return out;
}

export function ReparentStampDialog({
  collectionId,
  issueId,
  stampId,
  isPending,
  error,
  onSubmit,
  onClose,
}: {
  collectionId: string;
  issueId: string;
  stampId: string;
  isPending: boolean;
  error?: string;
  onSubmit: (fd: FormData) => void;
  onClose: () => void;
}) {
  const { data: members = [], isLoading } = useIssueMembers(collectionId, issueId, true);

  const tree = useMemo(() => buildStampTree(members), [members]);
  const options = useMemo(() => parentOptions(tree, stampId), [tree, stampId]);
  const moving = members.find((m) => m.stampId === stampId) ?? null;
  const currentParentId = moving?.parentId ?? "";

  // `null` while the members are still loading: the current parent is not known yet, and seeding the
  // select with "" would make *top level* look like the answer already given.
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? currentParentId;
  const changed = !isLoading && value !== currentParentId;

  return (
    <DialogShell title="Reassign stamp to another parent" onClose={onClose}>
      <form
        style={FORM_STYLE}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <DialogBody>
          <div>
            <LabelWithError htmlFor="f-reparent">
              New parent for {moving ? stampNodeLabel(moving) : "this stamp"}
            </LabelWithError>
            <select
              id="f-reparent"
              name="parentStampId"
              style={INPUT_STYLE}
              disabled={isPending || isLoading}
              value={value}
              onChange={(e) => setPicked(e.target.value)}
            >
              <option value="">— No parent (top level)</option>
              {options.map(({ node, depth }) => (
                <option key={node.stampId} value={node.stampId}>
                  {`${"  ".repeat(depth)}${depth > 0 ? "└ " : ""}${stampNodeLabel(node)}`}
                </option>
              ))}
            </select>
            {isLoading ? (
              <p style={NOTE_STYLE}>Loading this issue&rsquo;s stamps…</p>
            ) : (
              <p style={NOTE_STYLE}>
                Only where the stamp sits in this issue&rsquo;s tree changes. It keeps its catalog
                numbers, its name and its subtype, and every copy, want and offer that names it is
                untouched. Its own sub-stamps move with it.
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <div style={{ position: "relative" }}>
            <ErrorBubble>{error}</ErrorBubble>
            <DialogPrimaryButton type="submit" disabled={!changed || isPending}>
              {isPending ? "Reassigning…" : "Reassign"}
            </DialogPrimaryButton>
          </div>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}
