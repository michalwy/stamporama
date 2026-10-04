"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ConfirmDialog,
  DialogActions,
  DialogBody,
  DialogShell,
  LabelWithError,
} from "@/app/dialog-shell";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { formatAmountInput } from "@/lib/decimal-input";
import {
  OBSERVATION_DOUBT_LABEL,
  PRICE_BASIS_LABEL,
  type PriceBasis,
} from "@/lib/price-observation";
import type {
  PriceObservationRaw,
  PriceObservationView,
  StampPriceObservations,
} from "@/lib/price-observations";
import { inventoryKeys } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { auctionKeys } from "@/app/c/[collectionSlug]/auctions/use-auctions-query";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { NumericInput } from "./numeric-input";
import { TextInput } from "./text-input";
import { RowActionsMenu } from "./row-actions-menu";
import { Tooltip } from "./tooltip";
import { Muted, mutedSmallStyle, numStyle } from "./price-matrix";
import { useCollectionConditions } from "./use-display-condition";
import { useCollectionFormats } from "./use-display-format";
import { useCollectionCertificateStatuses } from "./use-certificate-statuses";

// **Realised prices from other people's auctions** (#1633; ADR-0063 §6) — listed in the Valuation
// dialog under the Market value grid they feed, and recorded, corrected and deleted from there.
//
// The counted ones come first, each with its price **as observed** (its own currency, hammer or
// all-in) and **as counted** (the hammer in the base currency at the rate of its day), because the two
// differ by a premium and a rate and a reader checking a median has to be able to redo both. The
// ones that do not count follow as **hints**, each saying why: an uncertain match, or no rate for its
// day. A hint is never folded into a figure, and a figure never hides that hints exist.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

const NOTE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

/** The Valuation dialog's base is 100; a dialog opened from inside it stacks above. */
const FORM_Z_INDEX_BASE = 110;
const CONFIRM_Z_INDEX_BASE = 120;

/** The day of a sale, as stored: a calendar day with no time of its own, so it is printed in UTC —
 * read in the browser's zone, a day west of Greenwich would show as the one before. */
