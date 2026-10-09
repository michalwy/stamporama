"use client";

import Link from "next/link";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import type {
  ContactAuctions,
  ContactPage,
  ContactPlatform,
  ContactPurchases,
  ContactSales,
  ContactTradeValue,
  ContactTrades,
} from "@/lib/contact-page";
import {
  CONTACT_PERIOD_LABELS,
  CONTACT_PERIODS,
  DEFAULT_CONTACT_PERIOD,
  isContactPeriod,
  NOT_DELIVERED_PURCHASE_STATUSES,
  OPEN_TRADE_STATUSES,
  UNPAID_SALE_STATUSES,
  UNSENT_SALE_STATUSES,
  type MoneyTotal,
} from "@/lib/contact-page-rules";
import { costPercent, formatCostPercent, type CostToCatalog } from "@/lib/cost-to-catalog";
import { COMMON_MARKETS } from "@/lib/market-anchoring";
import { AUCTION_SALE_STATUS_LABEL, type AuctionLotOutcome } from "@/lib/auction-rules";
import { TAG_FILTER_PARAM, TAG_MODE_PARAM } from "@/lib/tag-filter";
import { PURCHASE_STATUS_META, type PurchaseStatus } from "@/lib/purchase-status";
import { isTradeStatus } from "@/lib/trade-rules";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import {
  DETAIL_BUTTON,
  DetailCard,
  DetailColumn,
  DetailColumns,
  DetailFullRow,
  DetailLayout,
  EmptyNote,
  Field,
  FieldGrid,
} from "@/app/c/[collectionSlug]/shared/detail-page";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { saleStatusChipStyle, saleStatusMeta } from "@/app/c/[collectionSlug]/sales/sale-status";
import { statusChip as tradeStatusChip } from "@/app/c/[collectionSlug]/trades/trade-row";
import { CONTACT_ROLES } from "../contact-roles";
import { ContactFormDialog } from "../contact-form-dialog";
import { useContactPage, useInvalidateContacts } from "../use-contacts-query";

// A contact's own page (#1708): who the contact is, and what the collector has done with them — one
// section per role. The figures are `contact-page.ts`' read; this only lays them out, and links each
// to the list it counts, narrowed to this contact.
//
// **A page that reads** (AGENTS.md): the identity band's *Edit* opens the very dialog the contacts
// list opens, rather than the fields becoming editable here. Drawn with the detail-page kit, on its
// split: the left column is who the contact is, the right what the collection has done with them.

const CHIP: CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const META: CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-secondary)" };

const LINK: CSSProperties = { color: "var(--color-accent)", textDecoration: "none" };

const MUTED: CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

const FIGURE_LINK: CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
  textDecoration: "none",
};

interface ContactDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  contactId: string;
}

