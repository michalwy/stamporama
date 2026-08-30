"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { ListedVariantOption } from "@/lib/listing-variant-choice";

/**
 * Choosing by hand which variant an offer lists an unknown-variant umbrella under (extends #616).
 *
 * #616 derives that entry from the price rollup and stores nothing, which is the right default and
 * cannot be the only answer: a collector may be able to rule a variant out from the piece in front of
 * them, may prefer the one that is actually being traded, and may not want to price a whole tree
 * (#617) to post a single offer. This is where they say so.
 *
 * It is a **list of one tree, not a form**: rows are the umbrella's variants indented as the price
 * grid draws them (#618), pressing one records it and closes. There is no Save, the same argument
 * that put one write per cell in that grid — a single choice has nothing to reconcile, and a Save
 * over one radio is a second press to say what the first already said.
 *
 * The first row is **automatic**, and it names what automatic *means today* rather than merely
 * offering it: the variant the rollup picks, or, where it picks nothing, which of #617's two gaps is
 * in the way. That is the whole comparison the collector is making — a choice is only worth recording
 * against a default you can see — and it is what makes "back to automatic" a visible option rather
 * than an empty state to guess at.
 *
 * Every variant is selectable, including one carrying **no item-ID**: choosing it still refuses the
 * listing (#405), but against the variant the collector picked, whose `⚡ Link` is on the card behind
 * this dialog. Requiring a match first would mean not being able to say what you want to sell until
 * you had already gone and matched it. The same goes for a variant that is itself an umbrella — a
 * coarser claim, so it is marked, not withheld.
 *
 * What the dialog cannot do is move the **valuation**. The copy goes on being valued at the rollup's
 * lowest-variant figure, because what a stamp is worth is a fact about the stamp; the footnote says
 * so, since #616's promise that a listing and its value never drift apart was a property of a
 * derivation and cannot survive a choice.
 */
export function ListedVariantDialog({
  offerId,
  stampId,
  conditionId,
  onClose,
  onSaved,
}: {
  offerId: string;
  stampId: string;
  conditionId: string;
  onClose: () => void;
  /** Called once a choice was actually written — the card's rows, its blockers and the offer's texts
   *  all read it, so the whole offer is stale then. */
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [pending, setPending] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["listedVariantChoice", offerId, stampId, conditionId] as const,
    queryFn: async () => {
      const { getOfferListedVariantChoiceAction } = await import(
        "@/app/actions/listing-variant-choice"
      );
      const r = await getOfferListedVariantChoiceAction(offerId, stampId, conditionId);
      if (r.status === "error") throw new Error(r.message);
      return r.choice;
    },
    staleTime: 0,
    gcTime: 0,
  });

  const choose = (variantStampId: string | null) => {
    setError(null);
    setPending(variantStampId ?? AUTOMATIC);
    startSaving(async () => {
      const { setOfferListedVariantAction } = await import("@/app/actions/listing-variant-choice");
      const r = await setOfferListedVariantAction(offerId, stampId, conditionId, variantStampId);
      setPending(null);
      if (r.status === "error") {
        setError(r.message);
        return;
      }
      onSaved();
      onClose();
    });
  };

  const heading = data
    ? `${data.stampLabel}${data.stampName ? ` · ${data.stampName}` : ""} — ${data.conditionName}`
    : null;

  // Portalled to the document, the way every dialog that can be opened **from inside another
  // dialog** is: a fixed-position panel inside one of `DialogShell`'s own panels is positioned
  // against that panel — the shell centres itself with a transform, which makes it the containing
  // block — and clipped by its `overflow: hidden`. The listing wizard (#730) opens this one from its
  // first step, and the surfaces that opened it before are unaffected: the panel is fixed either way.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell title="Listed as" onClose={isSaving ? () => {} : onClose} maxWidth="min(40rem, 95vw)">
      <DialogBody>
        {isLoading ? (
          <p style={MUTED}>Loading…</p>
        ) : loadError ? (
          <p style={{ ...MUTED, color: "var(--color-error)" }}>
            {loadError instanceof Error ? loadError.message : "Failed to load the variants."}
          </p>
        ) : data ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={{ ...MUTED, margin: 0 }}>{heading}</p>

            <ul style={LIST}>
              {/* Automatic leads, and states what it currently resolves to. A default you cannot see
                  is a default nobody can decide against. */}
              <OptionRow
                selected={data.chosenStampId === null}
                busy={pending === AUTOMATIC}
                disabled={isSaving}
                onSelect={() => choose(null)}
                title="Automatic — the cheapest variant"
                subtitle={
                  data.automaticLabel
                    ? `Currently ${data.automaticLabel}, and it follows the catalog prices as they change.`
                    : data.automaticGap === "unpriced-variants"
                      ? "Nothing yet: some variant carries no catalog price, so which one is cheapest is not known."
                      : data.automaticGap === "unmatched-variant"
                        ? "The cheapest variant has no item-ID on this platform, so the listing is refused."
                        : "Nothing to derive from this tree."
                }
              />
              {data.options.map((option) => (
                <OptionRow
                  key={option.stampId}
                  selected={data.chosenStampId === option.stampId}
                  busy={pending === option.stampId}
                  disabled={isSaving}
                  onSelect={() => choose(option.stampId)}
                  indent={option.depth - 1}
                  title={option.label}
                  subtitle={option.name}
                  option={option}
                />
              ))}
            </ul>

            {error && (
              <p style={{ ...MUTED, color: "var(--color-error)", margin: 0 }}>{error}</p>
            )}

            {/* The one consequence that is not visible in the list above. */}
            <p style={{ ...MUTED, margin: 0 }}>
              A choice applies to this offer only, and nothing is recorded on the stamp. The copy&apos;s
              catalog value goes on following the cheapest variant either way — what it is sold as and
              what it is worth are two different questions once you answer the first by hand.
            </p>
          </div>
        ) : null}
      </DialogBody>
    </DialogShell>,
    document.body
  );
}

