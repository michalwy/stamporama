"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { OfferStateChip, NeedsActionChip } from "../offer-badges";
import { useOfferDetail, useOfferCopies, useInvalidateOffers } from "../use-offers-query";
import { DuplicateOfferDialog } from "../duplicate-offer-dialog";
import { ComposeSetDialog } from "./compose-set-dialog";
import { OfferSetsView } from "./offer-sets-view";
import { isTerminalState, manualTransitions, quickAdvanceTarget, requiresSets, type ManualOfferTarget } from "@/lib/offer-rules";
import type { OfferDetailSet } from "@/lib/offers";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueHeader } from "@/lib/issues";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const BTN: React.CSSProperties = {
  padding: "0.375rem 0.875rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const INLINE_INPUT: React.CSSProperties = {
  padding: "0.125rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const EDIT_CONTROL: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "0 0.125rem",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  fontSize: "0.75rem",
  lineHeight: 1,
};

const TRANSITION_LABEL: Record<string, { label: string; icon: string }> = {
  ready: { label: "Mark ready", icon: "✓" },
  preparing: { label: "Back to preparing", icon: "↩" },
  active: { label: "Resume", icon: "▶" },
  paused: { label: "Pause", icon: "⏸" },
  withdrawn: { label: "Withdraw", icon: "⇤" },
};

const QUICK_ADVANCE_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Label + icon for the one-click advance to `to` — publishing a `ready` offer reads "Activate";
 * marking a `preparing` one ready keeps the plain transition label. */
function advanceLabel(to: ManualOfferTarget): { label: string; icon: string } {
  return to === "active" ? { label: "Activate", icon: "▲" } : TRANSITION_LABEL[to];
}

interface OfferDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  offerId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
}