export function ContactDetailPanel({ collectionId, collectionSlug, contactId }: ContactDetailPanelProps) {
  const hydrated = useHydrated();
  // The period is remembered per collection, not per contact: it is the question being asked of the
  // address book (*what happened this year*), and it should still be asked on the next contact.
  const [storedPeriod, rememberPeriod] = usePersistedCollectionValue("contact-period", collectionId);
  const period = isContactPeriod(storedPeriod) ? storedPeriod : DEFAULT_CONTACT_PERIOD;
  const { data, isLoading, isError } = useContactPage(collectionId, contactId, period, hydrated);

  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidate } = useInvalidateContacts();
  const { toast } = useToast();

  if (isError) return <EmptyNote>The contact could not be loaded just now.</EmptyNote>;
  if (isLoading || !data) return <EmptyNote>Loading contact…</EmptyNote>;

  const { contact } = data;
  const roles = CONTACT_ROLES.filter(({ key }) => contact[key]);
  const purchasesHref = (statuses: readonly string[] = []) =>
    `/c/${collectionSlug}/purchases?${new URLSearchParams({
      // A purchase, not a trade's incoming half nor an opening balance — what the section counts.
      type: "purchase",
      supplier: contact.id,
      // Named empty so a filter remembered on the list does not narrow what the figure counted.
      platform: "",
      status: statuses.join(","),
    })}`;
  const salesHref = (statuses: readonly string[] = []) =>
    `/c/${collectionSlug}/sales?${new URLSearchParams({
      buyer: contact.id,
      // The list remembers its status and search; named empty, neither narrows the figure.
      status: statuses.join(","),
      search: "",
    })}`;
  // The platform section's three lists (#1710), each narrowed to this platform and, by the same
  // empty-param rule as above, to nothing the list happens to remember.
  const platformHrefs: PlatformHrefs = {
    offers: (state: string) =>
      `/c/${collectionSlug}/offers?${new URLSearchParams({ platform: contact.id, state, search: "" })}`,
    sales: `/c/${collectionSlug}/sales?${new URLSearchParams({ platform: contact.id, status: "", search: "" })}`,
    purchases: `/c/${collectionSlug}/purchases?${new URLSearchParams({
      type: "purchase",
      platform: contact.id,
      supplier: "",
      status: "",
    })}`,
    settings: (tab: string) => `/c/${collectionSlug}/settings?tab=${tab}`,
  };
  const tradesHref = (statuses: readonly string[] = []) =>
    `/c/${collectionSlug}/trades?${new URLSearchParams({
      partner: contact.id,
      status: statuses.join(","),
      search: "",
    })}`;

  const lotsHref = ({
    outcome = "",
    includeClosed = false,
    toReview = false,
  }: { outcome?: AuctionLotOutcome | ""; includeClosed?: boolean; toReview?: boolean } = {}) =>
    `/c/${collectionSlug}/auctions?${new URLSearchParams({
      seller: contact.id,
      outcome,
      // With no outcome the list hides closed lots (#504); a figure counting them opens it with them.
      includeClosed: includeClosed ? "1" : "",
      toReview: toReview ? "1" : "",
      // The list remembers every filter (#1018); named empty, none narrows what the figure counted.
      platform: "",
      search: "",
      closing: "",
      signal: "",
      undescribed: "",
      conditionToSettle: "",
      duplicate: "",
      [TAG_FILTER_PARAM]: "",
      [TAG_MODE_PARAM]: "",
    })}`;

  return (
    <DetailLayout>
      <DetailFullRow style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {contact.name}
        </h2>
        {roles.map(({ key, label }) => (
          <span key={key} style={CHIP}>
            {label}
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>
          <button type="button" style={DETAIL_BUTTON} onClick={() => setEditing(true)}>
            <Icon name="edit" size="sm" /> Edit
          </button>
        </span>
      </DetailFullRow>

      {/* The period narrows every figure on the page. */}
      <DetailFullRow style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        {CONTACT_PERIODS.map((p) => (
          <FilterChip
            key={p}
            label={CONTACT_PERIOD_LABELS[p]}
            active={period === p}
            onClick={() => rememberPeriod(p)}
          />
        ))}
      </DetailFullRow>

      <DetailColumns>
        <DetailColumn>
          <ContactCard data={data} />
        </DetailColumn>
        <DetailColumn>
          {data.purchases && (
            <PurchasesCard purchases={data.purchases} collectionSlug={collectionSlug} href={purchasesHref} />
          )}
          {data.sales && (
            <SalesCard sales={data.sales} collectionSlug={collectionSlug} href={salesHref} />
          )}
          {data.auctions && (
            <AuctionsCard auctions={data.auctions} collectionSlug={collectionSlug} href={lotsHref} />
          )}
          {data.platform && <PlatformCard platform={data.platform} href={platformHrefs} />}
          {data.trades && (
            <TradesCard
              trades={data.trades}
              baseCurrency={data.baseCurrency}
              collectionSlug={collectionSlug}
              href={tradesHref}
            />
          )}
          {!data.purchases && !data.sales && !data.auctions && !data.platform && !data.trades && (
            <DetailCard title="Activity">
              <EmptyNote>
                Nothing recorded with {contact.name} yet. Give the contact the Seller, Buyer, Auction
                house, Platform or Exchange partner role to see those sections before anything is
                recorded.
              </EmptyNote>
            </DetailCard>
          )}
        </DetailColumn>
      </DetailColumns>

      {editing && (
        <ContactFormDialog
          mode="edit"
          collectionId={collectionId}
          contact={contact}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setEditing(false);
              setError(undefined);
            }
          }}
          onSubmit={(fd) => {
            startTransition(async () => {
              const { updateContactAction } = await import("@/app/actions/contacts");
              const result = await updateContactAction(contact.id, fd);
              if (result.status === "success") {
                setEditing(false);
                setError(undefined);
                // The page reads through the contacts query, so the list's invalidation refreshes it.
                invalidate(collectionId);
                toast({ message: `${(fd.get("name") as string) || "Contact"} saved` });
              } else if (result.status === "error") setError(result.message);
            });
          }}
        />
      )}
    </DetailLayout>
  );
}

