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
import { TradePackingSheet } from "./trade-packing-sheet";
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
  return { title: `Packing list — trade #${trade.tradeNo} — ${trade.partnerName}` };
}

/**
 * Printable **packing checklist** for a trade's give side (#643): the copies you owe your partner, as
 * a paper walk through your shelves.
 *
 * Grouped by storage **location**, with the trade's own section as a *column* — packing is a walk
 * along the shelves and the shelf order is what governs it; grouped by section, the same cabinet gets
 * visited three times.
 *
 * Unlike the sale's list (#330) this sheet **writes**: ticking a line records `fulfilled` and the
 * row's menu strikes one off (#642), because the collector pulling forty stamps is the person who
 * finds the toned one. That is the only interactive part; everything else is a plain server render,
 * and the app chrome (`.no-print`) drops out on paper.
 */
export default async function TradePackingListPage({ params }: PageProps) {
  const { collectionSlug, tradeId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const trade = await getTrade(session.user.id, tradeId);
  if (!trade || trade.collectionId !== collection.id) notFound();

  const [areas, issuePrefixes, locations, read] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    loadIssuePrefixMap(collection.id),
    getLocations(session.user.id, collection.id),
    // No figures at all: this is the sheet you carry to the cabinet, and what a piece is worth is not
    // something you read off a shelf. The figures belong on the enclosure, which is the paper the
    // partner reads.
    readTradePackingList(session.user.id, tradeId, { withValues: false, voice: "own" }),
  ]);
  if (!read) notFound();

  const list = buildPackingList(
    read.copies,
    areas,
    locations,
    buildAreaVendorMaps(areas, issuePrefixes)
  );

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
          href={`/c/${collectionSlug}/trades/${tradeId}/enclosure`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          <Icon name="parcel" size="sm" /> Parcel enclosure
        </Link>
        {/* Browsers won't render CSS page numbers, but their own print header/footer does — so
            point at it rather than pretend the sheet can number its pages itself. */}
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          For page numbers, enable “Headers and footers” in the print dialog.
        </span>
        <PrintButton />
      </div>

      {/* Sheet header — whose parcel this is and what it owes */}
      <header style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          {/* The trade's own number (#646) rides in the title, as the sale's does (#474): it is this
              collection's name for the exchange, so it identifies the sheet before anything else. */}
          <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
            Packing list — trade #{trade.tradeNo}
          </h1>
          <span style={{ fontSize: "1rem", color: "var(--color-text-secondary)" }}>
            {trade.partnerName}
          </span>
        </div>
        <div style={SHEET_META_ROW}>
          <SheetMeta label="Partner" value={trade.partnerName} />
          <SheetMeta label="Status" value={TRADE_STATUS_LABEL[trade.status]} />
          {/* Shipping is two timestamps, not two states (ADR-0039 §4) — printed only where one is
              set, since an empty "Sent: —" tells the packer nothing they can act on. */}
          {trade.sentAt && <SheetMeta label="Sent" value={formatSheetDate(trade.sentAt)} />}
          {trade.receivedAt && <SheetMeta label="Received" value={formatSheetDate(trade.receivedAt)} />}
          <SheetMeta
            label="To pack"
            value={`${list.totalCopies} ${list.totalCopies === 1 ? "copy" : "copies"}`}
          />
          <SheetMeta label="Packed" value={`${list.packedCopies} of ${list.totalCopies}`} />
        </div>
        {/* Why the boxes are inert, said once and above them rather than on forty rows. */}
        {read.closedMessage && (
          <p
            className="no-print"
            style={{ margin: "0.625rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}
          >
            {read.closedMessage} The sheet still prints; the boxes just aren’t writable from here.
          </p>
        )}
        {read.unresolved > 0 && (
          <p style={{ margin: "0.625rem 0 0", fontSize: "0.8125rem", color: "var(--color-warning)" }}>
            {read.unresolved} {read.unresolved === 1 ? "line" : "lines"} on this trade{" "}
            {read.unresolved === 1 ? "names a copy" : "name copies"} that can no longer be read, so{" "}
            {read.unresolved === 1 ? "it is" : "they are"} not on the sheet.
          </p>
        )}
      </header>

      <TradePackingSheet
        collectionId={collection.id}
        itemNoPad={collection.itemNoPad}
        list={list}
        recordable={read.recordable}
      />

      {/* The legend closes the document — it is read once, after the last row, so it stays in the
          flow rather than repeating at the foot of every page. */}
      <footer
        style={{
          marginTop: "1.5rem",
          paddingTop: "0.625rem",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
        }}
      >
        A ticked box (<Icon name="check" size="xs" />) is a line already recorded as gone in
        Stamporama; empty boxes are for ticking by hand as you pack. On screen, pressing a box records
        it, and a row’s <Icon name="rowActions" size="xs" /> menu strikes a line off with a reason.
      </footer>

      <SheetFooter
        collectionName={collection.name}
        version={getAppVersionLabel()}
        lead={`Trade #${trade.tradeNo} · ${trade.partnerName}`}
        detail={`${TRADE_STATUS_LABEL[trade.status]} · ${list.totalCopies} ${
          list.totalCopies === 1 ? "copy" : "copies"
        } to pack`}
      />
    </div>
  );
}
