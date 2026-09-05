import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getAlbumCuttingList } from "@/lib/album-cutting";
import { hawidStripLabel } from "@/lib/hawid";
import { formatSizeMm } from "@/lib/stamp-size";
import { getAppVersionLabel } from "@/lib/version";
import type {
  AlbumCutDemand,
  AlbumCutSheet,
  AlbumUncutBox,
} from "@/lib/album-cutting-list";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { GeneratedAt } from "@/app/c/[collectionSlug]/shared/generated-at";

// The hawid cutting list (#770) — the sheet that is read at the desk, with scissors.
//
// **Printed through the browser**, `@media print` in `globals.css`, exactly as the packing list
// (#643) and the sorting slips (#565) are. The exact-millimetre argument that drove the album's own
// pages to a server-composed PDF (#768, ADR-0046) does not apply here and it is worth saying why,
// because the two sit next to each other on the same screen: an album page is a card whose boxes are
// about to be cut to, so *Fit to page* silently shrinking it by three percent produces a wrong card.
// This is a list. Nobody measures it, and a figure printed at 97% still reads 38 mm.
//
// Everything is server-rendered — **no filters, no toggles, no lazy loading** — because the artefact
// is the printout. App chrome carries `.no-print`. That rule is why the two demand figures below are
// both always on the page rather than one of them sitting behind a control: paper cannot say which
// state a toggle was in when it was printed, so a sheet showing one figure would be a sheet nobody
// could read a week later.
//
// It has its own route rather than a section of the album screen, and not because that screen prints
// badly. This is a **working document read at a different moment and in a different place** — at the
// desk, with scissors, away from the surface where entries get dragged around — which is the same
// reason a packing list hangs off a sale rather than living on it.
//
// The demand comes first and the per-sheet lists after it. It is short, it is what gets read before
// a trip to the shop, and the sheets are the bulk of the document.
//
// The demand is **two figures, never summed, printed cards first.** A sheet is marked printed as it
// comes off the printer and cut for afterwards — the collector's own workflow, asked and answered —
// so a card being on paper says nothing about whether its hawid has been cut, and the album records
// printing rather than mounting. One total would count material mounted a year ago; a total over the
// live sheets alone would leave out the run he is about to sit down with. So both are stated, each
// printed card carries the minute it went onto paper, and no rule here decides which cards are
// already mounted — that would be the app inventing a fact the model does not hold.

interface CuttingListPageProps {
  params: Promise<{ collectionSlug: string; albumId: string }>;
}

export async function generateMetadata({ params }: CuttingListPageProps): Promise<Metadata> {
  const { albumId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const result = await getAlbumCuttingList(session.user.id, albumId);
  if (!result) return {};
  return { title: `Cutting list — ${result.album.name}` };
}

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const TH: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 600,
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--color-text-muted)",
  padding: "0.25rem 0.5rem 0.25rem 0",
  borderBottom: "1px solid var(--color-border)",
};

const TD: React.CSSProperties = {
  padding: "0.25rem 0.5rem 0.25rem 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  verticalAlign: "baseline",
};

const mm = (value: number) => `${formatSizeMm(value)} mm`;

