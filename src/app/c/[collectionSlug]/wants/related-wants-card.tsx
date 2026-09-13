"use client";

import { useState, useTransition } from "react";
import type { WantListItem } from "@/lib/wants";
import { WANT_PRIORITY_CHIP, WANT_PRIORITY_LABEL } from "@/lib/want-rules";
import { ConfirmDialog } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useWantsInfinite } from "./use-wants-query";
import { useInvalidateWantSignals } from "./use-invalidate-want-signals";

// The Wants card of the stamp and copy detail screens (#532, on #518's shape; on the copy's screen
// since #1236). What you are looking for of *this* stamp, on what terms — the question the catalogue
// page cannot otherwise answer, and the one that says why a stamp you already hold is still on a
// list somewhere.
//
// It **settles** a want but does not **edit** one (#1236). Reading a copy is often exactly when a
// want turns out to be done with, so each row's `⋮` closes it or deletes it in place — two single
// acts on a related record, the way the Variants card acts on the stamps under a stamp. Changing
// what would satisfy a want stays on the want list, where the whole form is, so a detail page still
// reads rather than becoming a second editor. Reopening stays there too: a closed want here is the
// record that it was met, not a thing to undo from a catalogue page.

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  fontSize: "0.75rem",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

/** One axis as text: the members joined, or `anyLabel` when the set is empty — the want list row's
 *  own rule, so a want reads the same on both screens. An empty axis says "any" out loud, because a
 *  blank one and an unanswered one look identical and mean opposite things (ADR-0032 §1). */
function axisText(
  ids: (string | null)[],
  nameFor: (id: string | null) => string,
  anyLabel: string
): string {
  return ids.length === 0 ? anyLabel : ids.map(nameFor).join(", ");
}