/** The sentinel `pending` carries while the automatic row is being written — it has no stamp id of
 *  its own, and `null` there would be indistinguishable from "nothing in flight". */
const AUTOMATIC = "\u0000automatic";

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const LIST: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border-strong)",
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

/** One selectable line. The whole row is the control — a radio beside a label is two targets for one
 *  decision, and the rows are being compared, not filled in. */
function OptionRow({
  selected,
  busy,
  disabled,
  onSelect,
  title,
  subtitle,
  indent = 0,
  option,
}: {
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string | null;
  indent?: number;
  option?: ListedVariantOption;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={selected}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          width: "100%",
          textAlign: "left",
          fontFamily: "inherit",
          padding: "0.5rem 0.75rem",
          paddingLeft: `${0.75 + indent * 1.25}rem`,
          borderRadius: "0.5rem",
          border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
          background: selected ? "var(--color-bg-page)" : "transparent",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled && !busy ? 0.6 : 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "1rem",
            flexShrink: 0,
            color: selected ? "var(--color-accent)" : "var(--color-text-muted)",
          }}
        >
          {selected ? <Icon name="check" size="sm" /> : null}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {title}
            {option?.automatic && (
              <Tooltip content="This is the variant the automatic answer picks — the cheapest one at this condition.">
                <span style={CHIP}>cheapest</span>
              </Tooltip>
            )}
            {option?.umbrella && (
              <Tooltip content="This variant has variants of its own, so listing under it is still a partly unidentified claim.">
                <span style={CHIP}>has variants</span>
              </Tooltip>
            )}
            {option && !option.matched && (
              <Tooltip content="No item-ID on this platform yet. Choosing it is allowed — the offer stays blocked until it is matched, and the card offers ⚡ Link for it.">
                <span
                  style={{
                    ...CHIP,
                    color: "var(--color-warning)",
                    borderColor: "var(--color-warning-border, var(--color-warning))",
                  }}
                >
                  no item-ID
                </span>
              </Tooltip>
            )}
            {busy && <span style={MUTED}>saving…</span>}
          </span>
          {(subtitle || option) && (
            <span style={{ ...MUTED, display: "flex", gap: "0.5rem" }}>
              {subtitle && <span>{subtitle}</span>}
              {option && (
                <span>
                  {option.price
                    ? `${option.price} ${option.currency ?? ""}`.trim()
                    : "no catalog price"}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
