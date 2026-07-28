"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogShell, DialogBody, DialogFooter, DialogSecondaryButton } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { issueLabel, orderedCatalogLabels } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { AuctionLotLineDialog } from "./auction-lot-line-dialog";
import type { AuctionLotLineItem } from "@/lib/auction-lines";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import { useAuctionLotComposition, type AuctionLotView } from "./use-auctions-query";

const EMPTY_VENDOR_MAP: Map<string, AreaCatalogEntry> = new Map();

const NOTE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

const AMOUNT: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

/** The line grid: what it is (elastic), condition, format, quantity, unit value, line value, ⋮. */
const GRID = "1fr 4.5rem 4.5rem 3rem 6rem 6rem 2rem";

/** A **quick-add link in the price slot**, never a `⋮` entry — pricing belongs where the price is,
 * and every list opens the same dialog the same way (#228, #341). */
const QUICK_PRICE_LINK: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "0.75rem",
  color: "var(--color-accent)",
  textDecoration: "underline",
  whiteSpace: "nowrap",
};

/** What the editor is doing: nothing, adding a line, or editing one. */
type Draft =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; line: AuctionLotLineItem };

/**
 * A figure that was **inferred rather than recorded** — the lowest-variant rollup (#238) — in the
 * one vocabulary the app has for it: a muted `~` in front, the value itself muted and italic. Same
 * marks a derived format price uses; only the tooltip tells the two apart.
 */
function Money({
  amount,
  uncertain,
  hint,
}: {
  amount: string | null;
  uncertain: boolean;
  hint?: string;
}) {
  if (amount === null) return <span style={{ ...AMOUNT, color: "var(--color-text-muted)" }}>—</span>;
  const value = (
    <span
      style={
        uncertain
          ? { ...AMOUNT, color: "var(--color-text-muted)", fontStyle: "italic" }
          : AMOUNT
      }
    >
      {uncertain ? "~" : ""}
      {amount}
    </span>
  );
  return hint ? <Tooltip content={hint}>{value}</Tooltip> : value;
}

interface AuctionLotLinesDialogProps {
  collectionId: string;
  lot: AuctionLotView;
  areas: CollectionAreaData[];
  onClose: () => void;
  /** Called after any change, so the list behind refreshes its catalogue-value column. */
  onChanged: () => void;
}

/**
 * **What a lot contains, and what it is worth** (#353).
 *
 * A line is a `stamp × condition × format × quantity`. Structured, because free text makes the
 * catalogue value uncomputable and leaves a lost lot — the price datapoint the whole exercise
 * produces — attributed to nothing.
 *
 * Nothing about *pricing* is decided here. Pointing a line at an unknown-variant umbrella is how
 * "variant unspecified" is said, and it rolls up from the cheapest child exactly as the issue list
 * does (#238); a format prices the multiple through ADR-0020, and a multiple with neither an
 * explicit price nor a factor is **unpriced** rather than quietly valued at the single's figure.
 * Every one of those comes from the same valuation the Copies list uses.
 *
 * This is also the lot's detail surface: the totals footer carries the catalogue value against what
 * the lot actually costs all-in, which is the question the composition exists to answer.
 */
