import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { buildAreaVendorMaps } from "@/lib/area-vendor";
import { loadIssuePrefixMap } from "@/lib/issue-prefix";
import { buildPackingList } from "@/lib/packing-list";
import { getTrade } from "@/lib/trades";
import { readTradePackingList } from "@/lib/trade-packing";
import { TRADE_STATUS_LABEL } from "@/lib/trade-rules";
import { getAppVersionLabel } from "@/lib/version";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { Icon } from "@/app/icons";
import { TradeEnclosureSheet } from "./trade-enclosure-sheet";
import { SheetFooter, SheetMeta, SHEET_META_ROW, formatSheetDate } from "../sheet-parts";

interface PageProps {
  params: Promise<{ collectionSlug: string; tradeId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tradeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const trade = await getTrade(session.user.id, tradeId);
  if (!trade) return {};
  return { title: `Parcel enclosure — trade #${trade.tradeNo} — ${trade.partnerName}` };
}

/**
 * The **parcel enclosure** (#643): the list of contents that goes in the envelope.
 *
 * **This is the trade's only printout for the partner.** The shared page (#640) is a screen they read
 * and answer on and prints nothing (#665), so paper lives here — which is why this sheet says
 * everything the reader needs to know what they are holding and nothing about where it was filed.
 *
 * **The figures follow the partner link's own `showValues`.** It is the collector's decision about
 * what this partner is shown, taken once in the Share dialog, and a printout quietly overriding it
 * would make that choice mean nothing. A trade with no link has never had the decision made, so this
 * sheet prints no figures and says where the choice lives.
 */
export default async function TradeEnclosurePage({ params }: PageProps) {
  const { collectionSlug, tradeId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const trade = await getTrade(session.user.id, tradeId);
  if (!trade || trade.collectionId !== collection.id) notFound();

  const showValues = trade.share?.showValues ?? false;

  const [areas, issuePrefixes, locations, read] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    loadIssuePrefixMap(collection.id),
    getLocations(session.user.id, collection.id),
    readTradePackingList(session.user.id, tradeId, { withValues: showValues, voice: "partner" }),
  ]);
  if (!read) notFound();

  const list = buildPackingList(
    read.copies,
    areas,
    locations,
    buildAreaVendorMaps(areas, issuePrefixes),
    // Divided by the trade's own sections, in the trade's own order, and read by catalogue number
    // inside them — see `trade-enclosure-sheet.tsx`.
    { grouping: "group", rowOrder: "catalog", ungroupedLabel: "Other" }
  );

  const valuation = read.valuation;

  return (
    <div className="print-sheet" style={{ padding: "2rem", maxWidth: "56rem" }}>
      {/* Screen-only controls */}
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}
      >
        <Link
          href={`/c/${collectionSlug}/trades/${tradeId}`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          ← Back to the trade
        </Link>
        <Link
          href={`/c/${collectionSlug}/trades/${tradeId}/packing-list`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          <Icon name="print" size="sm" /> Packing list
        </Link>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          For page numbers, enable “Headers and footers” in the print dialog.
        </span>
        <PrintButton />
      </div>

      {/* Sheet header — what the parcel is, addressed to the person opening it */}
      <header style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
            Parcel contents
          </h1>
          <span style={{ fontSize: "1rem", color: "var(--color-text-secondary)" }}>
            {/* The exchange's own number and both names: the sheet is read by somebody who has more
                than one exchange running, and *from whom, about which trade* is the first thing they
                need off it. */}
            trade #{trade.tradeNo} · {collection.name} → {trade.partnerName}
          </span>
        </div>
        <div style={SHEET_META_ROW}>
          <SheetMeta label="From" value={collection.name} />
          <SheetMeta label="To" value={trade.partnerName} />
          <SheetMeta label="Status" value={TRADE_STATUS_LABEL[trade.status]} />
          {trade.sentAt && <SheetMeta label="Sent" value={formatSheetDate(trade.sentAt)} />}
          <SheetMeta
            label="Enclosed"
            value={`${list.totalCopies} ${list.totalCopies === 1 ? "stamp" : "stamps"} in ${
              list.groups.length
            } ${list.groups.length === 1 ? "section" : "sections"}`}
          />
          {valuation && (
            <SheetMeta
              label="Valued in"
              value={
                valuation.catalogName
                  ? `${valuation.catalogName}, ${valuation.currency}`
                  : valuation.currency
              }
            />
          )}
        </div>
        {/* The book is stated **once**, here, rather than on every line — a column of figures out of
            one catalogue needs saying so once, and the odd line read somewhere else says so itself. */}
        {valuation && (
          <p style={{ margin: "0.625rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {valuation.kind === "agreed"
              ? `Figures are the catalogue values we agreed on${
                  valuation.catalogName ? ` (${valuation.catalogName})` : ""
                }, in ${valuation.currency}.`
              : `We agreed no catalogue, so the figures are my own valuation, in ${valuation.currency}.`}
            {valuation.frozen
              ? " They are the figures we shook hands on, not today’s."
              : " They are today’s figures and may still move."}
          </p>
        )}
        {!showValues && (
          <p
            className="no-print"
            style={{ margin: "0.625rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}
          >
            No figures on this sheet:{" "}
            {trade.share
              ? "your partner link is set to hide them."
              : "this trade has no partner link, so you have never chosen to show your partner any."}{" "}
            The choice lives in the trade’s <strong>Share with partner</strong> dialog, and this sheet
            follows it.
          </p>
        )}
        {read.unresolved > 0 && (
          <p style={{ margin: "0.625rem 0 0", fontSize: "0.8125rem", color: "var(--color-warning)" }}>
            {read.unresolved} {read.unresolved === 1 ? "line" : "lines"} could not be read and{" "}
            {read.unresolved === 1 ? "is" : "are"} not on this sheet.
          </p>
        )}
      </header>

      <TradeEnclosureSheet
        collectionId={collection.id}
        itemNoPad={collection.itemNoPad}
        list={list}
      />

      {/* The whole parcel, once, after the last section. The figures are the **agreed** ones and stay
          so even where a line was struck off (#642): the agreement is what it is, and the marks are
          what is recorded against it. */}
      <div
        style={{
          marginTop: "1.25rem",
          paddingTop: "0.625rem",
          borderTop: "2px solid var(--color-border-strong)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
          fontSize: "0.9375rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        <span>
          Total — {list.totalCopies} {list.totalCopies === 1 ? "stamp" : "stamps"}
        </span>
        {valuation && (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {list.totalValue.toFixed(2)} {valuation.currency}
            {/* Missing figures are **counted, never summed as zero** (#640): adding nothing for a
                line nobody priced would print a total the reader cannot reproduce. */}
            {list.valueMissing > 0 && (
              <span style={{ fontWeight: 500, color: "var(--color-text-muted)" }}>
                {" "}
                + {list.valueMissing} without a figure
              </span>
            )}
          </span>
        )}
      </div>

      <footer
        style={{
          marginTop: "1.5rem",
          paddingTop: "0.625rem",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
        }}
      >
        The boxes are for you: tick each stamp off as you unpack. A marked line is one that did not
        go — the mark says which.
      </footer>

      <SheetFooter
        collectionName={collection.name}
        version={getAppVersionLabel()}
        lead={`Trade #${trade.tradeNo} · ${collection.name} → ${trade.partnerName}`}
        detail={`${list.totalCopies} ${list.totalCopies === 1 ? "stamp" : "stamps"} enclosed`}
      />
    </div>
  );
}