export function soldOnLabel(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return date.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/** Where it was sold, in reading order: the house and its auction, then the platform. */
export function observationSource(o: {
  auctionHouseName: string | null;
  auctionName: string | null;
  lotNo: string | null;
  platformName: string;
}): string {
  const house = [o.auctionHouseName, o.auctionName].filter(Boolean).join(" ");
  const lot = o.lotNo ? `lot ${o.lotNo}` : null;
  const via = o.auctionHouseName && o.auctionHouseName !== o.platformName ? `via ${o.platformName}` : null;
  return [house || o.platformName, lot, house ? via : null].filter(Boolean).join(" · ");
}

function keyLabel(o: PriceObservationView): string {
  return [
    o.conditionAbbreviation ?? "condition ?",
    o.certificateUncertain
      ? `${o.certificateStatusAbbreviation ?? "cert."} ?`
      : o.certificateStatusAbbreviation,
    o.formatAbbreviation,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function useStampPriceObservations(stampId: string) {
  return useQuery<StampPriceObservations>({
    queryKey: ["stampPriceObservations", stampId],
    staleTime: 30_000,
    queryFn: async () => {
      const { getStampPriceObservationsAction } = await import("@/app/actions/price-observations");
      return getStampPriceObservationsAction(stampId);
    },
  });
}

/** Everything an observation moves: the stamp's own figures in this window, every total and every
 * bid recommendation built on market value — and, through the learned ratio, other stamps'. */
function useInvalidateAfterWrite(stampId: string, collectionId: string | undefined) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [
        ["stampPriceObservations", stampId],
        ["stampMarketValue", stampId],
        ["stampEstimatedValue"],
        ["checklistMarketValue"],
        ["checklistEstimatedValue"],
        ...(collectionId ? [inventoryKeys.all(collectionId), auctionKeys.all(collectionId)] : []),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
    );
}

/**
 * The observations recorded on one stamp, under the Market value grid (ADR-0063 §6).
 *
 * `onMenuOpenChange` is the row menu's, raised so the Valuation dialog can stop being dismissable
 * while a menu is open — one Escape would otherwise close both (#361).
 */
export function StampPriceObservationList({
  stampId,
  onMenuOpenChange,
}: {
  stampId: string;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const query = useStampPriceObservations(stampId);
  const [editing, setEditing] = useState<PriceObservationView | "new" | null>(null);
  const [deleting, setDeleting] = useState<PriceObservationView | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [isDeleting, startDelete] = useTransition();
  const data = query.data;
  const invalidate = useInvalidateAfterWrite(stampId, data?.collectionId);

  const counted = data?.observations.filter((o) => o.notCounted === null) ?? [];
  const hints = data?.observations.filter((o) => o.notCounted !== null) ?? [];

  function confirmDelete() {
    if (!deleting) return;
    setDeleteError(undefined);
    startDelete(async () => {
      const { deletePriceObservationAction } = await import("@/app/actions/price-observations");
      const result = await deletePriceObservationAction(deleting.id);
      if (result.status === "error") {
        setDeleteError(result.message);
        return;
      }
      setDeleting(null);
      await invalidate();
    });
  }

  const row = (o: PriceObservationView) => (
    <ObservationRow
      key={o.id}
      observation={o}
      onEdit={() => setEditing(o)}
      onDelete={() => {
        setDeleteError(undefined);
        setDeleting(o);
      }}
      onMenuOpenChange={onMenuOpenChange}
    />
  );

  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text-secondary)" }}>
          Price observations
        </span>
        <span style={mutedSmallStyle}>realised prices from other auctions</span>
        <button
          type="button"
          onClick={() => setEditing("new")}
          disabled={!data}
          style={{
            ...baseBtn,
            minHeight: "1.75rem",
            padding: "0.15rem 0.6rem",
            marginLeft: "auto",
            gap: "0.3rem",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border-strong)",
            fontSize: "0.8125rem",
          }}
        >
          <Icon name="add" size="sm" /> Record a price
        </button>
      </div>

      {query.isLoading && <Muted>Loading observations…</Muted>}
      {query.isError && <Muted>The observations could not be loaded just now.</Muted>}
      {data && data.observations.length === 0 && (
        <Muted>None recorded. A hammer price seen on another auction can be recorded here.</Muted>
      )}

      {counted.length > 0 && <div style={{ display: "flex", flexDirection: "column" }}>{counted.map(row)}</div>}

      {hints.length > 0 && (
        <>
          <div style={{ ...mutedSmallStyle, fontWeight: 600, margin: "0.6rem 0 0.2rem" }}>
            Hints — not counted in the market value
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>{hints.map(row)}</div>
        </>
      )}

      {editing &&
        data &&
        createPortal(
          <PriceObservationFormDialog
            stampId={stampId}
            collectionId={data.collectionId}
            umbrella={data.umbrella}
            observation={editing === "new" ? undefined : editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await invalidate();
            }}
          />,
          document.body
        )}

      {deleting &&
        createPortal(
          <ConfirmDialog
            title="Delete price observation"
            message={`Delete the ${deleting.price} ${deleting.currency} result from ${observationSource(deleting)}? It stops counting in the market value.`}
            actionLabel="Delete"
            pendingLabel="Deleting…"
            isPending={isDeleting}
            error={deleteError}
            zIndexBase={CONFIRM_Z_INDEX_BASE}
            onConfirm={confirmDelete}
            onClose={() => setDeleting(null)}
          />,
          document.body
        )}
    </div>
  );
}

function notCountedReason(o: PriceObservationView): string {
  if (o.notCounted === "uncertain") return o.doubts.map((d) => OBSERVATION_DOUBT_LABEL[d]).join(", ");
  if (o.notCounted === "no-rate") return `no ${o.currency} → ${o.baseCurrency} rate for that day`;
  if (o.notCounted === "no-hammer") return "the premium is more than the price";
  // #1634: a market that does not anchor this stamp's area.
  if (o.notCounted === "other-market") return `sold in ${o.market ?? "an unknown market"}, which does not anchor this area`;
  return "";
}