export function AuctionLotLinesDialog({
  collectionId,
  lot,
  areas,
  onClose,
  onChanged,
}: AuctionLotLinesDialogProps) {
  const [draft, setDraft] = useState<Draft>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  /** The line whose missing catalogue value is being filled in. */
  const [pricing, setPricing] = useState<AuctionLotLineItem | null>(null);
  const [priceError, setPriceError] = useState<string | undefined>();

  const { data, isLoading, refetch } = useAuctionLotComposition(collectionId, lot.id);
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  const lines = data?.lines ?? [];
  // A settled lot's figures live on the purchase now (#28), so its composition is history.
  const editable = !lot.settled;

  async function reload() {
    await refetch();
    onChanged();
  }

  function run(action: () => Promise<{ status: "success" } | { status: "error"; message: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") setError(result.message);
      else {
        setDraft({ kind: "none" });
        await reload();
      }
    });
  }

  return (
    <DialogShell
      title="Lot contents"
      onClose={onClose}
      maxWidth="52rem"
      // The line dialogs stacked above this one register as their own Escape layers (#361), so
      // nothing has to be suppressed here.
    >
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          What{" "}
          <strong>
            {lot.title ?? lot.derivedTitle ?? (lot.lotNo ? `Lot ${lot.lotNo}` : "this lot")}
          </strong>{" "}
          holds.
          Values are catalogue prices at each line&apos;s condition and format, converted into{" "}
          {lot.currency} — the currency the bid and your ceiling are in.
        </p>

        {isLoading && (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading contents…</p>
        )}

        {!isLoading && lines.length === 0 && draft.kind === "none" && (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", margin: 0 }}>
            Nothing described yet. Adding what the lot contains is what makes its catalogue value
            computable — and what turns a lot you lose into a usable price record.
          </p>
        )}

        {lines.length > 0 && (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.5rem", overflow: "clip" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: "0.5rem",
                alignItems: "center",
                padding: "0.5rem 0.75rem",
                background: "var(--color-bg-page)",
                borderBottom: "1px solid var(--color-border)",
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-text-muted)",
              }}
            >
              <span>Stamp</span>
              <span>Condition</span>
              <span>Format</span>
              <span style={{ textAlign: "right" }}>Qty</span>
              <span style={{ textAlign: "right" }}>Each</span>
              <span style={{ textAlign: "right" }}>Value</span>
              <span />
            </div>

            {lines.map((line, idx) => {
              const vendorMap = line.areaId
                ? (vendorMapByArea.get(line.areaId) ?? EMPTY_VENDOR_MAP)
                : EMPTY_VENDOR_MAP;
              const primaryVendorId = line.areaId
                ? (primaryVendorByArea.get(line.areaId) ?? null)
                : null;
              const labels = orderedCatalogLabels(line.catalogNumbers, vendorMap, primaryVendorId);
              const actions: RowAction[] = [
                {
                  key: "edit",
                  label: "Edit line",
                  icon: "✎",
                  disabled: !editable,
                  hint: editable ? undefined : "Settled into a purchase — edit the purchase instead",
                  onSelect: () => setDraft({ kind: "edit", line }),
                },
                {
                  key: "delete",
                  label: "Remove",
                  icon: "✕",
                  danger: true,
                  separatorBefore: true,
                  disabled: !editable,
                  hint: editable ? undefined : "Settled into a purchase — edit the purchase instead",
                  onSelect: () =>
                    run(async () => {
                      const { deleteAuctionLotLineAction } = await import("@/app/actions/auctions");
                      return deleteAuctionLotLineAction(line.id);
                    }),
                },
              ];

              return (
                <div
                  key={line.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID,
                    gap: "0.5rem",
                    alignItems: "center",
                    padding: "0.5rem 0.75rem",
                    borderBottom: idx === lines.length - 1 ? undefined : "1px solid var(--color-border)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.3rem" }}>
                      {labels.map((label) => (
                        <span key={label} style={STAMP_SECONDARY_CHIP}>
                          {label}
                        </span>
                      ))}
                      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)" }}>
                        {line.stampName || (labels.length === 0 ? "(unnamed stamp)" : "")}
                      </span>
                      {line.unknownVariant && (
                        <Tooltip content="A base stamp with variants: which one this is has not been recorded, so the value is the cheapest of them.">
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--color-text-muted)",
                              cursor: "help",
                            }}
                          >
                            — variant unspecified
                          </span>
                        </Tooltip>
                      )}
                    </div>
                    <div style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                      {[
                        line.issueName || line.issueYear
                          ? issueLabel(line.issueName, line.issueYear)
                          : null,
                        line.areaId ? (areaNameById.get(line.areaId) ?? null) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>

                  <Tooltip content={line.conditionName}>
                    <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                      {line.conditionAbbreviation}
                    </span>
                  </Tooltip>
                  {/* A single is the unmarked default and renders nothing (ADR-0020) — there is no
                      such dictionary row, and labelling most of the list "single" is noise. */}
                  <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                    {line.formatAbbreviation ? (
                      <Tooltip content={line.formatName ?? ""}>
                        <span>{line.formatAbbreviation}</span>
                      </Tooltip>
                    ) : (
                      <span style={{ color: "var(--color-text-muted)" }}>—</span>
                    )}
                  </span>
                  <span style={{ ...AMOUNT, textAlign: "right", fontWeight: 500 }}>
                    ×{line.quantity}
                  </span>

                  <div style={{ textAlign: "right" }}>
                    {line.unpriced ? (
                      // The trigger lives in the price slot, as on every other list (#228, #341).
                      <button
                        type="button"
                        style={QUICK_PRICE_LINK}
                        onClick={() => {
                          setPriceError(undefined);
                          setPricing(line);
                        }}
                      >
                        + catalog value
                      </button>
                    ) : line.unconvertible ? (
                      <Tooltip content={`Priced, but there is no rate into ${line.currency}.`}>
                        <span style={{ ...AMOUNT, color: "var(--color-text-muted)" }}>n/a</span>
                      </Tooltip>
                    ) : (
                      <Money
                        amount={line.unitValue}
                        uncertain={line.uncertain}
                        hint={
                          line.uncertain
                            ? "Cheapest of this stamp's variants — inferred, not recorded"
                            : undefined
                        }
                      />
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Money amount={line.lineValue} uncertain={line.uncertain} />
                  </div>
                  <RowActionsMenu actions={actions} ariaLabel="Line actions" />
                </div>
              );
            })}
          </div>
        )}

        {editable && (
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setDraft({ kind: "add" });
            }}
            style={{
              marginTop: "0.75rem",
              padding: "0.375rem 0.75rem",
              border: "1px dashed var(--color-border-strong)",
              borderRadius: "0.375rem",
              background: "none",
              cursor: "pointer",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            + Add line
          </button>
        )}

        {data && lines.length > 0 && <CompositionTotals data={data} />}
      </DialogBody>

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
      </DialogFooter>

      {/* Entering a line is two modals of its own — the stamp browser, then condition and the
          rest — stacked above this one. */}
      {draft.kind !== "none" && (
        <AuctionLotLineDialog
          key={draft.kind === "edit" ? draft.line.id : "add"}
          collectionId={collectionId}
          areas={areas}
          line={draft.kind === "edit" ? draft.line : undefined}
          vendorMapByArea={vendorMapByArea}
          primaryVendorByArea={primaryVendorByArea}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (isPending) return;
            setDraft({ kind: "none" });
            setError(undefined);
          }}
          onSubmit={(raw) =>
            run(async () => {
              const actions = await import("@/app/actions/auctions");
              return draft.kind === "edit"
                ? actions.updateAuctionLotLineAction(collectionId, draft.line.id, raw)
                : actions.createAuctionLotLineAction(collectionId, lot.id, raw);
            })
          }
        />
      )}

      {/* Quick-add of a missing catalogue value, through the shared dialog over a
          `QuickPriceSubject` — a lot line is a stamp × condition, which satisfies that shape.
          **Portaled to <body>**: this dialog's own panel is transform-centered, which makes it the
          containing block for `position: fixed` descendants, so a nested dialog rendered in place
          would be clipped to it. The stamp picker escapes the same way. */}
      {pricing &&
        typeof document !== "undefined" &&
        createPortal(
        <QuickPriceDialog
          subject={{
            stampId: pricing.stampId,
            stampName: pricing.stampName,
            issueName: pricing.issueName,
            issueYear: pricing.issueYear,
            conditionId: pricing.conditionId,
            conditionAbbreviation: pricing.conditionAbbreviation,
            // The certificate the line names — price matching is strict, so a value entered here
            // has to be recorded at the same level the line is described at.
            certificateStatusId: pricing.certificateStatusId,
            certificateStatusName: pricing.certificateStatusName,
            formatId: pricing.formatId,
            formatAbbreviation: pricing.formatAbbreviation,
            catalogNumbers: pricing.catalogNumbers,
            photos: pricing.photos,
          }}
          collectionId={collectionId}
          areaName={pricing.areaId ? (areaNameById.get(pricing.areaId) ?? null) : null}
          primaryVendorId={pricing.areaId ? (primaryVendorByArea.get(pricing.areaId) ?? null) : null}
          vendorMap={
            pricing.areaId ? (vendorMapByArea.get(pricing.areaId) ?? EMPTY_VENDOR_MAP) : EMPTY_VENDOR_MAP
          }
          isPending={isPending}
          error={priceError}
          onClose={() => {
            if (!isPending) setPricing(null);
          }}
          onSubmit={(entries) => {
            const line = pricing;
            setPriceError(undefined);
            startTransition(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const result = await quickSetCatalogPricesAction(
                line.stampId,
                line.conditionId,
                line.certificateStatusId,
                entries,
                line.formatId
              );
              if (result.status === "error") setPriceError(result.message);
              else {
                setPricing(null);
                await reload();
              }
            });
          }}
        />,
          document.body
        )}
    </DialogShell>
  );
}

