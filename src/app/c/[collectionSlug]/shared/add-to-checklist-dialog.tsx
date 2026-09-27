"use client";

import { useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import type { SpanningChecklistSummary } from "@/lib/checklists";
import type { TranslationValueMap } from "@/lib/translations";
import { useToast } from "@/app/toast-provider";
import { ChecklistNameDialog } from "./checklist-name-dialog";
import { useInvalidateStampsAndIssues } from "./use-invalidate-stamps-and-issues";

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

/** The value the radio list holds for "start a new one". Never a cuid. */
const NEW_CHECKLIST = "__new__";

/**
 * *Add to checklist…* on the Issues list's stamp selection (#808, #1416) — how a checklist spanning
 * issues is filled: the list reaches every issue and area, and its ticks are the stamps.
 *
 * **Only the ticked stamps join, never what a tick carries.** A tick on the tree carries its whole
 * subtree (ADR-0048 §7), which is right for a size written onto paper and wrong for a set: a set lists
 * `309`, and a copy of `309A` already counts for it through the variant rollup (#661), so putting the
 * variants on too would turn one slot into five. The dialog says which it adds, as
 * `stamp-tree-selection.ts` asks of a consumer that wants a parent without its children.
 *
 * Only checklists that span issues are offered: an issue's own is edited on its issue (ADR-0031 §5),
 * where the stamps offered are that issue's.
 */
export function AddToChecklistDialog({
  collectionId,
  stampIds,
  onAdded,
  onClose,
}: {
  collectionId: string;
  /** The ticked stamps in view, in the order they were ticked. */
  stampIds: string[];
  onAdded: () => void;
  onClose: () => void;
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [picked, setPicked] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);

  // The run picker's own list (#1225), under its key, so either door keeps the other current.
  const { data: checklists, isLoading } = useQuery<SpanningChecklistSummary[]>({
    queryKey: ["checklists", collectionId, "spanning"] as const,
    queryFn: async () => {
      const { listSpanningChecklistsAction } = await import("@/app/actions/checklists");
      return listSpanningChecklistsAction(collectionId);
    },
  });
  // Opened on the first one when there are any, on *new* when there are none.
  const choice = picked ?? (checklists && checklists.length > 0 ? checklists[0].id : NEW_CHECKLIST);

  function finish(checklistName: string, added: number) {
    void queryClient.invalidateQueries({ queryKey: ["checklists", collectionId] });
    void queryClient.invalidateQueries({ queryKey: ["checklistPriceDetails", collectionId] });
    void invalidateStampsAndIssues(collectionId);
    const skipped = stampIds.length - added;
    toast({
      message:
        added === 0
          ? `Every selected stamp is already on ${checklistName}`
          : `${added} ${added === 1 ? "stamp" : "stamps"} added to ${checklistName}${
              skipped > 0 ? ` — ${skipped} already on it` : ""
            }`,
      href: `/c/${collectionSlug}/checklists`,
      linkLabel: "Open checklists",
    });
    onAdded();
    onClose();
  }

  function addTo(checklistId: string, checklistName: string) {
    startTransition(async () => {
      setError(undefined);
      const { addStampsToSpanningChecklistAction } = await import("@/app/actions/checklists");
      const result = await addStampsToSpanningChecklistAction(checklistId, stampIds);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      finish(checklistName, result.added);
    });
  }

  function createAndAdd(name: string, translations: TranslationValueMap) {
    startTransition(async () => {
      setError(undefined);
      const { createSpanningChecklistAction, addStampsToSpanningChecklistAction } = await import(
        "@/app/actions/checklists"
      );
      const created = await createSpanningChecklistAction(collectionId, name, translations);
      if (created.status === "error") {
        setError(created.message);
        return;
      }
      const result = await addStampsToSpanningChecklistAction(created.checklistId, stampIds);
      if (result.status === "error") {
        // The checklist exists now; say so rather than leaving it to be found empty.
        setNaming(false);
        setError(`${name} was created, but the stamps were not added: ${result.message}`);
        void queryClient.invalidateQueries({ queryKey: ["checklists", collectionId] });
        return;
      }
      finish(name, result.added);
    });
  }

  if (naming) {
    return (
      <ChecklistNameDialog
        collectionId={collectionId}
        title="New checklist"
        siblings={checklists ?? []}
        siblingsLabel="among the checklists spanning issues"
        placeholder="e.g. Grosik 1928–1932, Birds, Castles definitives"
        isPending={isPending}
        error={error}
        onCancel={() => {
          if (isPending) return;
          setNaming(false);
          setError(undefined);
        }}
        onSubmit={createAndAdd}
      />
    );
  }

  const count = stampIds.length;
  return (
    <DialogShell
      title="Add to checklist"
      onClose={() => {
        if (!isPending) onClose();
      }}
      maxWidth="min(96vw, 32rem)"
    >
      <form
        style={FORM_STYLE}
        onSubmit={(e) => {
          e.preventDefault();
          if (choice === NEW_CHECKLIST) {
            setError(undefined);
            setNaming(true);
            return;
          }
          const target = checklists?.find((c) => c.id === choice);
          if (target) addTo(target.id, target.name);
        }}
      >
        <DialogBody>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: "0 0 0.75rem" }}>
            Puts the {count === 1 ? "ticked stamp" : `${count} ticked stamps`} on a checklist that
            spans issues, after the stamps already on it. Only what is ticked joins — not the
            variants a tick brings along, since a copy of a variant already counts for the stamp it
            is a variant of.
          </p>
          {isLoading ? (
            <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading…</p>
          ) : (
            <div
              role="radiogroup"
              aria-label="Checklist"
              style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
            >
              {(checklists ?? []).map((c) => {
                const already = stampIds.filter((id) => c.stampIds.includes(id)).length;
                return (
                  <label
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.875rem",
                      cursor: isPending ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="checklist"
                      checked={choice === c.id}
                      onChange={() => setPicked(c.id)}
                      disabled={isPending}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      {c.stampIds.length} stamp{c.stampIds.length !== 1 ? "s" : ""}
                      {already > 0 && ` · ${already} of these already on it`}
                    </span>
                  </label>
                );
              })}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                  cursor: isPending ? "default" : "pointer",
                }}
              >
                <input
                  type="radio"
                  name="checklist"
                  checked={choice === NEW_CHECKLIST}
                  onChange={() => setPicked(NEW_CHECKLIST)}
                  disabled={isPending}
                />
                <span>New checklist…</span>
              </label>
            </div>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending ? "Adding…" : choice === NEW_CHECKLIST ? "Next…" : "Add"
          }
          onCancel={onClose}
          disabled={isPending || isLoading}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