export function OfferDetailPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  offerId,
  areas,
  locations,
  issueHeaderById,
}: OfferDetailPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const skippedParam = Number(searchParams.get("skipped")) || 0;
  const { data: offer, isLoading } = useOfferDetail(collectionId, offerId);
  const { data: copies = [], isLoading: copiesLoading } = useOfferCopies(collectionId, offerId, true);
  const { invalidateAll } = useInvalidateOffers();
  const [composing, setComposing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [removeSet, setRemoveSet] = useState<OfferDetailSet | null>(null);
  const [confirm, setConfirm] = useState<"withdraw" | "delete" | null>(null);
  // A `?skipped=N` note (#200) lands here right after a duplicate; dismissible, and cleared from the
  // URL so a refresh doesn't resurrect it.
  const [skippedNote, setSkippedNote] = useState(skippedParam);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();

  if (isLoading || !offer) {
    return (
      <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        {isLoading ? "Loading offer…" : "Offer not found."}
      </div>
    );
  }

  const editable = !isTerminalState(offer.state);

  // One-click advance through the linear part of the lifecycle (#255), mirroring the offer row.
  // Only the unambiguous forward step is offered; a target that lists something needs ≥1 set.
  const advanceTo = editable ? quickAdvanceTarget(offer.state) : null;
  const canAdvance = advanceTo !== null && (!requiresSets(advanceTo) || offer.sets.length > 0);

  /** Patch a single header field in place, then refresh. */
  function patch(field: "price" | "url", value: string) {
    setActionError(undefined);
    startTransition(async () => {
      const { patchOfferAction } = await import("@/app/actions/offers");
      const result = await patchOfferAction(offerId, field, value);
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  function setState(next: ManualOfferTarget) {
    if (next === "withdrawn") {
      setConfirm("withdraw");
      return;
    }
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offerId, next);
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  const menuActions: RowAction[] = [
    ...manualTransitions(offer.state)
      .filter((s): s is ManualOfferTarget => s !== "sold")
      .map((s) => {
        // Publishing a ready offer reads "Activate"; resuming a paused one keeps "Resume".
        const activating = offer.state === "ready" && s === "active";
        return {
          key: s,
          label: activating ? "Activate" : TRANSITION_LABEL[s].label,
          icon: activating ? "▲" : TRANSITION_LABEL[s].icon,
          danger: s === "withdrawn",
          onSelect: () => setState(s),
        };
      }),
    { key: "duplicate", label: "List on another platform", icon: "⧉", onSelect: () => setDuplicating(true) },
    { key: "delete", label: "Delete", icon: "✕", danger: true, separatorBefore: true, onSelect: () => setConfirm("delete") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Skipped-copies note after a duplicate (#200): some copies had already sold and were left
          out of this clone. */}
      {skippedNote > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            background: "var(--color-bg-page)",
            padding: "0.625rem 1rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
          }}
        >
          <span style={{ flex: 1 }}>
            {skippedNote} cop{skippedNote === 1 ? "y" : "ies"} that had already sold elsewhere{" "}
            {skippedNote === 1 ? "was" : "were"} skipped when copying this offer.
          </span>
          <button
            type="button"
            onClick={() => setSkippedNote(0)}
            aria-label="Dismiss"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header summary card */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
          padding: "1.25rem 1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {offer.label}
          </h2>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>on {offer.platformName}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <OfferStateChip state={offer.state} />
            {canAdvance && advanceTo && (() => {
              const { label, icon } = advanceLabel(advanceTo);
              return (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setState(advanceTo)}
                  title={label}
                  aria-label={label}
                  style={QUICK_ADVANCE_BTN}
                >
                  <span aria-hidden>{icon}</span>
                  {label}
                </button>
              );
            })()}
            {offer.needsAction && (
              <NeedsActionChip soldCopyCount={offer.sets.filter((s) => s.needsAction).length} />
            )}
            <RowActionsMenu actions={menuActions} ariaLabel="Offer actions" />
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Currency — inherited from the platform and locked (#196), shown as a read-only chip. */}
          <span style={CHIP} title="Inherited from the platform — set it on the platform's contact">
            {offer.currency}
          </span>

          {/* Listing date (#257): when the listing went live, captured at creation. Read-only here —
              editable from the offer header form. Hidden when not recorded. */}
          {offer.listingDate && (
            <span style={CHIP} title="Listing date — when this listing went live">
              📅 {new Date(offer.listingDate).toISOString().slice(0, 10)}
            </span>
          )}

          {/* Listing URL — editable in any state, including sold/withdrawn, for record-keeping
              (#213). When a URL is set the link opens on click and a separate pencil edits it, so
              the click-to-open never gets hijacked by editing (#214). */}
          <InlineText
            value={offer.url ?? ""}
            placeholder="Add listing URL"
            display={
              offer.url ? (
                <a
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
                >
                  🔗 Listing
                </a>
              ) : (
                <span style={{ ...CHIP, color: "var(--color-text-muted)", cursor: "text" }}>Add listing URL</span>
              )
            }
            editable
            editControl={!!offer.url}
            editAriaLabel="Edit listing URL"
            isPending={isPending}
            inputType="url"
            onSave={(v) => patch("url", v)}
          />

          {/* Asking price + its suggestion, stacked on the right so the two read as one unit. */}
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              <InlineText
                value={offer.price === "0.00" ? "" : offer.price}
                placeholder="Set price"
                display={
                  offer.price === "0.00" ? (
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 500, fontSize: "0.8125rem", cursor: "text" }}>
                      No price yet
                    </span>
                  ) : (
                    <span style={{ cursor: "text" }}>{offer.price} {offer.currency}</span>
                  )
                }
                editable={editable}
                isPending={isPending}
                inputType="number"
                suffix={offer.currency}
                onSave={(v) => patch("price", v)}
              />
            </span>
            {offer.priceBase && (
              <span
                style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}
                title={`Converted to ${offer.baseCurrency} at the current rate`}
              >
                ≈ {offer.priceBase} {offer.baseCurrency}
              </span>
            )}
            {editable && offer.suggestedPrice && (
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "0.375rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <span title="Average catalog value per set, in this offer's currency">
                  💡 suggested {offer.suggestedPrice} {offer.currency}
                  {offer.suggestedUnpricedSets > 0 && ` · ${offer.suggestedUnpricedSets} set${offer.suggestedUnpricedSets === 1 ? "" : "s"} unpriced`}
                </span>
                {offer.price !== offer.suggestedPrice && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => patch("price", offer.suggestedPrice!)}
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      padding: "0.0625rem 0.375rem",
                      borderRadius: "0.375rem",
                      border: "1px solid var(--color-accent)",
                      color: "var(--color-accent)",
                      background: "var(--color-accent-soft)",
                      cursor: "pointer",
                    }}
                  >
                    Use
                  </button>
                )}
              </span>
            )}
          </div>
        </div>

        {offer.needsAction && (
          <p
            style={{
              margin: "0.75rem 0 0",
              padding: "0.625rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--color-error-border, var(--color-border))",
              background: "var(--color-error-soft, var(--color-bg-muted))",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            <strong style={{ color: "var(--color-error)" }}>Needs action:</strong> a copy in one or
            more sets below has sold elsewhere. Update the listing on the platform, then remove the
            affected set(s) here (or withdraw the offer).
          </p>
        )}
      </div>

      {/* Sets */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Sets{offer.sets.length > 0 ? ` (${offer.sets.length})` : ""}
        </h3>
        {editable && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setComposing(true)}
            style={{
              ...BTN,
              color: "#fff",
              fontWeight: 600,
              background: "var(--color-action-primary)",
              border: "none",
            }}
          >
            Add set
          </button>
        )}
      </div>

      <OfferSetsView
        collectionId={collectionId}
        sets={offer.sets}
        copies={copies}
        isLoading={copiesLoading}
        editable={editable}
        areas={areas}
        locations={locations}
        issueHeaderById={issueHeaderById}
        baseCurrency={baseCurrency}
        onRemoveSet={setRemoveSet}
      />

      {actionError && <p style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{actionError}</p>}

      {composing && (
        <ComposeSetDialog
          collectionId={collectionId}
          offerId={offerId}
          platformId={offer.platformId}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          onClose={() => setComposing(false)}
          onDone={() => {
            setComposing(false);
            invalidateAll(collectionId);
          }}
        />
      )}

      {duplicating && (
        <DuplicateOfferDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          source={{ id: offerId, label: offer.label, setCount: offer.sets.length, price: offer.price, currency: offer.currency }}
          onClose={() => setDuplicating(false)}
        />
      )}

      {removeSet && (
        <ConfirmDialog
          title="Remove set"
          message="This removes the set from the offer (its copies stay in your inventory). If the set sold elsewhere, remove the matching listing on the platform too."
          actionLabel="Remove set"
          pendingLabel="Removing…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setRemoveSet(null)}
          onConfirm={() => {
            const setId = removeSet.id;
            setActionError(undefined);
            startTransition(async () => {
              const { removeOfferSetAction } = await import("@/app/actions/offers");
              const result = await removeOfferSetAction(setId);
              if (result.status === "success") {
                setRemoveSet(null);
                invalidateAll(collectionId);
              } else setActionError(result.message);
            });
          }}
        />
      )}

      {confirm === "withdraw" && (
        <ConfirmDialog
          title="Withdraw offer"
          message="This takes the listing down on the platform. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
          actionLabel="Withdraw"
          pendingLabel="Withdrawing…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setConfirm(null)}
          onConfirm={() => {
            setActionError(undefined);
            startTransition(async () => {
              const { setOfferStateAction } = await import("@/app/actions/offers");
              const result = await setOfferStateAction(offerId, "withdrawn");
              if (result.status === "success") {
                setConfirm(null);
                invalidateAll(collectionId);
              } else setActionError(result.message);
            });
          }}
        />
      )}

      {confirm === "delete" && (
        <ConfirmDialog
          title="Delete offer"
          message="This permanently removes the offer and its sets. The copies stay in your inventory. This cannot be undone."
          actionLabel="Delete offer"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setConfirm(null)}
          onConfirm={() => {
            setActionError(undefined);
            startTransition(async () => {
              const { deleteOfferAction } = await import("@/app/actions/offers");
              const result = await deleteOfferAction(offerId);
              if (result.status === "success") {
                invalidateAll(collectionId);
                router.push(`/c/${collectionSlug}/offers`);
              } else setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}

/** A click-to-edit inline field: shows `display`, and on click swaps to an input that commits on
 * Enter / blur and reverts on Escape. Used for the offer's price and listing URL. When `editControl`
 * is set, the display is left interactive (e.g. a link that opens) and a separate pencil button
 * beside it enters edit mode, so the display's own click is never hijacked (#214). */
function InlineText({
  value,
  placeholder,
  display,
  editable,
  isPending,
  inputType,
  suffix,
  editControl = false,
  editAriaLabel = "Edit",
  onSave,
}: {
  value: string;
  placeholder: string;
  display: React.ReactNode;
  editable: boolean;
  isPending: boolean;
  inputType: "url" | "number" | "text";
  suffix?: string;
  editControl?: boolean;
  editAriaLabel?: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!editable) return <>{display}</>;

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  if (!editing) {
    if (editControl) {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          {display}
          <button
            type="button"
            onClick={startEditing}
            disabled={isPending}
            aria-label={editAriaLabel}
            title={editAriaLabel}
            style={EDIT_CONTROL}
          >
            ✎
          </button>
        </span>
      );
    }
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={startEditing}
        onKeyDown={(e) => {
          if (e.key === "Enter") startEditing();
        }}
        title="Click to edit"
        style={{ cursor: "text", display: "inline-flex", alignItems: "center" }}
      >
        {display}
      </span>
    );
  }

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      <input
        autoFocus
        type={inputType}
        value={draft}
        placeholder={placeholder}
        disabled={isPending}
        min={inputType === "number" ? "0" : undefined}
        step={inputType === "number" ? "0.01" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        style={{ ...INLINE_INPUT, width: inputType === "url" ? "16rem" : "6rem", textAlign: inputType === "number" ? "right" : "left" }}
      />
      {suffix && <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{suffix}</span>}
    </span>
  );
}
