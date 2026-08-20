"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { TradeSectionData } from "@/lib/trades";
import type { TradeReservationRead } from "@/lib/trade-reservations";
import {
  TRADE_STATUS_LABEL,
  TRADE_STATUS_TONE,
  TRADE_STATUS_TRANSITIONS,
  describeBalanceRule,
  isTradeContentEditable,
  resolveBalanceRule,
  type TradeStatus,
} from "@/lib/trade-rules";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { RecordRecentVisit } from "@/app/c/[collectionSlug]/shared/record-recent-visit";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { usePersistentStringSet } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  TRADE_GROUP_LEVELS,
  TRADE_GROUP_LABEL,
  TRADE_GROUP_HINT,
  readTradeGroupLevels,
} from "@/lib/trade-grouping";
import {
  deleteTradeAction,
  deleteTradeSectionAction,
  setTradeShippingAction,
  setTradeStatusAction,
  updateTradeAction,
} from "@/app/actions/trades";
import { TradeFormDialog, type TradeCatalogVendor } from "../trade-form-dialog";
import { useInvalidateTrades } from "../use-trades-query";
import { useTradeBalance, useTradeDetail, useInvalidateTradeDetail } from "./use-trade-detail-query";
import { TradeBalanceSummary } from "./trade-balance-panel";
import { TradeSectionCard } from "./trade-section-card";
import { TradeSectionDialog } from "./trade-section-dialog";
import { Icon } from "@/app/icons";

// The trade's own screen (#637; ADR-0039): the terms at the top, then one card per section with the
// two sides side by side inside it.
//
// **Side by side and not one list**, because the trade *is* the difference between the two: a screen
// that stacked them would put the answer to "am I giving more than I am getting" a scroll apart from
// the question. And **per section**, because a section is the unit a collector reasons about — mint
// against mint, used against used — which is the motivating case for sections existing at all.
//
// The **header is editable at every status and the contents are not**. Recording that the parcel
// went out is not a change to what was agreed, so the shipping marks and the partner stay live in
// `agreed`; the lines lock, because the partner is holding a copy of them (`isTradeContentEditable`).
// Nothing here re-derives that rule — the lock, the legal transitions and the balance resolution all
// come from `trade-rules.ts`, and every write goes through the same domain the list row does.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1.25rem",
};

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

const LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  marginBottom: "0.2rem",
};

const VALUE: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

const DATE_INPUT: React.CSSProperties = {
  padding: "0.3rem 0.4rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const ADD_BUTTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  padding: "0.4rem 0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
};

type DialogState =
  | { kind: "none" }
  | { kind: "editTrade" }
  | { kind: "deleteTrade" }
  | { kind: "addSection" }
  | { kind: "editSection"; section: TradeSectionData }
  | { kind: "deleteSection"; section: TradeSectionData };

function statusChipStyle(status: TradeStatus): React.CSSProperties {
  const tone = TRADE_STATUS_TONE[status];
  if (tone === "muted") return CHIP;
  return {
    ...CHIP,
    color: `var(--color-${tone})`,
    borderColor: `var(--color-${tone}-border, var(--color-border))`,
    background: `var(--color-${tone}-soft, var(--color-bg-page))`,
  };
}

/** A stored timestamp as a `yyyy-mm-dd` a date input can show. */
function dayValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/**
 * One shipping mark.
 *
 * Two independent timestamps rather than two states, so each is its own control: the parcels cross
 * in the post, either can be recorded first, and clearing one takes the mark back without touching
 * the other. Not gated on the lifecycle either — a parcel that has been posted is a fact.
 */
function ShippingMark({
  label,
  hint,
  value,
  disabled,
  onSet,
}: {
  label: string;
  hint: string;
  value: string | null;
  disabled: boolean;
  /** `null` clears the mark. */
  onSet: (day: string | null) => void;
}) {
  return (
    <div>
      <div style={LABEL}>{label}</div>
      <Tooltip content={hint}>
        <input
          type="date"
          aria-label={label}
          value={dayValue(value)}
          disabled={disabled}
          onChange={(e) => onSet(e.target.value || null)}
          style={DATE_INPUT}
        />
      </Tooltip>
    </div>
  );
}