function ObservationRow({
  observation: o,
  onEdit,
  onDelete,
  onMenuOpenChange,
}: {
  observation: PriceObservationView;
  onEdit: () => void;
  onDelete: () => void;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const other: { label: string; value: string | null } =
    o.priceBasis === "hammer"
      ? { label: "all-in", value: o.allIn }
      : { label: "hammer", value: o.hammer };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "0.6rem",
        padding: "0.3rem 0",
        borderTop: "1px solid var(--color-border)",
        fontSize: "0.8125rem",
      }}
    >
      <span style={{ ...mutedSmallStyle, width: "6.5rem", flexShrink: 0 }}>{soldOnLabel(o.soldOn)}</span>
      <span style={{ fontWeight: 600, width: "7rem", flexShrink: 0 }}>{keyLabel(o)}</span>
      <span style={{ flex: 1, minWidth: 0, color: "var(--color-text-secondary)" }}>
        {o.url ? (
          <a
            href={o.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--color-accent)", textDecoration: "none" }}
          >
            {observationSource(o)}
          </a>
        ) : (
          observationSource(o)
        )}
        {/* Where it was sold (#1634) — its house's market, else its platform's. */}
        <span style={{ ...mutedSmallStyle, fontFamily: "monospace", marginLeft: "0.5rem" }}>
          {o.market ?? "—"}
        </span>
        {o.notCounted !== null && (
          <span style={{ ...mutedSmallStyle, color: "var(--color-warning)", marginLeft: "0.5rem" }}>
            {notCountedReason(o)}
          </span>
        )}
      </span>
      <Tooltip
        placement="top"
        align="end"
        maxWidth="20rem"
        content={
          <span>
            {PRICE_BASIS_LABEL[o.priceBasis]} as observed
            {other.value !== null && (
              <>
                ; {other.label} {other.value} {o.currency}
              </>
            )}
            {(o.premiumPercent !== null || o.premiumFixed !== null) && (
              <>
                {" "}
                (premium {o.premiumPercent ?? "0"}%
                {o.premiumFixed !== null ? ` + ${o.premiumFixed} ${o.currency}` : ""})
              </>
            )}
            .
            {o.fxRateToBase !== null && (
              <>
                {" "}
                Rate of the day: {Number(o.fxRateToBase).toFixed(4)}.
              </>
            )}
          </span>
        }
      >
        <span style={{ ...numStyle, whiteSpace: "nowrap" }}>
          {o.price} {o.currency}{" "}
          <span style={mutedSmallStyle}>{o.priceBasis === "hammer" ? "hammer" : "all-in"}</span>
        </span>
      </Tooltip>
      <span
        style={{
          ...numStyle,
          width: "7.5rem",
          flexShrink: 0,
          textAlign: "right",
          fontWeight: o.countedAmount ? 600 : 400,
          color: o.countedAmount ? "var(--color-text-primary)" : "var(--color-text-muted)",
        }}
      >
        {o.countedAmount ? `${o.countedAmount} ${o.baseCurrency}` : "—"}
      </span>
      <RowActionsMenu
        ariaLabel="Observation actions"
        onOpenChange={onMenuOpenChange}
        actions={[
          { key: "edit", label: "Edit", icon: "edit", onSelect: onEdit },
          {
            key: "delete",
            label: "Delete",
            icon: "delete",
            danger: true,
            separatorBefore: true,
            onSelect: onDelete,
          },
        ]}
      />
    </div>
  );
}

