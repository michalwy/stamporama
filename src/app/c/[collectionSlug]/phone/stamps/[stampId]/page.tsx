import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getPhoneStamp, PHONE_STAMP_COPY_LIMIT } from "@/lib/phone-stamp";
import {
  phoneCopiesSummary,
  phoneCopyLine,
  phoneMarketEvidence,
  phoneValueLabel,
  sortByValueAxes,
} from "@/lib/phone-stamp-view";
import { wantAxisTexts } from "@/lib/want-axes";
import { WANT_PRIORITY_LABEL } from "@/lib/want-rules";
import { CATALOG_PRICE_MARK_LABEL } from "@/lib/catalog-price-mark";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import { PhoneScreen, PHONE_TAP_TARGET, phoneRow } from "@/app/phone-screen";
import { Icon } from "@/app/icons";
import { PhoneStampPicture } from "./phone-stamp-picture";

export const metadata: Metadata = { title: "Stamp" };

interface PhoneStampPageProps {
  params: Promise<{ collectionSlug: string; stampId: string }>;
}

const SECTION_TITLE: CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 700,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const CARD: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  overflow: "clip",
};

const CARD_ROW: CSSProperties = {
  padding: "0.625rem 0.875rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};

const PLAIN: CSSProperties = { margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)" };
const MUTED: CSSProperties = { margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" };

const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.125rem 0.5rem",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <h2 style={SECTION_TITLE}>{title}</h2>
      {children}
    </section>
  );
}

/** Rows in one bordered box, a rule between each — the phone's form of a desk card's list. */
function Rows({ rows }: { rows: ReactNode[] }) {
  return (
    <div style={CARD}>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{ ...CARD_ROW, borderTop: i === 0 ? undefined : "1px solid var(--color-border)" }}
        >
          {row}
        </div>
      ))}
    </div>
  );
}

