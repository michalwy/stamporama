import "server-only";
import { prisma } from "./db";

// What an imported order **became**, in the few figures worth reading back on the marketplace's own
// page (#698's follow-up).
//
// The import used to answer with a sale number and a path, which is enough for a link and not enough
// for the question a collector actually has after pressing a button that writes: *what did it just
// record?* They are standing on Colnect's page with the parcel in front of them, and checking the
// answer meant opening the sale in another tab — which is the trip the mark exists to remove.
//
// So the same read serves both halves of the answer. A sale **created** by this call and one that
// **already claimed** the order are summarised identically: a re-import is a link, and a link worth
// following is worth describing.
//
// Deliberately a summary and not the sale: the figures a person checks against the screen they are
// looking at — who, when, how many lines, what they add up to, what the buyer paid — and the one
// thing about the record that needs acting on, the lines whose set nobody has chosen yet (#697).

/** The few figures an imported order is worth stating back on the marketplace's own page. */
export interface ImportedSaleSummary {
  /** The buyer as filed here — their marketplace login (#463). Null on an anonymous sale. */
  buyer: string | null;
  /** `YYYY-MM-DD`, the day the sale is dated. */
  soldAt: string;
  currency: string;
  lineCount: number;
  /** What the recorded lines add up to, so the page's own `Items total` can be read against it. */
  gross: string;
  /** #205's anchor as stored, or null where the page stated no total this app could take. */
  buyerPaidTotal: string | null;
  /** The delivery method recorded on the sale (#468), as stored. */
  shippingMethodName: string | null;
  /** How many lines name a set **nobody has chosen** (#697) — the one thing in an imported sale that
   *  still wants a decision, and the reason the window says so rather than leaving it to be found. */
  setChoicePending: number;
}

/**
 * Summarise one sale of this collection, or null when it is not there.
 *
 * Scoped to `collectionId` rather than trusting the id: this is read on the way out of an import
 * whose caller has already been authorised, and a summary that answered for any sale by id would be
 * the one read in the flow that never checked.
 */
export async function saleImportSummary(
  collectionId: string,
  saleId: string
): Promise<ImportedSaleSummary | null> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, collectionId },
    select: {
      soldAt: true,
      currency: true,
      buyerPaidTotal: true,
      shippingMethodName: true,
      buyer: { select: { name: true } },
      lines: { select: { price: true, setChoicePending: true } },
    },
  });
  if (!sale) return null;

  const gross = sale.lines.reduce((total, line) => total + Number(line.price), 0);
  return {
    buyer: sale.buyer?.name ?? null,
    // The stored date, formatted from its UTC parts: `Sale.soldAt` is a `@db.Date`, so reading it
    // through the server's local calendar would move a sale a day in either direction.
    soldAt: sale.soldAt.toISOString().slice(0, 10),
    currency: sale.currency,
    lineCount: sale.lines.length,
    gross: gross.toFixed(2),
    buyerPaidTotal: sale.buyerPaidTotal?.toFixed(2) ?? null,
    shippingMethodName: sale.shippingMethodName,
    setChoicePending: sale.lines.filter((line) => line.setChoicePending).length,
  };
}