/** Today in the browser's own calendar, as `YYYY-MM-DD` — the default day of a new observation. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Record or correct one observation. */
function PriceObservationFormDialog({
  stampId,
  collectionId,
  umbrella,
  observation,
  onClose,
  onSaved,
}: {
  stampId: string;
  collectionId: string;
  umbrella: boolean;
  observation?: PriceObservationView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const [conditionId, setConditionId] = useState(observation?.conditionId ?? "");
  const [certificateStatusId, setCertificateStatusId] = useState(observation?.certificateStatusId ?? "");
  const [certificateUncertain, setCertificateUncertain] = useState(observation?.certificateUncertain ?? false);
  const [formatId, setFormatId] = useState(observation?.formatId ?? "");
  const [price, setPrice] = useState(observation?.price ?? "");
  const [currency, setCurrency] = useState(observation?.currency ?? "");
  const [priceBasis, setPriceBasis] = useState<PriceBasis>(observation?.priceBasis ?? "hammer");
  const [premiumPercent, setPremiumPercent] = useState(observation?.premiumPercent ?? "");
  const [premiumFixed, setPremiumFixed] = useState(observation?.premiumFixed ?? "");
  const [soldOn, setSoldOn] = useState(observation?.soldOn ?? today());
  const [platformId, setPlatformId] = useState(observation?.platformId ?? "");
  const [platformName, setPlatformName] = useState(observation?.platformName ?? "");
  const [houseId, setHouseId] = useState(observation?.auctionHouseId ?? "");
  const [houseName, setHouseName] = useState(observation?.auctionHouseName ?? "");
  const [auctionName, setAuctionName] = useState(observation?.auctionName ?? "");
  const [lotNo, setLotNo] = useState(observation?.lotNo ?? "");
  const [url, setUrl] = useState(observation?.url ?? "");

  /** A house picked from the list proposes its own terms (ADR-0063 §5) into the fields still empty —
   * copied, so a house changing its terms later re-prices nothing already recorded. */
  async function proposeTerms(contactId: string) {
    const { getAuctionHouseTermsAction } = await import("@/app/actions/price-observations");
    const terms = await getAuctionHouseTermsAction(collectionId, contactId);
    if (terms.premiumPercent !== null) setPremiumPercent((v) => v || terms.premiumPercent!);
    if (terms.premiumFixed !== null) setPremiumFixed((v) => v || terms.premiumFixed!);
    if (terms.currency !== null) setCurrency((v) => v || terms.currency!);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const raw: PriceObservationRaw = {
      conditionId: conditionId || null,
      certificateStatusId: certificateStatusId || null,
      certificateUncertain,
      formatId: formatId || null,
      price,
      currency,
      priceBasis,
      premiumPercent,
      premiumFixed,
      soldOn,
      platformId: platformId || null,
      platformName: platformName || null,
      auctionHouseId: houseId || null,
      auctionHouseName: houseName || null,
      auctionName,
      lotNo,
      url,
    };
    startTransition(async () => {
      const actions = await import("@/app/actions/price-observations");
      const result = observation
        ? await actions.updatePriceObservationAction(observation.id, raw)
        : await actions.createPriceObservationAction(stampId, raw);
      if (result.status === "error") setError(result.message);
      else onSaved();
    });
  }

  return (
    <DialogShell
      title={observation ? "Edit price observation" : "Record a price"}
      onClose={onClose}
      maxWidth="36rem"
      zIndexBase={FORM_Z_INDEX_BASE}
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          {umbrella && (
            <p style={{ ...NOTE, margin: "0 0 1rem", color: "var(--color-warning)" }}>
              This stamp has variants and none is named, so a price recorded here is a hint and does
              not count. Record it on the variant when the listing says which.
            </p>
          )}

          <div style={{ ...FIELD_GAP, display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-condition">Condition</LabelWithError>
              <select
                id="obs-condition"
                value={conditionId}
                onChange={(e) => setConditionId(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">Not established</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-certificate">Certificate</LabelWithError>
              <select
                id="obs-certificate"
                value={certificateStatusId}
                onChange={(e) => setCertificateStatusId(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">— None —</option>
                {certificateStatuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  marginTop: "0.35rem",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={certificateUncertain}
                  onChange={(e) => setCertificateUncertain(e.target.checked)}
                />
                Not established
              </label>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-format">Format</LabelWithError>
              <select
                id="obs-format"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">Single</option>
                {formats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ ...NOTE, marginTop: "-0.5rem", marginBottom: "1rem" }}>
            Only an exact match counts in the market value; a condition or certificate not established
            leaves it a hint.
          </p>

          <div style={{ ...FIELD_GAP, display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-price">Price</LabelWithError>
              <NumericInput
                kind="amount"
                id="obs-price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: "0 0 6.5rem" }}>
              <LabelWithError htmlFor="obs-currency">Currency</LabelWithError>
              <select
                id="obs-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">—</option>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: "0 0 8rem" }}>
              <LabelWithError htmlFor="obs-basis">Price is</LabelWithError>
              <select
                id="obs-basis"
                value={priceBasis}
                onChange={(e) => setPriceBasis(e.target.value as PriceBasis)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="hammer">{PRICE_BASIS_LABEL.hammer}</option>
                <option value="all_in">{PRICE_BASIS_LABEL.all_in}</option>
              </select>
            </div>
          </div>

          <div style={{ ...FIELD_GAP, display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="obs-premium-percent">Buyer&apos;s premium %</LabelWithError>
              <NumericInput
                kind="number"
                id="obs-premium-percent"
                value={premiumPercent}
                onChange={(e) => setPremiumPercent(e.target.value)}
                onBlur={(e) => setPremiumPercent(formatAmountInput(e.target.value))}
                placeholder="0"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="obs-premium-fixed">Lot fee</LabelWithError>
              <NumericInput
                kind="amount"
                id="obs-premium-fixed"
                value={premiumFixed}
                onChange={(e) => setPremiumFixed(e.target.value)}
                placeholder="0.00"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="obs-sold-on">Sold on</LabelWithError>
              <input
                id="obs-sold-on"
                type="date"
                value={soldOn}
                max={today()}
                onChange={(e) => setSoldOn(e.target.value)}
                style={INPUT_STYLE}
              />
            </div>
          </div>
          <p style={{ ...NOTE, marginTop: "-0.5rem", marginBottom: "1rem" }}>
            Counted at the hammer, in your currency at the ECB rate of that day.
          </p>

          <div style={{ ...FIELD_GAP, display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-house">Auction house</LabelWithError>
              <PurchaseContactSelect
                collectionId={collectionId}
                idFieldName="auctionHouseId"
                nameFieldName="auctionHouseName"
                initialContactId={houseId}
                initialContactName={houseName}
                inputId="obs-house"
                placeholder="None for a marketplace"
                onSelectionChange={(id, name) => {
                  setHouseId(id);
                  setHouseName(name);
                  if (id && !observation) void proposeTerms(id);
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-platform">Platform</LabelWithError>
              <PurchaseContactSelect
                collectionId={collectionId}
                idFieldName="platformId"
                nameFieldName="platformName"
                initialContactId={platformId}
                initialContactName={platformName}
                inputId="obs-platform"
                placeholder="Where it was listed"
                role="platform"
                onSelectionChange={(id, name) => {
                  setPlatformId(id);
                  setPlatformName(name);
                }}
              />
            </div>
          </div>

          <div style={{ ...FIELD_GAP, display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-auction">Auction</LabelWithError>
              <TextInput
                id="obs-auction"
                value={auctionName}
                onChange={(e) => setAuctionName(e.target.value)}
                placeholder="385"
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="obs-lot">Lot</LabelWithError>
              <TextInput
                id="obs-lot"
                value={lotNo}
                onChange={(e) => setLotNo(e.target.value)}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <div>
            <LabelWithError htmlFor="obs-url">Address</LabelWithError>
            <TextInput
              id="obs-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              style={INPUT_STYLE}
            />
          </div>
        </DialogBody>

        <DialogActions
          actionLabel={isPending ? "Saving…" : observation ? "Save" : "Record"}
          disabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