/** Who the contact is — every field, an empty one as a dash, since it is part of the record. */
function ContactCard({ data }: { data: ContactPage }) {
  const c = data.contact;
  const market = c.market ? (COMMON_MARKETS.find((m) => m.code === c.market)?.label ?? c.market) : null;
  return (
    <DetailCard title="Contact">
      <FieldGrid>
        <Field label="Full name">{c.fullName}</Field>
        <Field label="Email">
          {c.email && (
            <a href={`mailto:${c.email}`} style={LINK}>
              {c.email}
            </a>
          )}
        </Field>
        <Field label="Phone">{c.phone}</Field>
        <Field label="Facebook">
          {c.facebookProfileUrl && (
            <a href={c.facebookProfileUrl} target="_blank" rel="noopener noreferrer" style={LINK}>
              Profile ↗
            </a>
          )}
        </Field>
        <Field label="Market">{market}</Field>
      </FieldGrid>
      {c.notes && (
        <div style={{ marginTop: "0.75rem" }}>
          <Field label="Notes">
            <span style={{ whiteSpace: "pre-wrap" }}>{c.notes}</span>
          </Field>
        </div>
      )}
    </DetailCard>
  );
}

/** One figure: its label, and its value as a link to the list it counts. */
function Figure({
  label,
  href,
  hint,
  children,
}: {
  label: string;
  href: string | null;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Field label={label}>
      <span style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
        {href ? (
          <Link href={href} style={FIGURE_LINK}>
            {children}
          </Link>
        ) : (
          <span style={{ ...FIGURE_LINK, color: "var(--color-text-muted)" }}>{children}</span>
        )}
        {hint && <span style={{ ...MUTED, fontSize: "0.75rem" }}>{hint}</span>}
      </span>
    </Field>
  );
}
/** A money total in the base currency, the transaction currency's beside it where all share one. An
 * unconvertible total says so instead of stating part of it. */
function Money({ total, noun }: { total: MoneyTotal; noun: string }) {
  if (total.base == null) {
    return (
      <Tooltip
        content={`${total.unconvertedCount} ${noun}${total.unconvertedCount === 1 ? " has" : "s have"} no exchange rate into ${total.baseCurrency}, so no ${total.baseCurrency} total is stated rather than a partial one.`}
      >
        <span>
          {total.tx ? `${total.tx.total} ${total.tx.currency}` : `No ${total.baseCurrency} total`}
        </span>
      </Tooltip>
    );
  }
  return (
    <span>
      {total.base} {total.baseCurrency}
      {total.tx && (
        <span style={{ ...MUTED, fontWeight: 400, marginLeft: "0.4rem" }}>
          {total.tx.total} {total.tx.currency}
        </span>
      )}
    </span>
  );
}

function moneyHint(total: MoneyTotal, noun: string): string | undefined {
  if (total.base != null || total.unconvertedCount === 0) return undefined;
  return `${total.unconvertedCount} ${noun}${total.unconvertedCount === 1 ? "" : "s"} without an exchange rate`;
}