export default async function AlbumCuttingListPage({ params }: CuttingListPageProps) {
  const { collectionSlug, albumId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const result = await getAlbumCuttingList(session.user.id, albumId);
  if (!result || result.album.collectionId !== collection.id) notFound();

  const { album, list, emptyStock, unreadable } = result;
  const { toCut, onPaper } = list;

  return (
    <div className="print-sheet" style={{ padding: "2rem", maxWidth: "56rem" }}>
      {/* Screen-only controls */}
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}
      >
        <Link
          href={`/c/${collectionSlug}/albums/${albumId}`}
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
            textDecoration: "none",
          }}
        >
          ← Back to the album
        </Link>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          For page numbers, enable “Headers and footers” in the print dialog.
        </span>
        <PrintButton />
      </div>

      <header
        style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.375rem",
              fontWeight: 700,
              color: "var(--color-text-primary)",
            }}
          >
            Hawid cutting list
          </h1>
          <span style={{ fontSize: "1rem", color: "var(--color-text-secondary)" }}>{album.name}</span>
        </div>
        <p style={{ ...MUTED, margin: "0.5rem 0 0", lineHeight: 1.6, maxWidth: "42rem" }}>
          Every box on every sheet, as the piece of hawid it is cut from. A box takes the height of
          the shortest strip in stock it fits, and the width is the cut — the same two figures the
          card itself is drawn to, computed once.
        </p>
      </header>

      {emptyStock && (
        <p
          style={{
            ...MUTED,
            margin: "1rem 0 0",
            padding: "0.75rem 1rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            lineHeight: 1.6,
          }}
        >
          This collection has no hawid stock described, so there is nothing to cut from and every box
          below is a pocket. Add the strips you own in Settings → Albums.
        </p>
      )}

      {unreadable.length > 0 && (
        <p
          style={{
            ...MUTED,
            margin: "1rem 0 0",
            padding: "0.75rem 1rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            lineHeight: 1.6,
          }}
        >
          {unreadable.length === 1 ? "One card in the binder" : `${unreadable.length} cards in the binder`}{" "}
          ({unreadable.join(", ")}) {unreadable.length === 1 ? "keeps" : "keep"} contents this version
          cannot read, so {unreadable.length === 1 ? "its cuts are" : "their cuts are"} missing from
          this list. Nothing has been guessed from current data: what is on a card is what was stored
          when it was printed.
        </p>
      )}

      {/* ── The stock demand ──

          Two figures, never summed, the printed one first. A sheet is marked printed as it comes off
          the printer and cut for afterwards, so being on paper says nothing about whether the hawid
          has been cut — and the album records printing, not mounting. One total would therefore be
          wrong for every album older than a single printing session: it would count material mounted
          a year ago. Two, with the moment each card was printed shown beside it, lets the collector
          read the figure that is his. */}

      <h2
        className="print-section-heading"
        style={{ margin: "1.75rem 0 0.5rem", fontSize: "1rem", fontWeight: 600 }}
      >
        Stock to cut
      </h2>
      <p style={{ ...MUTED, margin: "0 0 1rem", lineHeight: 1.6, maxWidth: "42rem" }}>
        By strip height, in two parts and never added together. The strip count is what the{" "}
        <em>pieces</em> need, not the total width divided by the stock length — a piece cannot span
        two strips, so four 120 mm pieces are four 210 mm strips and not three.
      </p>

      {onPaper.sheetCount > 0 && (
        <>
          <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.875rem", fontWeight: 600 }}>
            Cards already printed
          </h3>
          <p style={{ ...MUTED, margin: "0 0 0.5rem", lineHeight: 1.6, maxWidth: "42rem" }}>
            What the{" "}
            {onPaper.sheetCount === 1 ? "one printed card" : `${onPaper.sheetCount} printed cards`}{" "}
            {onPaper.sheetCount === 1 ? "was" : "were"} drawn to, from what was stored when{" "}
            {onPaper.sheetCount === 1 ? "it" : "they"} went onto paper rather than from the drawer as
            it stands now. The album records <strong>printing, not mounting</strong>, so this covers
            every card ever printed — the run you have just printed and not yet cut for is in here,
            and so is everything already glued in. Each sheet below says when it was printed.
          </p>
          <Demand demand={onPaper} empty="Nothing on the printed cards takes a hawid." />
        </>
      )}

      <h3
        style={{
          margin: onPaper.sheetCount > 0 ? "1.25rem 0 0.25rem" : "0 0 0.25rem",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}
      >
        Sheets still on screen
      </h3>
      <p style={{ ...MUTED, margin: "0 0 0.5rem", lineHeight: 1.6, maxWidth: "42rem" }}>
        Not printed yet, so this is what the album will need on top of whatever is above.
      </p>
      <Demand demand={toCut} empty={nothingToCut(list.sheets.length, toCut)} />

      {/* ── The sheets ── */}

      <h2
        className="print-section-heading"
        style={{ margin: "2rem 0 0.5rem", fontSize: "1rem", fontWeight: 600 }}
      >
        Sheet by sheet
      </h2>
      <p style={{ ...MUTED, margin: "0 0 1rem", lineHeight: 1.6, maxWidth: "42rem" }}>
        In the album&apos;s own order, and within a sheet in the order the pieces get stuck down.
        Identical cuts are one line with a count, because that is how they are cut.
      </p>

      {list.sheets.length === 0 && (
        <p style={MUTED}>No sheets: there is nothing to lay out yet.</p>
      )}

      {list.sheets.map((sheet, i) => (
        <Sheet key={i} sheet={sheet} />
      ))}

      <footer
        style={{
          marginTop: "1.5rem",
          paddingTop: "0.625rem",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
          lineHeight: 1.6,
        }}
      >
        A box is a <strong>slot</strong>, not a stamp: one stamp on two checklists of the same issue
        — basic and specialized, perforated and imperforate — is two boxes on the card, two hawids
        and two cuts, and it is counted twice here on purpose.
      </footer>

      <div
        className="print-footer"
        style={{
          marginTop: "0.5rem",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <span>
          <strong style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>
            Cutting list · {album.name}
          </strong>{" "}
          · {list.sheets.length} {list.sheets.length === 1 ? "sheet" : "sheets"} ·{" "}
          {toCut.byStrip.reduce((sum, d) => sum + d.strips, 0)} strips for{" "}
          {toCut.boxCount - toCut.uncutCount}{" "}
          {toCut.boxCount - toCut.uncutCount === 1 ? "hawid" : "hawids"}
          {toCut.uncutCount > 0 ? `, ${toCut.uncutCount} in pockets or unsized` : ""}
        </span>
        <span>
          Stamporama {getAppVersionLabel()} · {collection.name} · generated{" "}
          <GeneratedAt iso={new Date().toISOString()} />
        </span>
      </div>
    </div>
  );
}

/** Why there is nothing to cut, which is three different things and only one of them is "done".
 *  A shopping list that says *nothing to buy* over a page of pockets would be read as *nothing to
 *  do*, and the collector would find the album unmountable at the desk. */
function nothingToCut(sheetCount: number, toCut: AlbumCutDemand): string {
  if (sheetCount === 0) return "No sheets: there is nothing to lay out yet.";
  if (toCut.sheetCount === 0) {
    return "Every sheet of this album is on paper, so there is nothing left to cut.";
  }
  return "Nothing on the unprinted sheets takes a hawid.";
}

/** The demand table for one set of sheets. */
function Demand({ demand, empty }: { demand: AlbumCutDemand; empty: string }) {
  if (demand.byStrip.length === 0) {
    return (
      <p style={{ ...MUTED, lineHeight: 1.6 }}>
        {empty}
        {demand.uncutCount > 0 && (
          <>
            {" "}
            {demand.uncutCount === 1
              ? "One box takes no hawid at all"
              : `${demand.uncutCount} boxes take no hawid at all`}{" "}
            — see the sheets below.
          </>
        )}
      </p>
    );
  }
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "0.5rem" }}>
        <thead>
          <tr>
            <th style={TH}>Strip</th>
            <th style={TH}>Pieces</th>
            <th style={TH}>Total width</th>
            <th style={TH}>Stock length</th>
            <th style={TH}>Strips needed</th>
          </tr>
        </thead>
        <tbody>
          {demand.byStrip.map((row, i) => (
            <tr key={i}>
              <td style={{ ...TD, fontWeight: 600 }}>
                {hawidStripLabel(row.strip)}
                {/* Never remapped to the nearest strip in stock — that would be the list inventing a
                    cut nobody made. The card says what it was cut from; this says the drawer no
                    longer holds it, so a line that cannot be acted on says so. */}
                {!row.inStock && (
                  <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
                    {" "}
                    — not in your stock any more
                  </span>
                )}
              </td>
              <td style={TD}>{row.pieces}</td>
              <td style={TD}>{mm(row.totalWidthMm)}</td>
              <td style={TD}>{mm(row.strip.stockLengthMm)}</td>
              <td style={{ ...TD, fontWeight: 600 }}>{row.strips}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={MUTED}>
        {demand.sheetCount === 1 ? "1 sheet" : `${demand.sheetCount} sheets`} ·{" "}
        {demand.boxCount === 1 ? "1 box" : `${demand.boxCount} boxes`}
        {demand.uncutCount > 0 && (
          <>
            , of which {demand.uncutCount} {demand.uncutCount === 1 ? "takes" : "take"} no hawid
          </>
        )}
      </p>
    </>
  );
}

/**
 * One sheet's cutting list.
 *
 * No `break-inside: avoid` on the section: a card with forty boxes is taller than a page, and a
 * browser answers that by pushing it to a fresh page and then breaking it anyway. The heading
 * carries `.print-section-heading` instead so it is never stranded at the foot of a page, and the
 * `tr` and `thead` rules in `globals.css` do the rest — the shared packing sheet's pattern.
 */
function Sheet({ sheet }: { sheet: AlbumCutSheet }) {
  return (
    <section style={{ marginBottom: "1.25rem" }}>
      <div
        className="print-section-heading"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.5rem",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: "0.25rem",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.9375rem",
            fontWeight: 700,
            color: "var(--color-text-primary)",
          }}
        >
          {sheet.range || "(no catalog numbers on this sheet)"}
        </h3>
        {sheet.chapterKey && <span style={CHIP}>{sheet.chapterKey}</span>}
        {/* The moment it went onto the printer, to the minute, so one run is told from another. It
            is the only thing the album can say about whether this card's hawid has been cut: it
            records printing and not mounting, and a rule deciding which cards are mounted would be
            the app inventing a fact it does not hold. */}
        {sheet.printedPageId && (
          <span style={CHIP}>
            {sheet.printedAt ? (
              <>
                Printed <GeneratedAt iso={sheet.printedAt} />
              </>
            ) : (
              "On paper"
            )}
          </span>
        )}
        <span style={{ ...MUTED, marginLeft: "auto" }}>
          {sheet.boxCount === 1 ? "1 box" : `${sheet.boxCount} boxes`}
        </span>
      </div>

      {sheet.headings.length > 0 && (
        <div style={{ ...MUTED, margin: "0.25rem 0 0.375rem", lineHeight: 1.5 }}>
          {sheet.headings.join(" · ")}
        </div>
      )}

      {sheet.cuts.length === 0 && sheet.uncut.length === 0 && (
        <p style={{ ...MUTED, margin: "0.375rem 0 0" }}>
          {sheet.printedPageId
            ? "Nothing to cut recorded for this card."
            : "Nothing to cut on this sheet."}
        </p>
      )}

      {sheet.cuts.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.25rem" }}>
          <thead>
            <tr>
              <th style={TH}>Cut from</th>
              <th style={TH}>To</th>
              <th style={TH}>Pieces</th>
              <th style={TH}>Note</th>
            </tr>
          </thead>
          <tbody>
            {sheet.cuts.map((cut, i) => (
              <tr key={i}>
                <td style={TD}>{hawidStripLabel(cut.strip)}</td>
                <td style={{ ...TD, fontWeight: 600 }}>{mm(cut.widthMm)}</td>
                <td style={{ ...TD, fontWeight: 600 }}>{cut.count}</td>
                <td style={{ ...TD, color: "var(--color-text-muted)" }}>
                  {cut.inheritedCount > 0
                    ? `${cut.inheritedCount === cut.count ? "" : `${cut.inheritedCount} of these `}sized from a neighbour, not measured`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sheet.uncut.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              marginBottom: "0.125rem",
            }}
          >
            No hawid
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {sheet.uncut.map((box, i) => (
                <tr key={i}>
                  <td style={{ ...TD, width: "40%" }}>{box.label || "(no label)"}</td>
                  <td style={TD}>{uncutText(box)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Why a box takes no hawid, in the words the collector reads it in. The two reasons are not the
 *  same kind of thing: one is an answer, the other is a gap. */
function uncutText(box: AlbumUncutBox): string {
  if (box.reason === "unmeasured") {
    return "nothing on this checklist states a size — nothing to cut to";
  }
  return `${mm(box.widthMm)} × ${mm(box.heightMm)} — a pocket, no strip is tall enough`;
}