/** A label and an amount on one line, the amount at the end where a column of them can be read. */
function ValueLine({ label, amount, note }: { label: string; amount: string; note?: string }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
        <span style={{ ...PLAIN, flex: 1, minWidth: 0 }}>{label}</span>
        <span style={{ ...PLAIN, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{amount}</span>
      </div>
      {note && <span style={{ ...MUTED, fontSize: "0.8125rem" }}>{note}</span>}
    </>
  );
}

/**
 * One stamp on the phone (#2003, ADR-0072): at a fair, with the stamp in hand — do I have it, how
 * many and in what state, is it on my wants, what is it worth. One column read top to bottom, not
 * the desk page's cards: the picture, the copies, the wants, the value.
 *
 * **Read only**: nothing here writes. Every figure is the desk's own, read through the same reads its
 * stamp page, Copies card, Wants card, Catalog prices card and Valuation dialog use
 * (`getPhoneStamp`), and every section that has nothing says so rather than leaving a gap.
 */
export default async function PhoneStampPage({ params }: PhoneStampPageProps) {
  const { collectionSlug, stampId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const data = await getPhoneStamp(session.user.id, collection.id, stampId);
  if (!data) notFound();
  const { stamp } = data;

  const title = stamp.name ?? data.catalogNumbers[0] ?? "Untitled stamp";
  const issue = stamp.issues[0];
  // What identifies it beside the title: every catalogue number, the issue it is filed in, its
  // subtype — what the desk's identity band says, a line each.
  const numbers = data.catalogNumbers.join(" · ");
  const issueLine = issue ? [issue.issueYear, issue.issueName].filter(Boolean).join(", ") : "";

  const pictures = stamp.photos.length > 0 ? stamp.photos : data.copyPhotos.photos;

  const openWants = data.wants.filter((w) => w.closedAt === null);
  const price = stamp.mainCatalogPrice;
  const market = sortByValueAxes(data.market.values);
  const catalogue = sortByValueAxes(data.catalogueCells);

  return (
    <PhoneScreen title={title} fullAppHref={`/c/${collectionSlug}/stamps/${stamp.id}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        <p style={{ ...PLAIN, fontWeight: 600 }}>{numbers || "No catalogue number"}</p>
        {issueLine && <p style={MUTED}>{issueLine}</p>}
        {stamp.subtype && <p style={MUTED}>{stamp.subtype.name}</p>}
      </div>

      {/* The picture: the stamp's own, else its copies' (#1290) — said which, since a copy's photo
          is of one piece rather than the catalogue's specimen. */}
      {pictures.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <PhoneStampPicture collectionId={collection.id} photos={pictures} />
          {stamp.photos.length === 0 && (
            <p style={MUTED}>Photos of your copies — the stamp has none of its own.</p>
          )}
        </div>
      ) : (
        <p style={MUTED}>No picture.</p>
      )}

      <Section title="Copies">
        {phoneCopiesSummary(stamp.copies, stamp.variantCopies.total, stamp.possibleCopies).map(
          (line, i) => (
            <p key={line} style={i === 0 ? { ...PLAIN, fontWeight: 600 } : MUTED}>
              {line}
            </p>
          )
        )}
        {data.copies.length > 0 && (
          <Rows
            rows={data.copies.map((copy) => {
              const line = phoneCopyLine(copy, data.locations);
              return (
                <>
                  <span style={{ ...PLAIN, fontWeight: 600 }}>{line.grade}</span>
                  <span style={MUTED}>{line.location}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                    {line.dispositions.map((d) => (
                      <span key={d} style={CHIP}>
                        {d}
                      </span>
                    ))}
                  </span>
                </>
              );
            })}
          />
        )}
        {data.moreCopies && (
          <p style={MUTED}>
            The first {PHONE_STAMP_COPY_LIMIT} copies — the rest are on the full app.
          </p>
        )}
      </Section>

      <Section title="Wants">
        {data.wants.length === 0 ? (
          <p style={PLAIN}>Not on your wants.</p>
        ) : (
          <>
            <p style={{ ...PLAIN, fontWeight: 600 }}>
              {openWants.length > 0 ? "Wanted" : "Not wanted any more — every want is closed"}
            </p>
            <Rows
              rows={data.wants.map((want) => {
                const axes = wantAxisTexts(want, data.dictionaries);
                const open = want.closedAt === null;
                return (
                  <>
                    <span style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", opacity: open ? 1 : 0.6 }}>
                      <span style={CHIP}>{axes.condition}</span>
                      <span style={CHIP}>{axes.certificate}</span>
                      <span style={CHIP}>{axes.format}</span>
                      <span style={CHIP}>{WANT_PRIORITY_LABEL[want.priority]} priority</span>
                      {!open && <span style={CHIP}>Closed</span>}
                    </span>
                    {want.notes && <span style={MUTED}>{want.notes}</span>}
                  </>
                );
              })}
            />
          </>
        )}
      </Section>

      <Section title="Market value">
        {market.length === 0 ? (
          <p style={MUTED}>No market value — no auction results are recorded for this stamp.</p>
        ) : (
          <Rows
            rows={market.map((value) => (
              <ValueLine
                key={`${value.conditionId}~${value.certificateStatusId}~${value.formatId}`}
                label={phoneValueLabel(value)}
                amount={`${value.median} ${value.baseCurrency}`}
                note={`Median of ${phoneMarketEvidence(value.n, value.confidence.badge)}`}
              />
            ))}
          />
        )}
      </Section>

      <Section title="Catalogue value">
        {price ? (
          <ValueLine
            label="Catalogue price"
            amount={moneyPrimaryText(price)}
            note={
              [
                moneySecondaryText(price),
                stamp.mainCatalogPriceStale ? "from an older edition of the catalogue" : null,
                stamp.mainCatalogPriceDerived ? "derived from the single's price by a format multiplier" : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          />
        ) : stamp.mainCatalogPriceMark ? (
          <ValueLine
            label="Catalogue price"
            amount={CATALOG_PRICE_MARK_LABEL[stamp.mainCatalogPriceMark]}
          />
        ) : null}
        {catalogue.length > 0 && (
          <>
            <p style={MUTED}>Cross-catalogue average, in {catalogue[0].baseCurrency}:</p>
            <Rows
              rows={catalogue.map((cell) => (
                <ValueLine
                  key={`${cell.conditionId}~${cell.certificateStatusId}`}
                  label={phoneValueLabel(cell)}
                  amount={`${cell.averageBase} ${cell.baseCurrency}`}
                />
              ))}
            />
          </>
        )}
        {!price && !stamp.mainCatalogPriceMark && catalogue.length === 0 && (
          <p style={MUTED}>No catalogue value — no catalogue prices are recorded for this stamp.</p>
        )}
      </Section>

      <Link
        href={`/c/${collectionSlug}/stamps/${stamp.id}`}
        style={{ ...phoneRow, minHeight: PHONE_TAP_TARGET, marginTop: "0.5rem" }}
      >
        <Icon name="desk" size="lg" />
        The stamp&rsquo;s full page
      </Link>
    </PhoneScreen>
  );
}