/** The share of catalogue, in #1395's vocabulary: `~` for an estimate, *at most* for an upper bound. */
function CatalogShare({ ratio, currency }: { ratio: CostToCatalog; currency: string }) {
  const pct = formatCostPercent(costPercent(ratio));
  const amounts = `${ratio.cost.toFixed(2)} ${currency} against ${ratio.value.toFixed(2)} ${currency} of catalog value`;
  const tooltip =
    ratio.kind === "at_most"
      ? `An upper bound: ${ratio.unpricedCount} copies have no catalog price yet, and pricing those in open lots can only bring it down — ${amounts}.`
      : ratio.kind === "estimate"
        ? `An estimate: some lots are still open, so their cost is not yet frozen onto copies — ${amounts}.`
        : `What these purchases cost as a share of their copies' catalog value — ${amounts}.`;
  return (
    <Tooltip content={tooltip}>
      <span style={ratio.kind === "settled" ? undefined : { fontStyle: "italic", color: "var(--color-text-secondary)" }}>
        {ratio.kind === "at_most" ? `at most ${pct}` : `${ratio.kind === "settled" ? "" : "~"}${pct}`}
      </span>
    </Tooltip>
  );
}

function PurchasesCard({
  purchases: p,
  collectionSlug,
  href,
}: {
  purchases: ContactPurchases;
  collectionSlug: string;
  href: (statuses?: readonly string[]) => string;
}) {
  const ratio = p.costToCatalog;
  return (
    <DetailCard title="Purchases · as seller">
      <FieldGrid min="10rem">
        <Figure label="Purchases" href={href()}>
          {p.count}
        </Figure>
        <Figure label="Total spent" href={href()} hint={moneyHint(p.spent, "purchase")}>
          <Money total={p.spent} noun="purchase" />
        </Figure>
        <Figure
          label="Share of catalogue"
          href={ratio ? href() : null}
          hint={ratio && ratio.coveredCount < ratio.copyCount ? `over ${ratio.coveredCount} of ${ratio.copyCount} copies` : undefined}
        >
          {ratio ? <CatalogShare ratio={ratio} currency={p.spent.baseCurrency} /> : "—"}
        </Figure>
        <Figure label="Copies bought" href={href()}>
          {p.copyCount}
        </Figure>
        <Figure
          label="Last purchase"
          href={p.lastPurchaseId ? `/c/${collectionSlug}/purchases/${p.lastPurchaseId}` : null}
        >
          {p.lastPurchasedAt ?? "—"}
        </Figure>
        <Figure label="Not yet delivered" href={href(NOT_DELIVERED_PURCHASE_STATUSES)}>
          {p.notDeliveredCount}
        </Figure>
      </FieldGrid>

      {p.rows.length === 0 ? (
        <div style={{ marginTop: "1rem" }}>
          <EmptyNote>No purchases in this period.</EmptyNote>
        </div>
      ) : (
        <RowList>
          {p.rows.map((r, i) => {
            const status = PURCHASE_STATUS_META[r.status as PurchaseStatus];
            return (
              <RowLinkItem key={r.id} first={i === 0} href={`/c/${collectionSlug}/purchases/${r.id}`}>
                <EntityNoChip entity="purchase" no={r.purchaseNo} prefix="p" />
                <span style={META}>{r.purchasedAt}</span>
                {r.platformName && <span style={MUTED}>via {r.platformName}</span>}
                <span style={CHIP}>{status?.label ?? r.status}</span>
                <span style={{ flex: 1 }} />
                <span style={MUTED}>
                  {r.copyCount} cop{r.copyCount === 1 ? "y" : "ies"}
                </span>
                <span style={AMOUNT}>
                  {r.total} {r.currency}
                </span>
              </RowLinkItem>
            );
          })}
        </RowList>
      )}
    </DetailCard>
  );
}