interface TradeDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  tradeId: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  catalogVendors: TradeCatalogVendor[];
}

export function TradeDetailPanel({
  collectionId,
  collectionSlug,
  tradeId,
  baseCurrency,
  areas,
  locations,
  catalogVendors,
}: TradeDetailPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateTrade } = useInvalidateTradeDetail();
  const { invalidatePartners } = useInvalidateTrades();
  const { data, isLoading } = useTradeDetail(collectionId, tradeId);
  // **Its own query, deliberately.** Valuing every line of both sides against two catalogues is a
  // heavier question than "what are the terms", and the header has no business waiting on it — so
  // the figures arrive under the card rather than holding it back. Same `trades` key, so a line
  // added anywhere on the screen refreshes them.
  const { data: balanceData, isLoading: balanceLoading } = useTradeBalance(collectionId, tradeId);
  const balance = balanceData?.balance;
  // Catalog-number formatting for both sides' rows, resolved once for the screen (#357).
  const vendorMaps = useAreaVendorMaps(areas, collectionId);

  // **The arrangement is the screen's, not each column's.** Both sides of every section nest the
  // same way, because the whole point of the side-by-side layout is that the two can be read against
  // each other — one column grouped by issue beside one grouped by year would be two lists. Kept per
  // collection rather than per trade: how a collector likes to read an exchange list is a habit, not
  // a property of one negotiation.
  const [storedLevels, setStoredLevels] = usePersistentStringSet(
    `stamporama:trades:groupLevels:${collectionId}`
  );
  const levels = useMemo(() => readTradeGroupLevels(storedLevels), [storedLevels]);

  const trade = data?.trade;
  const sections = trade?.sections ?? [];

  /** Every write on this screen goes through here: run it, refresh, and name the refusal. A trade's
   *  rules refuse **by name** rather than by doing nothing, so the message is the point. */
  function run(action: () => Promise<{ status: "success" } | { status: "error"; message: string }>) {
    setActionError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.status === "success") {
        invalidateTrade(collectionId);
      } else {
        // Named where it happened rather than toasted: the card the refusal is about is on screen,
        // and a toast on top of it would be the same news twice.
        setActionError(result.message);
      }
    });
  }

  if (isLoading || !trade) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        {isLoading ? "Loading trade…" : "This trade no longer exists."}
      </p>
    );
  }

  const editable = isTradeContentEditable(trade.status);
  const rule = { ...trade };

  // **The publisher's full name here, not just its abbreviation.** The list row prints `Mi` because
  // a row has one line to spend and a collector reads a catalog by its short form; this screen is
  // where the *terms of the agreement* are read, and "we go by Michel" is the term. The abbreviation
  // stays beside it, because that is the token every catalog number on both sides is prefixed with.
  //
  // Resolved from the vendor list the page already loads for the edit dialog, so it costs no second
  // read. A vendor missing from it (deleted since) falls back to the abbreviation the trade carries
  // — the trade still named one, and saying so beats an em dash that reads as "none agreed".
  const vendor = trade.catalogVendorId
    ? (catalogVendors.find((v) => v.id === trade.catalogVendorId) ?? null)
    : null;
  const agreedCatalog = vendor
    ? vendor.abbreviation && vendor.abbreviation !== vendor.name
      ? `${vendor.name} (${vendor.abbreviation})`
      : vendor.name
    : (trade.catalogVendorName ?? "—");

  // Whole-trade totals. **Pieces on each side, counted separately and never netted** — the
  // difference between the two is the trade (ADR-0039 §2), and one figure would hide it. The receive
  // side counts quantities rather than lines, because three lines can be thirty stamps.
  //
  // Summed from the **sections' own counts**, which come with the header, so the figure states what
  // is on the trade rather than what has been scrolled to or left by a column's filter. What the two
  // sides are *worth*, and whether that balances, is #638's engine and is not guessed at here.
  const giveTotal = sections.reduce((sum, s) => sum + s.giveCount, 0);
  const receiveLines = sections.reduce((sum, s) => sum + s.receiveCount, 0);
  const receiveTotal = sections.reduce((sum, s) => sum + s.receiveQuantity, 0);

  const headerActions: RowAction[] = [
    { key: "edit", label: "Edit trade", icon: "edit", onSelect: () => setDialog({ kind: "editTrade" }) },
    ...TRADE_STATUS_TRANSITIONS[trade.status].map((next, index) => ({
      key: `status-${next}`,
      label: `Mark ${TRADE_STATUS_LABEL[next].toLowerCase()}`,
      icon: (next === "cancelled" ? "reject" : "check") as RowAction["icon"],
      separatorBefore: index === 0,
      onSelect: () => run(() => setTradeStatusAction(tradeId, next)),
    })),
    {
      key: "delete",
      label: "Delete trade",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => setDialog({ kind: "deleteTrade" }),
    },
  ];

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  return (
    <>
      <RecordRecentVisit
        collectionId={collectionId}
        kind="trade"
        id={tradeId}
        href={`/c/${collectionSlug}/trades/${tradeId}`}
        label={`Trade #${trade.tradeNo}`}
        sublabel={trade.partnerName}
      />

      <Link
        href={`/c/${collectionSlug}/trades`}
        style={{
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
          textDecoration: "none",
          marginBottom: "1rem",
          alignSelf: "flex-start",
        }}
      >
        ← Back to trades
      </Link>

      {/* ── The terms ─────────────────────────────────────────────────────────────────────────── */}
      <section style={{ ...CARD, marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {trade.partnerName}
          </h1>
          <EntityNoChip entity="trade" no={trade.tradeNo} prefix="t" />
          <Tooltip content="Trade status">
            <span style={statusChipStyle(trade.status)}>{TRADE_STATUS_LABEL[trade.status]}</span>
          </Tooltip>
          <span style={{ flex: 1 }} />
          <RowActionsMenu actions={headerActions} ariaLabel="Trade actions" />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
            gap: "0.875rem 1.5rem",
            marginTop: "1rem",
          }}
        >
          <div>
            <div style={LABEL}>Balanced</div>
            <div style={VALUE}>{describeBalanceRule(rule)}</div>
          </div>
          <div>
            <div style={LABEL}>Agreed catalog</div>
            <div style={VALUE}>{agreedCatalog}</div>
          </div>
          <div>
            <div style={LABEL}>Partner&apos;s currency</div>
            <div style={VALUE}>{trade.currency}</div>
          </div>
          <ShippingMark
            label="Sent"
            hint="The day my parcel went out. Clear it to take the mark back."
            value={trade.sentAt}
            disabled={isPending}
            onSet={(day) => run(() => setTradeShippingAction(tradeId, { sentAt: day }))}
          />
          <ShippingMark
            label="Received"
            hint="The day the partner's parcel arrived. Independent of the one above — parcels cross in the post."
            value={trade.receivedAt}
            disabled={isPending}
            onSet={(day) => run(() => setTradeShippingAction(tradeId, { receivedAt: day }))}
          />
        </div>

        {trade.notes && (
          <div style={{ marginTop: "1rem" }}>
            <div style={LABEL}>Notes</div>
            <div style={{ ...VALUE, whiteSpace: "pre-wrap" }}>{trade.notes}</div>
          </div>
        )}

        {/* **What both sides are worth, and whether that balances** (#638). Under the terms rather
            than beside them, because it is what the terms above *produce*: the balance rule, the
            agreed catalogue and the partner's currency are all read off this block. The gates it
            carries are stated here too, so a refusal is met while the list is being composed rather
            than at the moment Share is pressed. */}
        <TradeBalanceSummary
          tradeId={tradeId}
          balance={balance}
          isLoading={balanceLoading}
          onRun={run}
        />

        {/* **The reservation** (#639): what stands between this trade and being agreed, and what has
            gone wrong with it since. Under the balance, because both are things the collector reads
            before deciding the trade is settled, and stated here rather than met as a refusal when
            **Agree** is pressed — a blocker discovered by pressing a button is one discovered at the
            worst moment. */}
        <TradeReservationNotice
          reservation={data?.reservation}
          collectionSlug={collectionSlug}
        />

        {/* The lock, stated where it bites. A locked screen with no explanation reads as broken. */}
        {!editable && (
          <p
            style={{
              margin: "1rem 0 0",
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
              lineHeight: 1.5,
            }}
          >
            <Icon name="locked" size="sm" />{" "}
            {trade.status === "agreed"
              ? "Both sides have committed, so the list is locked — the partner is holding a copy of it. Step the trade back to shared to change what is on it."
              : trade.status === "cancelled"
                ? "This trade is cancelled, so its list is read-only. Mark it preparing again to pick it back up."
                : "A closed trade is history: its list is read-only."}
          </p>
        )}

        {actionError && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {actionError}
          </p>
        )}
      </section>

      {/* ── How both sides are broken up ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
        }}
      >
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          Group by
        </span>
        {/* Independent switches rather than one mode, because they **nest**: area and issue together
            is a real question ("what Polish series is in here"), not two questions asked twice. They
            always nest in the module's own order, so the chips read as a list of levels rather than
            as a sequence the collector has to get right. Off is flat, which is the default: most
            trades are small enough that a heading over three lines is furniture. */}
        {TRADE_GROUP_LEVELS.map((level) => (
          <Tooltip key={level} content={TRADE_GROUP_HINT[level]}>
            <span>
              <FilterChip
                label={TRADE_GROUP_LABEL[level]}
                active={levels.includes(level)}
                onClick={() =>
                  setStoredLevels((prev) => {
                    const next = new Set(prev);
                    if (next.has(level)) next.delete(level);
                    else next.add(level);
                    return next;
                  })
                }
              />
            </span>
          </Tooltip>
        ))}
      </div>

      {/* ── Both sides, per section ───────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {sections.map((section) => (
          <TradeSectionCard
            key={section.id}
            collectionId={collectionId}
            tradeId={tradeId}
            section={section}
            rule={resolveBalanceRule(rule, section)}
            balance={balance?.sections.find((b) => b.sectionId === section.id)}
            lineValues={balance?.lines}
            tradeCurrency={balance?.tradeCurrency ?? trade.currency}
            agreedVendorName={balance?.agreedCatalogVendorName ?? trade.catalogVendorName}
            catalogVendors={catalogVendors}
            editable={editable}
            isPending={isPending}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            vendorMaps={vendorMaps}
            levels={levels}
            onRun={run}
            onEditSection={() => setDialog({ kind: "editSection", section })}
            onDeleteSection={() => setDialog({ kind: "deleteSection", section })}
          />
        ))}
      </div>

      {/* ── The whole trade ───────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          ...CARD,
          marginTop: "1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        {editable && (
          <button type="button" style={ADD_BUTTON} disabled={isPending} onClick={() => setDialog({ kind: "addSection" })}>
            <Icon name="add" size="sm" /> Add section
          </button>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip content="Copies I give, across every section">
          <span style={CHIP}>I give {giveTotal}</span>
        </Tooltip>
        <Tooltip
          content={
            receiveTotal === receiveLines
              ? "Stamps I receive, across every section"
              : `${receiveLines} line${receiveLines === 1 ? "" : "s"}, ${receiveTotal} piece${receiveTotal === 1 ? "" : "s"}`
          }
        >
          <span style={CHIP}>
            I receive {receiveTotal}
            {receiveTotal === receiveLines ? "" : ` (${receiveLines} lines)`}
          </span>
        </Tooltip>
      </div>

      {dialog.kind === "editTrade" && (
        <TradeFormDialog
          mode="edit"
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          catalogVendors={catalogVendors}
          trade={trade}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(formData) =>
            startTransition(async () => {
              const result = await updateTradeAction(tradeId, formData);
              if (result.status === "success") {
                setDialog({ kind: "none" });
                setActionError(undefined);
                invalidateTrade(collectionId);
                // A save may have created the partner on the fly; refresh the picker's cache.
                invalidatePartners(collectionId);
              } else {
                setActionError(result.message);
              }
            })
          }
        />
      )}

      {(dialog.kind === "addSection" || dialog.kind === "editSection") && (
        <TradeSectionDialog
          mode={dialog.kind === "addSection" ? "add" : "edit"}
          tradeId={tradeId}
          section={dialog.kind === "editSection" ? dialog.section : undefined}
          trade={rule}
          onClose={closeDialog}
          onDone={() => {
            setDialog({ kind: "none" });
            setActionError(undefined);
            invalidateTrade(collectionId);
          }}
        />
      )}

      {dialog.kind === "deleteSection" && (
        <ConfirmDialog
          title="Delete section"
          message={`Delete “${dialog.section.name}”? Only an empty section can go — its lines are not moved anywhere by implication.`}
          actionLabel="Delete section"
          pendingLabel="Deleting…"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            const sectionId = dialog.section.id;
            setActionError(undefined);
            startTransition(async () => {
              const result = await deleteTradeSectionAction(sectionId);
              if (result.status === "success") {
                setDialog({ kind: "none" });
                invalidateTrade(collectionId);
              } else {
                setActionError(result.message);
              }
            });
          }}
        />
      )}

      {dialog.kind === "deleteTrade" && (
        <ConfirmDialog
          title="Delete trade"
          message={`Delete trade #${trade.tradeNo} with ${trade.partnerName}? Its sections and both sides' lines go with it. The copies it named stay in your collection.`}
          actionLabel="Delete trade"
          pendingLabel="Deleting…"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() =>
            startTransition(async () => {
              const result = await deleteTradeAction(tradeId);
              if (result.status === "success") {
                invalidateTrade(collectionId);
                router.push(`/c/${collectionSlug}/trades`);
              } else {
                setActionError(result.message);
              }
            })
          }
        />
      )}
    </>
  );
}

/**
 * **The reservation, stated on the trade** (#639).
 *
 * Two notices and not one, because they are two different kinds of fact and a collector acts on them
 * differently:
 *
 *  - **A collision blocks.** A give-side copy that is live on a marketplace stops this trade being
 *    agreed, because promising a partner a stamp a stranger can buy in the next minute is a promise
 *    that cannot be kept. Drawn in error, and it names the listings, because what resolves it is
 *    pausing or withdrawing one of them.
 *  - **A departure warns, and never blocks.** A promised copy that has sold elsewhere or stopped
 *    being held is already gone; refusing to record the agreement would not bring it back. Drawn in
 *    warning, and what resolves it is a withdrawal (#642).
 *
 * Absent entirely when there is nothing to say — a panel that draws an empty reassurance on every
 * trade is a panel a collector stops reading.
 */
function TradeReservationNotice({
  reservation,
  collectionSlug,
}: {
  reservation: TradeReservationRead | undefined;
  collectionSlug: string;
}) {
  if (!reservation) return null;
  const { listed, messages } = reservation;
  if (!messages.listed && messages.departed.length === 0) return null;

  return (
    <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
      {messages.listed && (
        <div style={noticeStyle("error")}>
          <p style={NOTICE_TEXT}>
            <Icon name="warning" size="sm" /> {messages.listed}
          </p>
          {/* One link per colliding listing. The sentence above already names them; these are what
              turns "go and find offer #14" into a click, which is the whole difference between a
              refusal a collector can act on and one they have to work around. */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.375rem" }}>
            {[...new Map(listed.map((c) => [c.offer.offerId, c.offer])).values()].map((offer) => (
              <Link
                key={offer.offerId}
                href={`/c/${collectionSlug}/offers/${offer.offerId}`}
                style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
              >
                <Icon name="sell" size="sm" /> #{offer.offerNo} on {offer.platformName}
              </Link>
            ))}
          </div>
        </div>
      )}
      {messages.departed.length > 0 && (
        <div style={noticeStyle("warning")}>
          {messages.departed.map((message) => (
            <p key={message} style={NOTICE_TEXT}>
              <Icon name="warning" size="sm" /> {message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const NOTICE_TEXT: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
};

function noticeStyle(token: "error" | "warning"): React.CSSProperties {
  return {
    padding: "0.625rem 0.75rem",
    borderRadius: "0.5rem",
    border: `1px solid var(--color-${token}-border)`,
    background: `var(--color-${token}-soft)`,
  };
}
