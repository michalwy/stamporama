import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import {
  readTradeShareView,
  verifyTradeShareToken,
  type TradeShareSectionView,
  type TradeShareView,
} from "@/lib/trade-share";
import { readPartnerTradeFeedback } from "@/lib/trade-feedback";
import { readTradeShareChoices } from "@/lib/trade-proposals";
import {
  TRADE_SHARE_REFUSAL_MESSAGE,
  tradeShareSideHeading,
  type TradeShareRefusal,
} from "@/lib/trade-share-rules";
import {
  TRADE_GROUP_LABEL,
  TRADE_GROUP_LEVELS,
  readTradeGroupLevels,
  type TradeGroupLevel,
} from "@/lib/trade-grouping";
import { SHARE_STYLESHEET } from "./share-styles";
import { ShareSide, countText, money } from "./share-side";
import { PartnerFeedbackProvider, TradeNoteFeedback } from "./feedback-controls";

// **The partner's copy of the trade** (#640; ADR-0039 §9): a read-only page addressed by a secret
// link, for someone with no account and no session.
//
// It sits outside `/c/[collectionSlug]` because every part of that prefix is wrong here — the reader
// has no collection, and the slug would be a second name for something the token already resolves.
// It inherits no collection layout, so there is no sidebar, no quick jump and nothing to navigate
// into: the only thing on this page is the list, which is the whole point of handing it over.
//
// Everything it prints comes from `readTradeShareView`, which is scoped to the one trade the token
// names. This file resolves a token and lays out what comes back; it asks no questions of its own,
// so there is no query here that could be widened by accident.
//
// **Server-rendered whole**, and it stays that way now that printing has come off this page (#665).
// The reason was never paper: the partner has **no filters and no search**, so there is no view of
// this list but all of it, and a page that fetched as it scrolled would be a page whose end a reader
// can never be sure they reached — on a list they are being asked to agree to. Every row is in the
// HTML on arrival, and how the material is arranged is links rather than state: a different
// arrangement is a different address for the same page, which also means the partner can bookmark or
// forward the view they were reading.
//
// The page took **no client code at all** until it began taking answers back (#641), and what is
// client code is still only what an answer needs: the control on a row, the note box at the foot,
// the scans, which enlarge on hover and open full size (#666), and the copy picker on a give line
// with more than one candidate behind it (#658). The list itself is one server render.

export const metadata: Metadata = {
  title: "Exchange list",
  // A secret link is only secret while nothing publishes it. Crawlers reach pages through referrers
  // and toolbars as well as through links, so the refusal is stated rather than assumed.
  robots: { index: false, follow: false, nocache: true },
};

/** Requests per address per minute. Generous for a partner reading and reloading a list, and far
 *  below what walking the token space would need — this is the one page in the app reachable without
 *  a session, so the address is the only thing there is to limit. */
const SHARE_PAGE_LIMIT = 60;
const SHARE_WINDOW_MS = 60_000;

interface SharePageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TradeSharePage({ params, searchParams }: SharePageProps) {
  const { token } = await params;
  const query = await searchParams;

  const limited = rateLimit(
    `trade-share:${clientAddress(await headers())}`,
    SHARE_PAGE_LIMIT,
    SHARE_WINDOW_MS
  );
  if (!limited.ok) {
    return (
      <Refusal message="Too many requests. Please wait a moment and reload the page." />
    );
  }

  const verified = await verifyTradeShareToken(token);
  if (!verified.ok) return <Refusal message={refusalMessage(verified.reason)} />;

  const raw = query.g;
  const levels = readTradeGroupLevels(
    (Array.isArray(raw) ? raw.join(",") : (raw ?? "")).split(",")
  );

  const [view, feedback, choices] = await Promise.all([
    readTradeShareView(verified.access, levels),
    readPartnerTradeFeedback(verified.access),
    // **Which of the collector's copies would you like?** (#658). Read beside the list rather than
    // folded into it: a choice is about the *copies behind* a line rather than about the line, and
    // the payload the list is reduced to deliberately carries nothing about a copy at all.
    readTradeShareChoices(verified.access),
  ]);
  // The token verified against a trade that has gone since. Told the same way a withdrawn link is:
  // the partner has no way to tell the two apart and nothing they could do differently either.
  if (!view) return <Refusal message={TRADE_SHARE_REFUSAL_MESSAGE.unknown} />;