function WantCardRow({
  want,
  names,
  actions,
  isLast,
}: {
  want: WantListItem;
  names: {
    condition: (id: string | null) => string;
    certificate: (id: string | null) => string;
    format: (id: string | null) => string;
  };
  actions: RowAction[];
  isLast: boolean;
}) {
  const open = want.closedAt === null;
  const priority = WANT_PRIORITY_CHIP[want.priority];

  return (
    <div
      style={{
        padding: "0.625rem 0.875rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.5rem",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        <div
          style={{
            display: "flex",
            gap: "0.375rem",
            flexWrap: "wrap",
            alignItems: "center",
            opacity: open ? 1 : 0.6,
          }}
        >
          <span style={CHIP}>{axisText(want.conditionIds, names.condition, "Any condition")}</span>
          <span style={CHIP}>
            {axisText(want.certificateStatusIds, names.certificate, "Certificate: any")}
          </span>
          <span style={CHIP}>{axisText(want.formatIds, names.format, "Any format")}</span>
          <span
            style={{
              ...CHIP,
              ...priority,
              border: `1px solid ${priority.border}`,
              fontWeight: want.priority === "high" ? 600 : 400,
            }}
          >
            {WANT_PRIORITY_LABEL[want.priority]}
          </span>
          {!open && (
            <Tooltip content="Closed — you decided this want was met. It can be reopened from the want list.">
              <span style={CHIP}>Closed</span>
            </Tooltip>
          )}
        </div>
        {want.notes && (
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{want.notes}</span>
        )}
      </div>
      <RowActionsMenu ariaLabel="Want actions" actions={actions} />
    </div>
  );
}

/**
 * Every want recorded for this stamp, open ones first (the list's own order).
 *
 * Closed wants are shown too, faded: on a *list* they are noise, but on the one stamp they are the
 * record that this was looked for and found, which is exactly the sort of thing a catalogue page is
 * opened to check.
 *
 * The card is **absent when there is nothing on it** — the exception when it was written (#532),
 * and since #536 the rule every card on these screens follows: a heading saying "you are not
 * looking for this" answers a question nobody asked. It stays hidden while loading too, so it
 * appears once rather than flashing an empty state first.
 *
 * Both acts refresh every surface the want chip is drawn on (`useInvalidateWantSignals`), not only
 * this card: the collector will go back to the list the page was opened from, and a chip still lit
 * there would contradict what was just done.
 */
export function RelatedWantsCard({
  collectionId,
  stampId,
}: {
  collectionId: string;
  stampId: string;
}) {
  const { data, isLoading } = useWantsInfinite(collectionId, { stampId, status: "all" });
  const wants = (data?.pages ?? []).flatMap((p) => p.items);

  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  const { invalidateWantSignals } = useInvalidateWantSignals();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<WantListItem | null>(null);
  // A close has no dialog to show its failure in, so the card says it; a delete's failure stays in
  // the confirmation, where the collector is still looking.
  const [closeError, setCloseError] = useState<string | undefined>();
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const names = {
    condition: (id: string | null) => {
      const c = (conditions ?? []).find((x) => x.id === id);
      return c ? c.abbreviation || c.name : "?";
    },
    // `null` is each axis's own "none" value, never "any" — ADR-0032 §3.
    certificate: (id: string | null) =>
      id === null
        ? "No certificate"
        : ((certificateStatuses ?? []).find((c) => c.id === id)?.name ?? "?"),
    format: (id: string | null) =>
      id === null ? "Single" : ((formats ?? []).find((f) => f.id === id)?.name ?? "?"),
  };

  function close(want: WantListItem) {
    setCloseError(undefined);
    startTransition(async () => {
      const { closeWantAction } = await import("@/app/actions/wants");
      const result = await closeWantAction(want.id);
      if (result.status === "error") {
        setCloseError(result.message);
        return;
      }
      void invalidateWantSignals(collectionId);
      toast({ message: "Want closed" });
    });
  }

  function confirmDelete(want: WantListItem) {
    setDeleteError(undefined);
    startTransition(async () => {
      const { deleteWantAction } = await import("@/app/actions/wants");
      const result = await deleteWantAction(want.id);
      if (result.status === "error") {
        setDeleteError(result.message);
        return;
      }
      setDeleting(null);
      void invalidateWantSignals(collectionId);
      toast({ message: "Want deleted" });
    });
  }

  /** Close only while the want is open — a closed one is reopened from the want list, if at all.
   *  Delete always, set apart and in the error colour, so the act that keeps history and the act
   *  that does not can never be taken for one another. */
  function actionsFor(want: WantListItem): RowAction[] {
    const open = want.closedAt === null;
    const actions: RowAction[] = [];
    if (open) {
      actions.push({
        key: "close",
        label: "Close want",
        icon: "check",
        disabled: isPending,
        onSelect: () => close(want),
      });
    }
    actions.push({
      key: "delete",
      label: "Delete want",
      icon: "delete",
      danger: true,
      separatorBefore: open,
      disabled: isPending,
      onSelect: () => {
        setDeleteError(undefined);
        setDeleting(want);
      },
    });
    return actions;
  }

  const openCount = wants.filter((w) => w.closedAt === null).length;

  return (
    <>
      <DetailCard title="Wants" count={openCount || null} empty={isLoading || wants.length === 0}>
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            overflow: "clip",
            background: "var(--color-bg-elevated)",
          }}
        >
          {wants.map((want, i) => (
            <WantCardRow
              key={want.id}
              want={want}
              names={names}
              actions={actionsFor(want)}
              isLast={i === wants.length - 1}
            />
          ))}
        </div>
        {closeError && (
          <div
            role="alert"
            style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-error)" }}
          >
            {closeError}
          </div>
        )}
      </DetailCard>

      {deleting && (
        <ConfirmDialog
          title="Delete want"
          message="Permanently delete this want? This cannot be undone. Closing it instead keeps the record that you were looking for it."
          actionLabel="Delete want"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={deleteError}
          onClose={() => {
            if (!isPending) setDeleting(null);
          }}
          onConfirm={() => confirmDelete(deleting)}
        />
      )}
    </>
  );
}