function SalesCard({
  sales: s,
  collectionSlug,
  href,
}: {
  sales: ContactSales;
  collectionSlug: string;
  href: (statuses?: readonly string[]) => string;
}) {
  return (
    <DetailCard title="Sales · as buyer">
      <FieldGrid min="10rem">
        <Figure label="Sales" href={href()}>
          {s.count}
        </Figure>
        <Figure label="Revenue" href={href()} hint={moneyHint(s.revenue, "sale")}>
          <Money total={s.revenue} noun="sale" />
        </Figure>
        <Figure label="Copies sold" href={href()}>
          {s.copyCount}
        </Figure>
        <Figure
          label="Last sale"
          href={s.lastSaleId ? `/c/${collectionSlug}/sales/${s.lastSaleId}` : null}
        >
          {s.lastSoldAt ?? "—"}
        </Figure>
        <Figure label="Not yet paid" href={href(UNPAID_SALE_STATUSES)}>
          {s.unpaidCount}
        </Figure>
        <Figure label="Not yet sent" href={href(UNSENT_SALE_STATUSES)}>
          {s.unsentCount}
        </Figure>
      </FieldGrid>

      {s.rows.length === 0 ? (
        <div style={{ marginTop: "1rem" }}>
          <EmptyNote>No sales in this period.</EmptyNote>
        </div>
      ) : (
        <RowList>
          {s.rows.map((r, i) => {
            const meta = saleStatusMeta(r.status);
            return (
              <RowLinkItem key={r.id} first={i === 0} href={`/c/${collectionSlug}/sales/${r.id}`}>
                <EntityNoChip entity="sale" no={r.saleNo} prefix="s" />
                <span style={META}>{r.soldAt}</span>
                <span style={MUTED}>on {r.platformName}</span>
                <span style={saleStatusChipStyle(meta.token)}>{meta.label}</span>
                <span style={{ flex: 1 }} />
                <span style={MUTED}>
                  {r.copyCount} cop{r.copyCount === 1 ? "y" : "ies"}
                </span>
                <span style={AMOUNT}>
                  {r.paid} {r.currency}
                </span>
              </RowLinkItem>
            );
          })}
        </RowList>
      )}
    </DetailCard>
  );
}

