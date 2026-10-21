"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { formatItemNo } from "@/lib/item-number";
import type { ReplacementSide } from "@/lib/replacement-rules";
import type { ReplacementCandidateData } from "@/lib/replacements";
import {
  useInvalidateInventory,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { ReplacementCopy } from "./replacement-copy";

const OPTION: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  alignItems: "center",
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  cursor: "pointer",
};

/** The query every replacement read is keyed under — inside the inventory prefix, so a copy write
 * (which invalidates the inventory) re-reads the pairs as well. */
export function replacementKeys(collectionId: string) {
  return {
    all: ["inventory", collectionId, "replacements"] as const,
    candidates: (itemId: string, side: ReplacementSide) =>
      ["inventory", collectionId, "replacements", "candidates", itemId, side] as const,
    copy: (itemId: string) => ["inventory", collectionId, "replacements", "copy", itemId] as const,
    replaceable: (stampId: string, excludeItemId: string | null) =>
      ["inventory", collectionId, "replacements", "replaceable", stampId, excludeItemId] as const,
    review: (filters: unknown) =>
      ["inventory", collectionId, "replacements", "review", filters] as const,
  };
}

/**
 * Record a replacement pair from a copy's `⋮` (#1936): *Replaces…* asks which held copy this one
 * replaces, *Replaced by…* which copy replaces this one. The choice is among the collection's other
 * held copies of the same stamp, the ones in the collection first; a copy already being replaced is
 * listed but cannot be chosen as the old copy, and says why. Recording moves nothing.
 */
export function RecordReplacementDialog({
  collectionId,
  collectionSlug,
  item,
  side,
  onClose,
}: {
  collectionId: string;
  collectionSlug: string;
  item: { id: string; itemNo: number };
  /** The side `item` takes: `new` for *Replaces…*, `old` for *Replaced by…*. */
  side: ReplacementSide;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { invalidateList } = useInvalidateInventory();
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const candidates = useQuery<ReplacementCandidateData[]>({
    queryKey: replacementKeys(collectionId).candidates(item.id, side),
    queryFn: async () => {
      const { listReplacementCandidatesAction } = await import("@/app/actions/replacements");
      return listReplacementCandidatesAction(collectionId, item.id, side);
    },
  });

  const label = formatItemNo(item.itemNo);
  const title = side === "new" ? `${label} replaces…` : `${label} is replaced by…`;

  function submit() {
    if (!chosen) return;
    setError(undefined);
    startTransition(async () => {
      const { recordReplacementAction } = await import("@/app/actions/replacements");
      const input =
        side === "new"
          ? { newItemId: item.id, oldItemId: chosen }
          : { newItemId: chosen, oldItemId: item.id };
      const result = await recordReplacementAction(collectionId, input);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      void invalidateList(collectionId);
      toast({
        message: "Replacement recorded",
        href: `/c/${collectionSlug}/inventory/replacements`,
        linkLabel: "Open Replacements",
      });
      onClose();
    });
  }

  const rows = candidates.data ?? [];

  return (
    <DialogShell title={title} onClose={onClose} maxWidth="40rem">
      <DialogBody>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          {side === "new"
            ? "Choose the copy this one takes the place of. Nothing moves until the pair is done on Replacements."
            : "Choose the copy that takes this one's place. Nothing moves until the pair is done on Replacements."}
        </p>
        {candidates.isLoading ? (
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>Loading…</p>
        ) : candidates.isError ? (
          <p style={{ margin: 0, color: "var(--color-error)" }}>The copies could not be read.</p>
        ) : rows.length === 0 ? (
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
            The collection holds no other copy of this stamp.
          </p>
        ) : (
          <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {rows.map((c) => {
              const selected = chosen === c.id;
              const unavailable = c.unavailable != null;
              return (
                <label
                  key={c.id}
                  style={{
                    ...OPTION,
                    cursor: unavailable ? "default" : "pointer",
                    opacity: unavailable ? 0.6 : 1,
                    borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                    background: selected ? "var(--color-accent-soft)" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="replacement-candidate"
                    value={c.id}
                    checked={selected}
                    disabled={unavailable || isPending}
                    onChange={() => setChosen(c.id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ReplacementCopy
                      collectionId={collectionId}
                      collectionSlug={collectionSlug}
                      copy={c}
                      itemNo={c.itemNo}
                      thumbSize="4rem"
                    />
                    {c.unavailable && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                        {c.unavailable}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Saving…" : "Record replacement"}
        disabled={!chosen || isPending}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={submit}
      />
    </DialogShell>
  );
}
