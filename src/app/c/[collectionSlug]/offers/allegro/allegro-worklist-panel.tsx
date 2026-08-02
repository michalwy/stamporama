"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AllegroWorklist, WorklistOffer, WorklistOrder } from "@/lib/allegro-worklist";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { syncAllegroNowAction } from "@/app/actions/allegro";
import { formatInstant, formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { SellOfferFlowDialog, type SellableOfferSubject } from "../sell-offer-flow-dialog";

/**
 * The Allegro sold-listing worklist (#467).
 *
 * Two sections, in the order the work comes in: what has sold and is waiting to be recorded, and —
 * beside it, never mixed into it — the listings that ended without selling. They are separated
 * because they ask for different things: the first is a sale to record, the second an offer whose
 * state here is now wrong. A list that mixed the two would stop being a list that empties.
 *
 * The header is the honesty of the whole screen. A worklist that has not synced for an hour, or one
 * whose last pass failed, says so where it is being read — a stale list that looks current is the
 * failure mode this feature is designed against.
 */

const MUTED = "var(--color-text-muted)";

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  padding: "0.875rem 1rem",
};

const BUTTON: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 600,
  cursor: "pointer",
};

function Chip({ label, tone }: { label: string; tone: "neutral" | "warn" | "good" }) {
  const colors = {
    neutral: { fg: MUTED, bg: "var(--color-bg-subtle)" },
    warn: { fg: "var(--color-warning)", bg: "var(--color-warning-soft)" },
    good: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  }[tone];
  return (
    <span
      style={{
        fontSize: "0.6875rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        padding: "0.125rem 0.375rem",
        borderRadius: "0.25rem",
        color: colors.fg,
        background: colors.bg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/**
 * The two questions worth narrowing a sold worklist by (#467), and they are **two axes, not one
 * list of chips**: whether the buyer has paid, and whether the line found its offer here. They are
 * independent — "paid but unmatched" is a real and interesting session — so each is its own
 * multi-select, OR-matched within itself and AND-matched across the two, exactly as the offers
 * list's state chips work (#475). Nothing selected on an axis means that axis is not asking.
 *
 * Filtered **client-side**, like the bulk listing workspace's facets (#322) and for the same reason:
 * the worklist is one unpaginated batch, so a page boundary is not in the way and an instant facet
 * beats a round trip.
 */
type PaymentFilter = "paid" | "unpaid";
type MatchFilter = "matched" | "unmatched";

/**
 * Apply both axes.
 *
 * The match axis is a fact about a **line** and the payment axis a fact about the **order**, so they
 * are applied at those two levels: an order's lines are narrowed first, and an order left with no
 * line falls out entirely. Filtering whole orders on "does any line match" would show, under
 * *Unmatched*, the matched lines of a mixed order — which is the opposite of what was asked for.
 */
function filterOrders(
  orders: WorklistOrder[],
  payment: PaymentFilter[],
  match: MatchFilter[]
): WorklistOrder[] {
  return orders.flatMap((order) => {
    if (payment.length > 0 && !payment.includes(order.paymentStatus === "paid" ? "paid" : "unpaid")) {
      return [];
    }
    if (match.length === 0) return [order];
    const lines = order.lines.filter((line) =>
      match.includes(line.offer ? "matched" : "unmatched")
    );
    return lines.length > 0 ? [{ ...order, lines }] : [];
  });
}

function useAllegroWorklist(collectionId: string) {
  return useQuery<AllegroWorklist>({
    queryKey: ["allegro-worklist", collectionId],
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/allegro/worklist`);
      if (!res.ok) throw new Error("Failed to load the Allegro worklist");
      return res.json();
    },
    refetchOnWindowFocus: true,
  });
}

/** The subject the existing sell flow takes (#225/#390). Reused rather than re-implemented, so a row
 *  here records a sale exactly as the offer's own screen does — #463 is what will pre-fill it from
 *  the order itself. */
function subjectOf(offer: WorklistOffer): SellableOfferSubject {
  return {
    id: offer.id,
    name: offer.name,
    label: offer.label,
    platformId: offer.platformId,
    platformName: offer.platformName,
    price: offer.price,
    currency: offer.currency,
  };
}

export function AllegroWorklistPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  today,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  today: string;
}) {
  const { data, isLoading, error } = useAllegroWorklist(collectionId);
  const queryClient = useQueryClient();
  const [isSyncing, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);
  const [selling, setSelling] = useState<WorklistOffer | null>(null);
  const [payment, setPayment] = useState<PaymentFilter[]>([]);
  const [match, setMatch] = useState<MatchFilter[]>([]);
  const now = new Date();

  const orders = data?.orders;
  const shown = useMemo(() => filterOrders(orders ?? [], payment, match), [orders, payment, match]);
  // Counted over the **whole** batch, not over what the chips currently leave: a count that moved
  // as you filtered would say nothing about what is there to be filtered to.
  const counts = useMemo(() => {
    const all = orders ?? [];
    const lines = all.flatMap((order) => order.lines);
    return {
      paid: all.filter((order) => order.paymentStatus === "paid").length,
      unpaid: all.filter((order) => order.paymentStatus !== "paid").length,
      matched: lines.filter((line) => line.offer).length,
      unmatched: lines.filter((line) => !line.offer).length,
    };
  }, [orders]);

  function toggle<T>(values: T[], value: T, set: (next: T[]) => void) {
    set(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  const runSync = () => {
    setSyncMessage(null);
    startSync(async () => {
      const result = await syncAllegroNowAction(collectionId);
      setSyncMessage(
        result.status === "success"
          ? { tone: "ok", text: result.detail }
          : { tone: "error", text: result.message }
      );
      await queryClient.invalidateQueries({ queryKey: ["allegro-worklist", collectionId] });
    });
  };

  if (isLoading) {
    return <p style={{ color: MUTED, fontSize: "0.875rem" }}>Loading…</p>;
  }
  if (error || !data) {
    return (
      <p style={{ color: "var(--color-error)", fontSize: "0.875rem" }}>
        The Allegro worklist could not be loaded.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <SyncHeader
        data={data}
        now={now}
        collectionSlug={collectionSlug}
        isSyncing={isSyncing}
        onSync={runSync}
        message={syncMessage}
      />

      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <SectionHeading
          title="Sold, awaiting sale"
          count={data.orders.length}
          hint="Orders Allegro has, with no sale recorded here yet."
        />

        {data.orders.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
            <FilterChip
              label="Paid"
              count={counts.paid}
              active={payment.includes("paid")}
              onClick={() => toggle(payment, "paid", setPayment)}
            />
            <FilterChip
              label="Not paid"
              count={counts.unpaid}
              active={payment.includes("unpaid")}
              onClick={() => toggle(payment, "unpaid", setPayment)}
            />
            <span
              style={{
                width: "1px",
                height: "1.25rem",
                background: "var(--color-border)",
                margin: "0 0.25rem",
              }}
            />
            {/* Counted in **lines**, not orders, because that is the level the match is decided at —
                a mixed order is one order with two answers in it. */}
            <FilterChip
              label="Matched"
              count={counts.matched}
              active={match.includes("matched")}
              onClick={() => toggle(match, "matched", setMatch)}
            />
            <FilterChip
              label="Unmatched"
              count={counts.unmatched}
              // Unmatched lines are a gap in the record rather than an ordinary state, so the chip
              // alarms until there are none — the same treatment Needs action gets on the offers list.
              alarm={counts.unmatched > 0}
              active={match.includes("unmatched")}
              onClick={() => toggle(match, "unmatched", setMatch)}
            />
            {(payment.length > 0 || match.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setPayment([]);
                  setMatch([]);
                }}
                style={{
                  ...BUTTON,
                  border: "none",
                  background: "none",
                  color: "var(--color-accent)",
                  fontWeight: 400,
                }}
              >
                Clear filters
              </button>
            )}
            <span style={{ fontSize: "0.75rem", color: MUTED }}>
              {shown.length} of {data.orders.length} shown
            </span>
          </div>
        )}

        {data.orders.length === 0 ? (
          <p style={{ color: MUTED, fontSize: "0.875rem", margin: 0 }}>
            Nothing is waiting. Every order the last sync saw is already recorded as a sale.
          </p>
        ) : shown.length === 0 ? (
          <p style={{ color: MUTED, fontSize: "0.875rem", margin: 0 }}>
            No order matches these filters.
          </p>
        ) : (
          shown.map((order) => (
            <div key={order.orderId} style={CARD}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.625rem",
                }}
              >
                <strong style={{ fontSize: "0.875rem" }}>Order {order.orderId}</strong>
                <Chip
                  label={order.paymentStatus === "paid" ? "Paid" : "Not paid yet"}
                  tone={order.paymentStatus === "paid" ? "good" : "warn"}
                />
                <span
                  style={{ fontSize: "0.75rem", color: MUTED }}
                  title={formatInstant(order.boughtAt)}
                >
                  bought {formatRelative(order.boughtAt, now)}
                </span>
                <span
                  style={{ marginLeft: "auto", fontSize: "0.6875rem", color: MUTED }}
                  title={formatInstant(order.observedAt)}
                >
                  seen {formatRelative(order.observedAt, now)}
                </span>
                {/* The order's value, at the card's right edge — money is right-aligned everywhere
                    in the app. It is Allegro's own `totalToPay`, so it includes delivery, which is
                    what makes it the figure the buyer actually paid rather than a sum of goods. */}
                {order.totalPaid && (
                  <strong
                    style={{ fontSize: "0.875rem", fontVariantNumeric: "tabular-nums" }}
                    title="What the buyer paid in total, delivery included"
                  >
                    {order.totalPaid} {order.currency}
                  </strong>
                )}
              </div>

              {/* Who bought it. The login is what Allegro itself shows and what a message to them is
                  addressed to; the name follows it where the order states one. Nothing else about
                  the buyer is read — that belongs to the sale, not to a list of what has sold. */}
              <div style={{ fontSize: "0.75rem", color: MUTED, marginBottom: "0.625rem" }}>
                {order.buyerLogin || order.buyerName ? (
                  <>
                    Buyer{" "}
                    <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>
                      {order.buyerLogin ?? order.buyerName}
                    </span>
                    {order.buyerLogin && order.buyerName ? ` (${order.buyerName})` : ""}
                  </>
                ) : (
                  "Buyer not stated by Allegro"
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {order.lines.map((line) => {
                  // Bound out of the row so the match is narrowed for the click handler too — a
                  // property read inside a callback is not narrowed by the check around it.
                  const offer = line.offer;
                  return (
                  <div
                    key={line.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      fontSize: "0.8125rem",
                      paddingTop: "0.5rem",
                      borderTop: "1px solid var(--color-border)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{line.title}</div>
                      <div style={{ color: MUTED, fontSize: "0.75rem" }}>
                        {line.quantity} × {line.unitPrice} {line.currency} ·{" "}
                        <a
                          href={`https://allegro.pl/oferta/${line.platformOfferId}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--color-accent)", textDecoration: "none" }}
                        >
                          offer {line.platformOfferId}
                        </a>
                      </div>
                    </div>

                    {offer ? (
                      <>
                        <Link
                          href={`/c/${collectionSlug}/offers/${offer.id}`}
                          style={{
                            color: "var(--color-accent)",
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                          }}
                          title={`Matched by ${line.matchedBy === "external" ? "the listing's external id" : "the stored listing URL"}`}
                        >
                          #{offer.offerNo} {offer.label}
                        </Link>
                        <button
                          type="button"
                          style={BUTTON}
                          onClick={() => setSelling(offer)}
                          disabled={offer.state === "sold"}
                        >
                          Record sale
                        </button>
                      </>
                    ) : (
                      // Reported, never dropped: an unmatched line is how the collector learns a
                      // listing was posted outside Stamporama, or that its URL was never recorded.
                      <span title="No offer in this collection carries this Allegro offer id, either as a listing URL or as the listing's external id.">
                        <Chip label="Unmatched" tone="warn" />
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <SectionHeading
          title="Ended without selling"
          count={data.ended.length}
          hint="Listings no longer up on Allegro, whose offer here is still live."
        />
        {data.ended.length === 0 ? (
          <p style={{ color: MUTED, fontSize: "0.875rem", margin: 0 }}>
            Every live offer here is still up on Allegro.
          </p>
        ) : (
          data.ended.map((listing) => (
            <div
              key={listing.platformOfferId}
              style={{ ...CARD, display: "flex", alignItems: "center", gap: "0.75rem" }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{listing.title}</div>
                <div style={{ color: MUTED, fontSize: "0.75rem" }}>
                  <span title={formatInstant(listing.lastSeenAt)}>
                    last seen up {formatRelative(listing.lastSeenAt, now)}
                  </span>{" "}
                  ·{" "}
                  <a
                    href={`https://allegro.pl/oferta/${listing.platformOfferId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--color-accent)", textDecoration: "none" }}
                  >
                    offer {listing.platformOfferId}
                  </a>
                </div>
              </div>
              <Chip label={listing.offer.state} tone="neutral" />
              <Link
                href={`/c/${collectionSlug}/offers/${listing.offer.id}`}
                style={{
                  color: "var(--color-accent)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  fontSize: "0.8125rem",
                }}
              >
                #{listing.offer.offerNo} {listing.offer.label} →
              </Link>
            </div>
          ))
        )}
      </section>

      {selling && (
        <SellOfferFlowDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          today={today}
          offer={subjectOf(selling)}
          onClose={() => {
            setSelling(null);
            void queryClient.invalidateQueries({ queryKey: ["allegro-worklist", collectionId] });
          }}
        />
      )}
    </div>
  );
}

function SectionHeading({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
      <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{title}</h3>
      <span style={{ fontSize: "0.8125rem", color: MUTED }}>({count})</span>
      <span style={{ fontSize: "0.75rem", color: MUTED }}>{hint}</span>
    </div>
  );
}

/**
 * When this list was last true, and what to do when it is not.
 *
 * The four things that can be wrong are four different sentences, because each is fixed somewhere
 * different: no connection, a grant that needs reconnecting, no platform marked as Allegro, and a
 * pass that failed. None of them is allowed to render as a quietly empty list.
 */
function SyncHeader({
  data,
  now,
  collectionSlug,
  isSyncing,
  onSync,
  message,
}: {
  data: AllegroWorklist;
  now: Date;
  collectionSlug: string;
  isSyncing: boolean;
  onSync: () => void;
  message: { tone: "ok" | "error"; text: string } | null;
}) {
  const settings = `/c/${collectionSlug}/settings?tab=allegro`;
  const { sync } = data;

  return (
    <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div style={{ fontSize: "0.8125rem", color: MUTED }}>
          {sync.lastSucceededAt ? (
            <span title={formatInstant(sync.lastSucceededAt)}>
              Last synced {formatRelative(sync.lastSucceededAt, now)}
            </span>
          ) : (
            <span>Not synced yet</span>
          )}
        </div>
        <button
          type="button"
          style={{ ...BUTTON, marginLeft: "auto", opacity: isSyncing ? 0.6 : 1 }}
          onClick={onSync}
          disabled={isSyncing || !data.connected}
        >
          {isSyncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {!data.connected && (
        <Notice tone="warn">
          This collection is not connected to Allegro. Connect it under{" "}
          <Link href={settings} style={{ color: "var(--color-accent)" }}>
            Settings → Allegro
          </Link>
          .
        </Notice>
      )}

      {data.connected && data.needsReconnect && (
        <Notice tone="error">
          The Allegro connection needs reconnecting
          {data.connectionError ? `: ${data.connectionError}` : "."} Fix it under{" "}
          <Link href={settings} style={{ color: "var(--color-accent)" }}>
            Settings → Allegro
          </Link>
          .
        </Notice>
      )}

      {data.connected && !data.platform && (
        <Notice tone="warn">
          No platform in this collection is marked as Allegro, so nothing that sells there can be
          matched to an offer here. Set one under{" "}
          <Link href={settings} style={{ color: "var(--color-accent)" }}>
            Settings → Allegro
          </Link>
          .
        </Notice>
      )}

      {sync.lastError && (
        <Notice tone="error">
          The last sync failed
          {sync.lastFailedAt ? ` ${formatRelative(sync.lastFailedAt, now)}` : ""}: {sync.lastError}
          {sync.lastSucceededAt
            ? " Everything below is what the last successful pass saw."
            : " Nothing below has been synced yet."}
        </Notice>
      )}

      {!sync.lastError && sync.freshness === "stale" && (
        <Notice tone="warn">
          This list has not been refreshed for over an hour. Sync now to be sure it is current.
        </Notice>
      )}

      {message && (
        <Notice tone={message.tone === "ok" ? "ok" : "error"}>{message.text}</Notice>
      )}
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const color =
    tone === "error" ? "var(--color-error)" : tone === "warn" ? "var(--color-warning)" : MUTED;
  return <div style={{ fontSize: "0.8125rem", color }}>{children}</div>;
}