function AuctionsCard({
  auctions: a,
  collectionSlug,
  href,
}: {
  auctions: ContactAuctions;
  collectionSlug: string;
  href: (opts?: { outcome?: AuctionLotOutcome | ""; includeClosed?: boolean; toReview?: boolean }) => string;
}) {
  const e = a.exposure;
  const exposureHint =
    e.unconvertibleCount > 0
      ? `${e.unconvertibleCount} lot${e.unconvertibleCount === 1 ? "" : "s"} without an exchange rate left out`
      : undefined;
  return (
    <DetailCard title="Auctions · as seller or auction house">
      <FieldGrid min="10rem">
        <Figure label="Sales tracked" href={href({ includeClosed: true })}>
          {a.saleCount}
        </Figure>
        <Figure label="Lots tracked" href={href({ includeClosed: true })}>
          {a.lotCount}
        </Figure>
        <Figure label="Won" href={href({ outcome: "won" })}>
          {a.wonCount}
        </Figure>
        <Figure label="Lost" href={href({ outcome: "lost" })}>
          {a.lostCount}
        </Figure>
        <Figure label="Cancelled" href={href({ outcome: "cancelled" })}>
          {a.cancelledCount}
        </Figure>
        <Figure
          label="Win rate"
          href={a.winRate == null ? null : href({ outcome: "won" })}
          hint={a.winRate == null ? undefined : `of ${a.wonCount + a.lostCount} bid on and closed`}
        >
          <Tooltip content="Lots won of the lots closed with your bid on them — won and lost. A lot only watched, or cancelled, is neither.">
            <span>{a.winRate == null ? "—" : `${Math.round(a.winRate * 100)}%`}</span>
          </Tooltip>
        </Figure>
        <Figure label="Spent on won lots" href={href({ outcome: "won" })} hint={moneyHint(a.spent, "sale")}>
          <Tooltip content="Every won lot's hammer price with the sale's premium on it, plus each sale's shipping once.">
            <span>
              <Money total={a.spent} noun="sale" />
            </span>
          </Tooltip>
        </Figure>
        <Figure label="Buyer's premium" href={a.premiumTerms.length > 0 ? href({ includeClosed: true }) : null}>
          {a.premiumTerms.length > 0 ? a.premiumTerms.join(" · ") : "—"}
        </Figure>
      </FieldGrid>

      {/* What is still running — as it stands now, whatever the period. */}
      <div style={{ marginTop: "1rem" }}>
        <FieldGrid min="10rem">
          <Figure label="Open lots" href={href({ outcome: "pending" })}>
            {a.openCount}
          </Figure>
          <Figure label="Committed" href={href({ outcome: "pending" })} hint={exposureHint}>
            <Tooltip content="Each open lot at the maximum bid placed on it, premium included, plus each sale's shipping once — the lots list's own figure.">
              <span>
                {e.committedTotal} {e.baseCurrency}
              </span>
            </Tooltip>
          </Figure>
          <Figure label="At ceiling" href={href({ outcome: "pending" })} hint={exposureHint}>
            <Tooltip content="The same if every open lot were bid up to its ceiling.">
              <span>
                {e.ceilingTotal} {e.baseCurrency}
              </span>
            </Tooltip>
          </Figure>
          <Figure label="To review" href={href({ includeClosed: true, toReview: true })}>
            {a.toReviewCount}
          </Figure>
        </FieldGrid>
      </div>

      {a.rows.length === 0 ? (
        <div style={{ marginTop: "1rem" }}>
          <EmptyNote>No auction sales tracked in this period.</EmptyNote>
        </div>
      ) : (
        <RowList>
          {a.rows.map((r, i) => (
            <RowLinkItem key={r.id} first={i === 0} href={`/c/${collectionSlug}/auctions/sales/${r.id}`}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
                {r.name}
              </span>
              <span style={META}>{r.trackedAt}</span>
              <span style={MUTED}>on {r.platformName}</span>
              <span style={CHIP}>{AUCTION_SALE_STATUS_LABEL[r.status]}</span>
              <span style={{ flex: 1 }} />
              <span style={MUTED}>
                {r.openCount} open · {r.wonCount} won · {r.lostCount} lost
              </span>
            </RowLinkItem>
          ))}
        </RowList>
      )}
    </DetailCard>
  );
}

interface PlatformHrefs {
  offers: (state: string) => string;
  sales: string;
  purchases: string;
  settings: (tab: string) => string;
}

const PLATFORM_SETTINGS_LABEL: Record<NonNullable<ContactPlatform["settings"]>, string> = {
  allegro: "Allegro settings",
  delcampe: "Delcampe settings",
  facebook: "Facebook settings",
};

/** The contact as a platform (#1710). Active and ready are today's; the rest are the period's. */
function PlatformCard({ platform: p, href }: { platform: ContactPlatform; href: PlatformHrefs }) {
  const ended = p.soldCount + p.withdrawnCount;
  return (
    <DetailCard title="Platform">
      <FieldGrid min="10rem">
        <Figure label="Offers active" href={href.offers("active")} hint="now">
          {p.activeCount}
        </Figure>
        <Figure label="Offers ready" href={href.offers("ready")} hint="now">
          {p.readyCount}
        </Figure>
        <Figure label="Offers sold" href={href.offers("sold")}>
          {p.soldCount}
        </Figure>
        <Figure label="Sales through it" href={href.sales}>
          {p.salesCount}
        </Figure>
        <Figure label="Revenue" href={href.sales} hint={moneyHint(p.revenue, "sale")}>
          <Money total={p.revenue} noun="sale" />
        </Figure>
        <Figure
          label="Sell-through"
          href={ended > 0 ? href.offers("sold,withdrawn") : null}
          hint={ended > 0 ? `${p.soldCount} of ${ended} ended` : undefined}
        >
          {p.sellThrough == null ? "—" : `${Math.round(p.sellThrough * 100)}%`}
        </Figure>
        <Figure
          label="Time to sale"
          href={p.avgDaysToSale == null ? null : href.offers("sold")}
          hint={p.timedCount < p.soldCount ? `over ${p.timedCount} of ${p.soldCount} sold` : undefined}
        >
          {p.avgDaysToSale == null ? "—" : `${p.avgDaysToSale} days`}
        </Figure>
        <Figure label="Purchases through it" href={href.purchases}>
          {p.purchaseCount}
        </Figure>
        <Figure label="Spent through it" href={href.purchases} hint={moneyHint(p.purchaseSpent, "purchase")}>
          <Money total={p.purchaseSpent} noun="purchase" />
        </Figure>
      </FieldGrid>
      {p.settings && (
        <div style={{ marginTop: "1rem" }}>
          <Link href={href.settings(p.settings)} style={{ ...LINK, fontSize: "0.875rem" }}>
            {PLATFORM_SETTINGS_LABEL[p.settings]} →
          </Link>
        </div>
      )}
    </DetailCard>
  );
}

