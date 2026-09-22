"use client";

import { useMemo, useState, useTransition } from "react";
import type { GeneratorCombinationPart, GeneratorLineView, GeneratorOfferRef } from "@/lib/offer-generator";
import {
  generatorRequestParams,
  type GeneratorMode,
  type GeneratorPackaging,
} from "@/lib/offer-generator-rules";
import { OFFER_STATE_LABEL, type OfferState } from "@/lib/offer-rules";
import { formatItemNo } from "@/lib/item-number";
import { formatEntityNo } from "@/lib/quick-jump";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { ROW_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CertificateStatusChip, ConditionChip } from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Callout, Empty, SkeletonBlock } from "@/app/c/[collectionSlug]/offers/lot-builder/lot-builder-chrome";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { useOfferGeneratorPreview } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { useCollectionItemNoPad } from "./use-inventory-query";
import { PhotoThumb } from "./photo-thumb";

// Generating offers in bulk (#1287): quick offer mode's platform and status (#537), applied to every
// copy the collector can see in one pass instead of one click per offer. The dialog asks the two
// questions the pass needs — complete series or singles, one multi-quantity offer or an offer per set —
// and shows the whole plan before anything is written: every offer on one line, new or added to an
// existing one (#1368), its copies a click away, and the copies left out and why. Confirming sends the plan
// back only to be compared with a fresh one (#717).

/** Which copies the pass is over: the ticked ones in view, or everything the list's filters show. */
export type OfferGeneratorInput =
  | { kind: "ticked"; itemIds: string[] }
  | { kind: "filtered"; filters: string };

export interface OfferGeneratorOutcome {
  createdOffers: number;
  changedOffers: number;
}

const MODES: { value: GeneratorMode; label: string; hint: string }[] = [
  {
    value: "checklists",
    label: "Complete sets",
    hint: "Every complete checklist, in one condition, certificate and format, becomes one set.",
  },
  {
    value: "singles",
    label: "Singles",
    hint: "Every copy left once the complete sets are taken out becomes a set of its own.",
  },
];

const PACKAGINGS: { value: GeneratorPackaging; label: string; hint: string }[] = [
  {
    value: "multi",
    label: "Multi-quantity",
    hint: "Identical sets share one offer — added to an existing offer where one already lists them.",
  },
  {
    value: "separate",
    label: "Separate offers",
    hint: "Every set gets a new offer of its own, even where a similar offer already exists.",
  },
];

const FIELDSET: React.CSSProperties = {
  border: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  minWidth: 0,
};