/** The lot's own totals: what it is described as holding, what that is worth, and what it costs. */
function CompositionTotals({
  data,
}: {
  data: {
    currency: string;
    lineCount: number;
    quantity: number;
    catalogValue: string | null;
    unpricedLines: number;
    unconvertibleLines: number;
    uncertain: boolean;
    allIn: string | null;
    headroom: string | null;
  };
}) {
  const headroom = data.headroom === null ? null : Number(data.headroom);
  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "0.75rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-page)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "1.5rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          {data.lineCount} line{data.lineCount === 1 ? "" : "s"} · {data.quantity} stamp
          {data.quantity === 1 ? "" : "s"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          Catalogue
        </span>
        <Money amount={data.catalogValue} uncertain={data.uncertain} />
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>All-in</span>
        <Money amount={data.allIn} uncertain={false} />
        <Tooltip content="Catalogue value less what the lot costs at the price it stands at — the seller's premium included, shipping added once on the sale.">
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", cursor: "help" }}>
            Headroom
          </span>
        </Tooltip>
        <span
          style={{
            ...AMOUNT,
            color:
              headroom === null
                ? "var(--color-text-muted)"
                : headroom < 0
                  ? "var(--color-error)"
                  : "var(--color-success)",
          }}
        >
          {data.headroom ?? "—"} {data.currency}
        </span>
      </div>
      {(data.unpricedLines > 0 || data.unconvertibleLines > 0) && (
        <p style={NOTE}>
          {data.unpricedLines > 0 &&
            `${data.unpricedLines} line${data.unpricedLines === 1 ? " has" : "s have"} no catalogue price at that condition and format — the total leaves them out. `}
          {data.unconvertibleLines > 0 &&
            `${data.unconvertibleLines} line${data.unconvertibleLines === 1 ? " is" : "s are"} priced in a currency with no rate into ${data.currency}.`}
        </p>
      )}
    </div>
  );
}