/** Lines with no own figure are said beside a trade value rather than counted as zero, as the trade
 * screen says them. */
function tradeValueHint(value: ContactTradeValue): string | undefined {
  if (value.missingLines === 0) return undefined;
  return `${value.missingLines} line${value.missingLines === 1 ? "" : "s"} without a value left out`;
}

/** The contact as exchange partner (#1710), valued in the collector's own valuation (#638). */
function TradesCard({
  trades: t,
  baseCurrency,
  collectionSlug,
  href,
}: {
  trades: ContactTrades;
  baseCurrency: string;
  collectionSlug: string;
  href: (statuses?: readonly string[]) => string;
}) {
  return (
    <DetailCard title="Trades · as exchange partner">
      <FieldGrid min="10rem">
        <Figure label="Trades" href={href()}>
          {t.count}
        </Figure>
        <Figure label="Open" href={href(OPEN_TRADE_STATUSES)}>
          {t.openCount}
        </Figure>
        <Figure label="Value given" href={href()} hint={tradeValueHint(t.given)}>
          {t.given.total} {baseCurrency}
        </Figure>
        <Figure label="Value received" href={href()} hint={tradeValueHint(t.received)}>
          {t.received.total} {baseCurrency}
        </Figure>
      </FieldGrid>

      {t.rows.length === 0 ? (
        <div style={{ marginTop: "1rem" }}>
          <EmptyNote>No trades in this period.</EmptyNote>
        </div>
      ) : (
        <RowList>
          {t.rows.map((r, i) => {
            const chip = isTradeStatus(r.status) ? tradeStatusChip(r.status) : { style: CHIP, label: r.status };
            return (
              <RowLinkItem key={r.id} first={i === 0} href={`/c/${collectionSlug}/trades/${r.id}`}>
                <EntityNoChip entity="trade" no={r.tradeNo} prefix="t" />
                <span style={META}>{r.createdAt}</span>
                <span style={chip.style}>{chip.label}</span>
                <span style={{ flex: 1 }} />
                <span style={MUTED}>
                  {r.givePieces} given · {r.receivePieces} received
                </span>
                {r.ownGiven != null && r.ownReceived != null && (
                  <Tooltip
                    content={
                      r.ownMissing > 0
                        ? `My valuation of what goes each way; ${r.ownMissing} line${r.ownMissing === 1 ? " has" : "s have"} no value and ${r.ownMissing === 1 ? "is" : "are"} left out.`
                        : "My valuation of what goes each way."
                    }
                  >
                    <span style={AMOUNT}>
                      {r.ownGiven.toFixed(2)} → {r.ownReceived.toFixed(2)} {baseCurrency}
                      {r.ownMissing > 0 ? " *" : ""}
                    </span>
                  </Tooltip>
                )}
              </RowLinkItem>
            );
          })}
        </RowList>
      )}
    </DetailCard>
  );
}

const AMOUNT: CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

function RowList({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: "1rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        overflow: "clip",
      }}
    >
      {children}
    </div>
  );
}

/** One transaction as a row that opens it. */
function RowLinkItem({ href, first, children }: { href: string; first: boolean; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.875rem",
        borderTop: first ? undefined : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      {children}
    </Link>
  );
}