const LEGEND: React.CSSProperties = {
  padding: 0,
  marginBottom: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const OPTION: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const HINT: React.CSSProperties = { fontSize: "0.75rem", color: "var(--color-text-secondary)" };

// Fixed columns, so fifty lines read as a table: toggle, name, combination, catalogue, quantity,
// outcome (#1368).
const LINE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.25rem minmax(0, 1fr) 8rem minmax(0, 14rem) 2.5rem 13rem",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.375rem 0.75rem",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const CELL: React.CSSProperties = {
  display: "block",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const TOGGLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.25rem",
  height: "1.25rem",
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const SELECT: React.CSSProperties = {
  maxWidth: "100%",
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function OfferGeneratorDialog({
  collectionId,
  platformId,
  platformName,
  state,
  input,
  onClose,
  onDone,
}: {
  collectionId: string;
  platformId: string;
  platformName: string;
  state: OfferState;
  input: OfferGeneratorInput;
  onClose: () => void;
  onDone: (outcome: OfferGeneratorOutcome) => void;
}) {
  const [mode, setMode] = useState<GeneratorMode>("checklists");
  const [packaging, setPackaging] = useState<GeneratorPackaging>("multi");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const pad = useCollectionItemNoPad(collectionId);

  const query = useMemo(
    () =>
      generatorRequestParams({
        platformId,
        state,
        mode,
        packaging,
        itemIds: input.kind === "ticked" ? input.itemIds : null,
        filters: input.kind === "filtered" ? input.filters : "",
        targets,
      }).toString(),
    [platformId, state, mode, packaging, input, targets]
  );
  const { data: preview, isLoading, isError } = useOfferGeneratorPreview(collectionId, query);

  const { newOffers = 0, changedOffers = 0 } = preview?.totals ?? {};
  const canConfirm = !!preview && preview.lines.length > 0 && !preview.creationBlock && !isPending;
  const actionLabel =
    changedOffers > 0 && newOffers > 0
      ? `Create ${plural(newOffers, "offer", "offers")}, add to ${changedOffers}`
      : changedOffers > 0
        ? `Add to ${plural(changedOffers, "offer", "offers")}`
        : `Create ${plural(newOffers, "offer", "offers")}`;

  function confirm() {
    if (!preview) return;
    setError(undefined);
    const shown = preview.fingerprint;
    startTransition(async () => {
      const { generateOffersAction } = await import("@/app/actions/offers");
      const result = await generateOffersAction(collectionId, query, shown);
      if (result.status === "success") {
        onDone({ createdOffers: result.createdOffers, changedOffers: result.changedOffers });
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <DialogShell
      title={`Generate offers on ${platformName}`}
      onClose={() => {
        if (!isPending) onClose();
      }}
      maxWidth="60rem"
      height="85vh"
    >
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ ...HINT, fontSize: "0.8125rem" }}>
            From{" "}
            {input.kind === "ticked"
              ? `the ${plural(input.itemIds.length, "ticked copy", "ticked copies")} in view`
              : "the copies the list's filters show"}
            , as <strong>{OFFER_STATE_LABEL[state]}</strong> offers with no asking price and no listing URL — the
            same as quick offer mode.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
            <fieldset style={FIELDSET}>
              <legend style={LEGEND}>What to list</legend>
              {MODES.map((option) => (
                <label key={option.value} style={OPTION}>
                  <input
                    type="radio"
                    name="generator-mode"
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    disabled={isPending}
                  />
                  <span>
                    {option.label} <span style={HINT}>— {option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset style={FIELDSET}>
              <legend style={LEGEND}>How to pack identical sets</legend>
              {PACKAGINGS.map((option) => (
                <label key={option.value} style={OPTION}>
                  <input
                    type="radio"
                    name="generator-packaging"
                    checked={packaging === option.value}
                    onChange={() => setPackaging(option.value)}
                    disabled={isPending}
                  />
                  <span>
                    {option.label} <span style={HINT}>— {option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          {isLoading ? (
            <SkeletonBlock style={{ height: "12rem" }} />
          ) : isError || !preview ? (
            <Callout tone="warning">The offers could not be planned. Close the dialog and try again.</Callout>
          ) : (
            <>
              <Summary preview={preview} mode={mode} />
              {preview.creationBlock && <Callout tone="warning">{preview.creationBlock}</Callout>}
              {preview.lines.length === 0 ? (
                <Empty>
                  {mode === "checklists"
                    ? "None of these copies completes a set in one condition, certificate and format."
                    : "Every one of these copies belongs to a complete set — generate the complete sets instead."}
                </Empty>
              ) : (
                <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.5rem", overflow: "clip" }}>
                  {preview.lines.map((line, index) => (
                    <Line
                      key={line.id}
                      collectionId={collectionId}
                      line={line}
                      first={index === 0}
                      pad={pad}
                      disabled={isPending}
                      onChooseTarget={(offerId) => setTargets((prev) => ({ ...prev, [line.id]: offerId }))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Generating…" : actionLabel}
        disabled={!canConfirm}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={confirm}
      />
    </DialogShell>
  );
}

function Summary({
  preview,
  mode,
}: {
  preview: NonNullable<ReturnType<typeof useOfferGeneratorPreview>["data"]>;
  mode: GeneratorMode;
}) {
  const { totals, skipped, otherModeCopies } = preview;
  const skippedCount = skipped.reduce((n, entry) => n + entry.count, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", fontSize: "0.8125rem" }}>
      <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
        {plural(totals.newOffers, "new offer", "new offers")}
        {totals.changedOffers > 0 && `, ${plural(totals.changedOffers, "existing offer", "existing offers")} receiving sets`}
        {" · "}
        {plural(totals.sets, "set", "sets")} · {plural(totals.copies, "copy", "copies")}
      </div>
      {skippedCount > 0 && (
        <div style={HINT}>
          {plural(skippedCount, "copy", "copies")} of the {preview.askedCopies} left out:{" "}
          {skipped.map((entry) => `${entry.count} ${entry.label}`).join("; ")}.
        </div>
      )}
      {otherModeCopies > 0 && (
        <div style={HINT}>
          {mode === "checklists"
            ? `${plural(otherModeCopies, "copy completes", "copies complete")} no set here and ${otherModeCopies === 1 ? "is" : "are"} left for Singles.`
            : `${plural(otherModeCopies, "copy belongs", "copies belong")} to complete sets and ${otherModeCopies === 1 ? "is" : "are"} left for Complete sets.`}
        </div>
      )}
    </div>
  );
}

function offerOption(offer: GeneratorOfferRef): string {
  return `${formatEntityNo(offer.offerNo)} ${offer.label} (${OFFER_STATE_LABEL[offer.state]})`;
}

/** One proposed offer on one line (#1368): the name once, the combination short, what a set is by
 * catalogue number, the quantity and the outcome — collapsed, so fifty offers read as fifty lines.
 * Expanding it shows the copies with their photos and numbers, to check a set against the desk. */
function Line({
  collectionId,
  line,
  first,
  pad,
  disabled,
  onChooseTarget,
}: {
  collectionId: string;
  line: GeneratorLineView;
  first: boolean;
  pad: number;
  disabled: boolean;
  onChooseTarget: (offerId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const targetId = line.target.kind === "existing" ? line.target.offerId : null;
  const target = line.matches.find((offer) => offer.offerId === targetId) ?? null;
  const name = line.subtitle ? `${line.title} — ${line.subtitle}` : line.title;
  const catalog = line.variantLabels.length > 0 ? `${line.catalog}, with ${line.variantLabels.join(", ")}` : line.catalog;
  return (
    <div style={first ? undefined : { borderTop: "1px solid var(--color-border)" }}>
      <div style={LINE} onClick={() => setOpen((o) => !o)}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the copies of ${line.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          style={TOGGLE}
        >
          <Icon name={open ? "collapse" : "expand"} size="sm" />
        </button>
        <Tooltip content={name} style={CELL}>
          <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{line.title}</span>
          {line.subtitle && <span style={HINT}> — {line.subtitle}</span>}
        </Tooltip>
        <span style={{ display: "inline-flex", gap: "0.2rem", minWidth: 0, overflow: "hidden" }}>
          {line.kind === "carrier" && <span style={ROW_CHIP}>Several stamps</span>}
          {line.combination.map((part) => (
            <CombinationChip key={part.axis} collectionId={collectionId} part={part} />
          ))}
        </span>
        <Tooltip content={catalog} style={{ ...CELL, fontVariantNumeric: "tabular-nums" }}>
          {line.catalog}
          {line.variantLabels.length > 0 && <span style={HINT}>, with {line.variantLabels.join(", ")}</span>}
        </Tooltip>
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}>
          {line.sets.length > 1 ? `×${line.sets.length}` : ""}
        </span>
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", minWidth: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {target ? (
            line.matches.length > 1 ? (
              <>
                <span style={{ flexShrink: 0 }}>Add to</span>
                <select
                  value={target.offerId}
                  onChange={(e) => onChooseTarget(e.target.value)}
                  disabled={disabled}
                  aria-label={`Offer receiving ${line.title}`}
                  style={{ ...SELECT, flex: 1, minWidth: 0 }}
                >
                  {line.matches.map((offer) => (
                    <option key={offer.offerId} value={offer.offerId}>
                      {offerOption(offer)}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <Tooltip content={`${target.label} — it will then have ${plural(line.resultingSetCount, "set", "sets")}.`}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                  Added to {formatEntityNo(target.offerNo)} <OfferStateChip state={target.state} />
                </span>
              </Tooltip>
            )
          ) : (
            <>
              <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>New offer</span>
              {line.biddingMatches.length > 0 && (
                <Tooltip content={biddingNote(line.biddingMatches)}>
                  <Icon name="warning" size="sm" color="var(--color-text-muted)" />
                </Tooltip>
              )}
            </>
          )}
        </span>
      </div>
      {open && <LineCopies collectionId={collectionId} line={line} target={target} pad={pad} />}
    </div>
  );
}

function biddingNote(offers: GeneratorOfferRef[]): string {
  const one = offers.length === 1;
  return `${offers.map((offer) => formatEntityNo(offer.offerNo)).join(", ")} ${one ? "lists" : "list"} the same, but ${one ? "is" : "are"} in active bidding, so nothing is added there.`;
}

/** Condition and certificate in the dictionary's own colours (#728); a format carries none. */
function CombinationChip({ collectionId, part }: { collectionId: string; part: GeneratorCombinationPart }) {
  if (part.axis === "condition") {
    return <ConditionChip collectionId={collectionId} conditionId={part.id} label={part.label} tooltip={part.name} />;
  }
  if (part.axis === "certificate") {
    return (
      <CertificateStatusChip collectionId={collectionId} certificateStatusId={part.id} label={part.label} tooltip={part.name} />
    );
  }
  return (
    <Tooltip content={part.name}>
      <span style={ROW_CHIP}>{part.label}</span>
    </Tooltip>
  );
}

/** The expanded line: every set's copies, each with its photos, inventory number and catalogue number. */
function LineCopies({
  collectionId,
  line,
  target,
  pad,
}: {
  collectionId: string;
  line: GeneratorLineView;
  target: GeneratorOfferRef | null;
  pad: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0 0.75rem 0.625rem 2.5rem" }}>
      {line.sets.map((set, index) => (
        <div key={set.map((copy) => copy.itemId).join(",")} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
          {line.sets.length > 1 && (
            <span style={{ ...HINT, width: "3rem", flexShrink: 0, paddingTop: "0.25rem" }}>Set {index + 1}</span>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {set.map((copy) => (
              <div key={copy.itemId} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.125rem", width: "4rem" }}>
                <PhotoThumb collectionId={collectionId} photos={copy.photos} size="3.5rem" reserveWhenEmpty />
                <span style={{ ...HINT, fontVariantNumeric: "tabular-nums" }}>{formatItemNo(copy.itemNo, pad)}</span>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-primary)", textAlign: "center", overflowWrap: "anywhere" }}>
                  {copy.catalog}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {target && (
        <div style={HINT}>
          Added to {formatEntityNo(target.offerNo)} {target.label} — it will then have{" "}
          {plural(line.resultingSetCount, "set", "sets")}.
        </div>
      )}
      {!target && line.biddingMatches.length > 0 && <div style={HINT}>{biddingNote(line.biddingMatches)}</div>}
    </div>
  );
}