  return (
    <>
      <style>{SHARE_STYLESHEET}</style>
      <main className="ts-page">
        <h1 className="ts-title">
          Exchange #{view.tradeNo}
          <span className="ts-status">{view.statusLabel}</span>
        </h1>
        <p className="ts-parties">
          {view.collectorName} and {view.partnerName}
        </p>

        <ValuationNote view={view} />

        <hr className="ts-rule" />

        <Arrange token={token} levels={view.levels} />

        {/* Everything the partner's own answers touch is inside one provider (#667): the mark on a
            row, the words on it and the count at the head of its side are one state, so ticking a
            line moves all three at once. The list itself arrives as children and stays server
            code — the provider holds what was *said*, never what is on the exchange. */}
        <PartnerFeedbackProvider
          token={token}
          canLeave={feedback.canLeave}
          initial={feedback.byLine}
        >
          {view.sections.map((section) => (
            <section key={section.id} className="ts-section">
              <h2 className="ts-section-name">{section.name}</h2>
              <ColnectLists section={section} view={view} />
              <div className="ts-sides">
                {section.sides.map((side) => (
                  <ShareSide
                    key={side.side}
                    side={side}
                    token={token}
                    choices={choices}
                  />
                ))}
              </div>
            </section>
          ))}

          <div className="ts-totals">
            {(["give", "receive"] as const).map((side) => {
              const totals = side === "give" ? view.totals.give : view.totals.receive;
              const heading = view.sections[0]?.sides.find((s) => s.side === side)?.heading ?? "";
              return (
                <div key={side}>
                  <div className="ts-total-line">
                    <span>{heading}</span>
                    <span>{countText(totals)}</span>
                  </div>
                  {totals.value !== null && view.valuation && (
                    <div className="ts-total-line">
                      <span>Total</span>
                      <span>{money(totals.value, view.valuation.currency)}</span>
                    </div>
                  )}
                  {/* Counted, never summed as zero: a total quietly assuming a figure for a line that
                      has none would read as an answer while being a guess. */}
                  {totals.valueMissing > 0 && (
                    <div className="ts-total-line ts-warn">
                      <span>Not priced</span>
                      <span>{totals.valueMissing} lines</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <RateNote view={view} />

          {/* **What the partner has to say about the exchange as a whole** (#641). At the foot, after
              the totals, because that is the order the conversation happens in: the list is read, the
              two sides are compared, and then somebody says *this is close enough* or *can we add
              something mint*. Nothing said here changes the list — it lands in the collector's inbox
              and they decide. */}
          <TradeNoteFeedback
            initial={feedback.trade}
            closedMessage={feedback.closedMessage}
            collectorName={view.collectorName}
          />
        </PartnerFeedbackProvider>
      </main>
    </>
  );
}

/**
 * **The Colnect lists this part of the exchange came out of** (#645; re-parented in #680).
 *
 * On the **section**, over its own two columns: the import targets one `(section, side)` — mint into
 * the mint section, used into the used one — so the link sits above the stamps it produced rather
 * than in one box at the top of the page saying nothing about which part of the trade it was about.
 *
 * Above the columns rather than under them: a partner reading this page is comparing it against a
 * list they wrote on Colnect, and the link to their own copy of it is the first thing they reach
 * for. Laid out in the same two columns the rows are, because *what you are asking me for* and *what
 * I am asking you for* are two lists and one heading would be wrong for one.
 *
 * Absent entirely on a section that names none — an empty heading would be a promise of something
 * that is not there.
 */
function ColnectLists({
  section,
  view,
}: {
  section: TradeShareSectionView;
  view: TradeShareView;
}) {
  if (section.colnectLists.length === 0) return null;
  return (
    <div className="ts-lists ts-lists-section">
      {(["give", "receive"] as const).map((side) => {
        const own = section.colnectLists.filter((list) => list.side === side);
        // The empty side is still a cell, so the other one stays over its own column rather than
        // sliding into the first.
        if (own.length === 0) return <div key={side} />;
        return (
          <div key={side} className="ts-lists-group">
            {/* Headed by **name**, exactly as the side columns below are (`tradeShareSideHeading`):
                *give* and *receive* are the collector's words and they invert on this side of the
                table. */}
            <div className="ts-lists-head">
              {tradeShareSideHeading(side, view.collectorName, view.partnerName)} — on Colnect
            </div>
            <ul>
              {own.map((list) => (
                <li key={list.url}>
                  <a href={list.url} target="_blank" rel="noreferrer noopener">
                    {list.label || list.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** What the figures on this page are, said once, before any of them are read. */
function ValuationNote({ view }: { view: TradeShareView }) {
  if (!view.valuation) {
    return (
      <p className="ts-note">
        This list shows what is on each side. Figures are not included.
      </p>
    );
  }
  if (view.valuation.kind === "agreed") {
    return (
      <p className="ts-note">
        Figures are {view.valuation.catalogName ?? "the agreed catalogue"} prices, in{" "}
        {view.valuation.currency}. A line read in a different publisher&rsquo;s catalogue says so
        beside its figure.
        {view.valuation.frozen && " These are the figures as agreed, not today's."}
      </p>
    );
  }
  return (
    <p className="ts-note">
      No single catalogue has been agreed for this exchange, so the figures are{" "}
      {view.collectorName}&rsquo;s own valuation, in {view.valuation.currency}. Each line says which
      catalogue and edition it was read in.
      {view.valuation.frozen && " These are the figures as agreed, not today's."}
    </p>
  );
}

/** The rates the figures were converted through, and the day each was taken.
 *
 *  Absent from most lists, which is why it is a footnote rather than a panel: Michel and StampWorld
 *  are both in EUR, so a single-currency list has nothing to state. Where there is something, a
 *  converted figure with no rate beside it is a figure nobody can check. */
function RateNote({ view }: { view: TradeShareView }) {
  if (!view.valuation || view.valuation.rates.length === 0) return null;
  return (
    <p className="ts-note">
      Converted at{" "}
      {view.valuation.rates
        .map(
          (rate) =>
            `1 ${rate.fromCurrency} = ${rate.rate.toFixed(4)} ${rate.toCurrency} (${rate.fetchedAt.slice(0, 10)})`
        )
        .join("; ")}
      .
    </p>
  );
}

/**
 * How the material is broken up, as four independent toggles.
 *
 * The trade screen's own levels, in the trade screen's own fixed nesting order — the order the
 * material contains itself, with condition last because it describes the piece rather than the stamp.
 * The partner gets them for the same reason the collector has them: a hundred-line list read flat is
 * a hundred-line list, and by area and year it is a dozen short ones.
 *
 * Links rather than controls, so the page needs no JavaScript and the arrangement is in the address.
 */
function Arrange({ token, levels }: { token: string; levels: TradeGroupLevel[] }) {
  const on = new Set(levels);
  return (
    <nav className="ts-arrange">
      <span className="ts-arrange-label">Group by</span>
      {TRADE_GROUP_LEVELS.map((level) => {
        const next = on.has(level)
          ? levels.filter((l) => l !== level)
          : [...levels, level];
        // Back through the reader, so the query string is always the canonical order rather than
        // click order — two ways of arriving at the same arrangement give the same address.
        const canonical = readTradeGroupLevels(next);
        const href = canonical.length
          ? `/t/${encodeURIComponent(token)}?g=${canonical.join(",")}`
          : `/t/${encodeURIComponent(token)}`;
        return (
          <Link key={level} className="ts-chip" data-on={on.has(level)} href={href}>
            {TRADE_GROUP_LABEL[level]}
          </Link>
        );
      })}
    </nav>
  );
}

function refusalMessage(reason: TradeShareRefusal): string {
  return TRADE_SHARE_REFUSAL_MESSAGE[reason];
}

/** Every dead end reads the same way: one sentence, no app around it, and nothing to sign in to. */
function Refusal({ message }: { message: string }) {
  return (
    <>
      <style>{SHARE_STYLESHEET}</style>
      <main className="ts-page">
        <div className="ts-refusal">
          <h1 className="ts-title">Exchange list</h1>
          <p className="ts-note">{message}</p>
        </div>
      </main>
    </>
  );
}
