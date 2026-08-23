import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { verifySaleShareToken } from "@/lib/sale-share";
import { readSaleShareView, type SaleShareLineView } from "@/lib/sale-share-choice";
import { SALE_SHARE_REFUSAL_MESSAGE, type SaleShareRefusal } from "@/lib/sale-share-rules";
import { SALE_SHARE_STYLESHEET } from "./share-styles";
import { LineSetChoice } from "./sale-choice";

// **The buyer's copy choice** (#699; ADR-0013 §7): one question, addressed by a secret link, for
// somebody with no account and no session.
//
// It sits outside `/c/[collectionSlug]` for the reason the partner's page does (#640) — the reader
// has no collection, and the slug would be a second name for something the token already resolves.
// It inherits no collection layout, so there is no sidebar and nothing to navigate into: the only
// thing on this page is the question.
//
// Everything it prints comes from `readSaleShareView`, scoped to the one sale the token names. This
// file resolves a token and lays out what comes back; it asks no questions of its own, so there is
// no query here that could be widened by accident.
//
// **What is not on it** is the point as much as what is. Not the prices — the buyer knows what they
// paid and the seller's costs are nobody else's business — not the other lines of the order, not the
// copies' numbers or where they are filed, and not one other thing in the collection. The page is
// the pictures of the copies it is asking about, and a radio under each.

export const metadata: Metadata = {
  title: "Choose your copy",
  // A secret link is only secret while nothing publishes it. Crawlers reach pages through referrers
  // and toolbars as well as through links, so the refusal is stated rather than assumed.
  robots: { index: false, follow: false, nocache: true },
};

/** Requests per address per minute. Generous for a buyer reading and reloading one short page, and
 *  far below what walking the token space would need. */
const SHARE_PAGE_LIMIT = 60;
const SHARE_WINDOW_MS = 60_000;

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export default async function SaleSharePage({ params }: SharePageProps) {
  const { token } = await params;

  const limited = rateLimit(
    `sale-share:${clientAddress(await headers())}`,
    SHARE_PAGE_LIMIT,
    SHARE_WINDOW_MS
  );
  if (!limited.ok) {
    return <Refusal message="Too many requests. Please wait a moment and reload the page." />;
  }

  const verified = await verifySaleShareToken(token);
  if (!verified.ok) return <Refusal message={refusalMessage(verified.reason)} />;

  const view = await readSaleShareView(verified.access);
  // The token verified against a sale that has gone since. Told the same way a withdrawn link is:
  // the buyer has no way to tell the two apart and nothing they could do differently either.
  if (!view) return <Refusal message={SALE_SHARE_REFUSAL_MESSAGE.unknown} />;

  return (
    <>
      <style>{SALE_SHARE_STYLESHEET}</style>
      <main className="ts-page">
        <h1 className="ts-title">Choose your copy</h1>
        <p className="ts-parties">
          {view.sellerName} · {view.platformName}
          {view.orderRef ? ` · order ${view.orderRef}` : ""}
        </p>

        {view.lines.length === 0 ? (
          // Nothing outstanding: either the seller settled every line themselves, or they never had
          // a choice to make. Said plainly, because a blank page reads as a broken link.
          <p className="ts-note">
            There is nothing left to choose on this order — the seller has already picked which
            copies go in the parcel. You can close this page.
          </p>
        ) : (
          <>
            <p className="ts-note">
              {view.sellerName} has more than one of what you bought, and the copies are not
              identical — the centring, the perforation and the cancel differ. Pick the one you would
              like and it is the one that gets packed.
            </p>
            <hr className="ts-rule" />
            {view.lines.map((line) => (
              <section key={line.lineId} className="ss-line">
                <LineHead line={line} />
                <LineSetChoice
                  token={token}
                  line={line}
                  open={view.open}
                  closedMessage={view.closedMessage}
                />
              </section>
            ))}
          </>
        )}
      </main>
    </>
  );
}

/** What the line is about, in the buyer's own terms: the catalogue numbers and the stamp's name.
 *  A line can be a set of several stamps — a series listed as one lot — so every one of them is
 *  named rather than only the first. */
function LineHead({ line }: { line: SaleShareLineView }) {
  return (
    <>
      {line.stamps.map((stamp, index) => (
        <div key={index} className="ss-line-head">
          {stamp.numbers.map((number) => (
            <span key={number} className="ss-cn">
              {number}
            </span>
          ))}
          {stamp.name && <span className="ss-name">{stamp.name}</span>}
        </div>
      ))}
      {line.copyCount > 1 && (
        <p className="ss-meta">
          {line.copyCount} stamps go together on this line — you are choosing between whole sets.
        </p>
      )}
    </>
  );
}

function refusalMessage(reason: SaleShareRefusal): string {
  return SALE_SHARE_REFUSAL_MESSAGE[reason];
}

/** Every dead end reads the same way: one sentence, no app around it, and nothing to sign in to. */
function Refusal({ message }: { message: string }) {
  return (
    <>
      <style>{SALE_SHARE_STYLESHEET}</style>
      <main className="ts-page">
        <div className="ts-refusal">
          <h1 className="ts-title">Choose your copy</h1>
          <p className="ts-note">{message}</p>
        </div>
      </main>
    </>
  );
}
