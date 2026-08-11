"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { DialogShell, DialogBody, DialogFooter, DialogSecondaryButton } from "@/app/dialog-shell";
import { formatItemNo } from "@/lib/item-number";
import { narrowConditionSeed, type ArrivingCopy } from "@/lib/want-rules";
import type { WantAcceptanceInput, WantListItem, WantMatchForCopy } from "@/lib/wants";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useCollectionItemNoPad } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { WantAcceptanceFields } from "./want-acceptance-fields";
import { useInvalidateWants } from "./use-wants-query";

// The intake review (#532; ADR-0032 §7): the open wants the copies just taken in could satisfy,
// with **close / narrow / leave open** per want.
//
// Nothing here happens on its own. Auto-closing would silently discard a record of intent, and the
// common case — the want was "anything", a used copy arrived, so it becomes "any mint" — is a
// judgement the app cannot make, because nothing in the condition dictionary says which conditions
// are better. Dismissing the dialog leaves every want exactly as it was, which is why it closes with
// *Done* rather than with Cancel/Save: there is nothing staged to discard.

type RowState = "pending" | "closed" | "narrowed" | "left-open";

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const BUTTON: React.CSSProperties = {
  padding: "0.3125rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

/** Above this dialog's panel, so an acceptance menu opened inside it paints in front of it. */
const MENU_Z_INDEX = 200;

/** How a want reads in the review: what it will take, in the axis order the list row uses. An axis
 *  with nothing on it is stated as "any" rather than left out — a silent axis reads as a narrow
 *  one, which is the opposite of what an empty set means (ADR-0032 §1). */
function acceptanceSummary(
  want: WantListItem,
  name: {
    condition: (id: string) => string;
    certificate: (id: string | null) => string;
    format: (id: string | null) => string;
  }
): string {
  const conditions =
    want.conditionIds.length === 0
      ? "any condition"
      : want.conditionIds.map(name.condition).join(", ");
  const certificate =
    want.certificateStatusIds.length === 0
      ? "certificate: any"
      : want.certificateStatusIds.map(name.certificate).join(", ");
  const format =
    want.formatIds.length === 0 ? "any format" : want.formatIds.map(name.format).join(", ");
  return `Takes ${conditions} · ${certificate} · ${format}`;
}

export function WantReviewDialog({
  collectionId,
  copies,
  matches,
  onClose,
}: {
  collectionId: string;
  /** The copies just taken in, so a want can be shown beside the copy that raised it. */
  copies: ArrivingCopy[];
  matches: WantMatchForCopy[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [narrowing, setNarrowing] = useState<Record<string, WantAcceptanceInput>>({});
  const [error, setError] = useState<string | undefined>();
  // An acceptance menu is a popover, not an escape layer (#361): while one is open this dialog must
  // stop dismissing itself, or one Escape closes both.
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);
  const itemNoPad = useCollectionItemNoPad(collectionId);
  const { invalidate } = useInvalidateWants();

  // The list is refreshed once, on the way out: the wants screen may well be behind this dialog,
  // and a per-click invalidation would redraw it under the collector's hands.
  useEffect(
    () => () => {
      void invalidate(collectionId);
    },
    [collectionId, invalidate]
  );

  const copyByItemId = useMemo(() => new Map(copies.map((c) => [c.itemId, c])), [copies]);
  const conditionName = (id: string) => {
    const c = (conditions ?? []).find((x) => x.id === id);
    return c ? c.abbreviation || c.name : "?";
  };
  const axisNames = {
    condition: conditionName,
    // `null` is the axis's own "none" value, never "any" — see ADR-0032 §3.
    certificate: (id: string | null) =>
      id === null
        ? "no certificate"
        : ((certificateStatuses ?? []).find((c) => c.id === id)?.name ?? "?"),
    format: (id: string | null) =>
      id === null ? "single" : ((formats ?? []).find((f) => f.id === id)?.name ?? "?"),
  };

  /** One want may be raised by several arriving copies; it is shown once, under the first. */
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return matches.filter((m) => {
      if (seen.has(m.want.id)) return false;
      seen.add(m.want.id);
      return true;
    });
  }, [matches]);

  function run(wantId: string, next: RowState, mutate: () => Promise<{ status: string; message?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await mutate();
      if (result.status === "success") {
        setStates((s) => ({ ...s, [wantId]: next }));
      } else {
        setError(result.message ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <DialogShell
      title={rows.length === 1 ? "A want this copy could satisfy" : "Wants these copies could satisfy"}
      onClose={onClose}
      maxWidth="36rem"
      dismissable={!menuOpen}
    >
      <DialogBody>
        <p style={{ ...MUTED, margin: "0 0 1rem" }}>
          Nothing is closed automatically. Close a want that is now met, narrow one that is only
          partly met — a used copy against a want for “anything” leaves you looking for a mint one —
          or leave it open.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {rows.map(({ itemId, want }) => {
            const copy = copyByItemId.get(itemId);
            const state = states[want.id] ?? "pending";
            const seed = narrowing[want.id];

            return (
              <div key={want.id} style={CARD}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: "0.875rem" }}>
                    {want.stampName ?? "(unnamed stamp)"}
                  </strong>
                  {copy && (
                    <span style={MUTED}>
                      matched by {formatItemNo(copy.itemNo, itemNoPad)} ·{" "}
                      {conditionName(copy.conditionId)}
                    </span>
                  )}
                </div>
                <span style={MUTED}>{acceptanceSummary(want, axisNames)}</span>

                {state === "closed" && (
                  <span style={{ fontSize: "0.8125rem", color: "var(--color-accent)" }}>
                    Closed. It stays on the list under <em>Closed</em>, and can be reopened.
                  </span>
                )}
                {state === "narrowed" && (
                  <span style={{ fontSize: "0.8125rem", color: "var(--color-accent)" }}>
                    Narrowed. The want stays open, now looking for something else.
                  </span>
                )}
                {state === "left-open" && <span style={MUTED}>Left open.</span>}

                {state === "pending" && !seed && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={BUTTON}
                      disabled={isPending}
                      onClick={() =>
                        run(want.id, "closed", async () => {
                          const { closeWantAction } = await import("@/app/actions/wants");
                          return closeWantAction(want.id);
                        })
                      }
                    >
                      Close want
                    </button>
                    <button
                      type="button"
                      style={BUTTON}
                      disabled={isPending || !copy}
                      onClick={() =>
                        copy &&
                        setNarrowing((n) => ({
                          ...n,
                          [want.id]: {
                            // The one step that is certainly right: the condition that just arrived
                            // is no longer wanted. Everything else is left for the collector.
                            conditionIds: narrowConditionSeed(
                              (conditions ?? []).map((c) => c.id),
                              copy.conditionId,
                              want.conditionIds
                            ),
                            certificateStatusIds: want.certificateStatusIds,
                            formatIds: want.formatIds,
                          },
                        }))
                      }
                    >
                      Narrow it…
                    </button>
                    <button
                      type="button"
                      style={{ ...BUTTON, border: "none", background: "transparent", color: "var(--color-text-muted)" }}
                      disabled={isPending}
                      // Writes nothing — it only takes the row out of the way, which is the point:
                      // leaving a want open is the default, and saying so should cost one click,
                      // not a change to the record.
                      onClick={() => setStates((s) => ({ ...s, [want.id]: "left-open" }))}
                    >
                      Leave open
                    </button>
                  </div>
                )}

                {state === "pending" && seed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <WantAcceptanceFields
                      collectionId={collectionId}
                      value={seed}
                      onChange={(next) => setNarrowing((n) => ({ ...n, [want.id]: next }))}
                      disabled={isPending}
                      menuZIndex={MENU_Z_INDEX}
                      onPopoverOpenChange={setMenuOpen}
                    />
                    <p style={{ ...MUTED, margin: 0 }}>
                      Suggested: everything except the condition that just arrived. Nothing is saved
                      until you press Save.
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button"
                        style={BUTTON}
                        disabled={isPending}
                        onClick={() =>
                          run(want.id, "narrowed", async () => {
                            const { narrowWantAction } = await import("@/app/actions/wants");
                            return narrowWantAction(want.id, seed);
                          })
                        }
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        style={{ ...BUTTON, border: "none", background: "transparent", color: "var(--color-text-muted)" }}
                        disabled={isPending}
                        onClick={() =>
                          setNarrowing((n) => {
                            const next = { ...n };
                            delete next[want.id];
                            return next;
                          })
                        }
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <p style={{ margin: "1rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Done
        </DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>
  );
}
