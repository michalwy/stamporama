// The **orders** half of a platform module (#612, part of #154).
//
// The other three halves are all about *one thing being sold*: extraction reads a catalogue page
// (#249), listing writes a sale form (#408), capture reads one auction the collector is bidding on
// (#355). This one reads the other end of a sale — the marketplace's own **seller** screens, where
// an order that has already happened is grouped, priced and waiting to be packed.
//
// It is a half of its own for the reason each of the others is: it answers a different question
// about a different page, and a module may carry it without carrying any of the rest. Delcampe's
// module carries this and nothing else, which is a complete module — there is no Delcampe form for
// the Assistant to fill (#608), no catalogue of Delcampe's to match our stamps against, and nothing
// here is bid on.
//
// Like every half, it is **pure DOM → data**: no profiles, no instance calls, no `chrome.*`, so it
// is unit-tested under `linkedom`. And like every half it **decides nothing**. What arrives is what
// the page printed, verbatim, down to `US$3.00` and `Sun 22 Mar 2026 at 22:25`: which currency that
// is, what day that was, which offer each row is and whether the order can be recorded at all are
// the instance's answers (#409), where they are rules with tests rather than parsing inside somebody
// else's page.

/** One item row of an order, as the page printed it. */
export interface PlatformOrderLine {
  /** The marketplace's own listing id, read off the row's **address** — the one fact on the row that
   *  a template change cannot move. */
  platformItemId: string;
  title: string;
  /** The seller's own reference printed on the row, with the marketplace's label off it. On Delcampe
   *  this is `personal_reference`, which after #610 carries the offer's own short URL. */
  reference: string | null;
  /** The row's own price, exactly as printed — currency symbol and all, because which currency a row
   *  is in is part of what it says and not something to strip on the way past. */
  priceText: string | null;
  /** The row's own date, exactly as printed. */
  soldAtText: string | null;
}

/** One order block on a seller's screen, as the page printed it. */
export interface PlatformOrder {
  /** The marketplace's own order id, off the block's own addresses. What the instance matches a
   *  recorded sale on, and the only field here that is load-bearing. */
  orderId: string;
  /** The order's page on the marketplace, absolute — the address of the thing the row is about. */
  orderUrl: string;
  buyerLogin: string | null;
  /** The name printed beside the login. Deliberately the *only* other thing about the buyer read
   *  from a screen that also prints their address and an e-mail relay. */
  buyerName: string | null;
  /**
   * Every amount printed in the order's own header, in document order and exactly as printed —
   * including whatever the marketplace marks a converted figure with, since "about €13.95" and
   * "€13.95" are different claims.
   *
   * A list rather than one figure because Delcampe prints the total **twice**: converted into the
   * screen's display currency and again in the currency the listings were in. Picking between them
   * is a decision, and decisions are the instance's.
   */
  totalTexts: string[];
  lines: PlatformOrderLine[];
  /**
   * The element the mark belongs after: the block's own identifier — the link that states which
   * order this is.
   *
   * It comes from the module rather than being looked for by the shell for #466's reason: a row
   * states which order it is in one place, that place is a fact about the marketplace's page, and the
   * shell must not learn it. The mark then goes exactly where the row already answers "which one is
   * this?", which is where a reader is already looking.
   */
  anchor: Element;
}

/** The orders half of a module: recognise a seller's order screen, and read the orders on it. */
export interface PlatformOrders {
  /** True when `url` is a page of this marketplace's own **sold** orders. */
  matches(url: string): boolean;
  /**
   * Every order block on the page, in document order.
   *
   * A page with none is an empty list rather than a refusal: a phase screen with nothing in it is a
   * normal thing to be standing on, and so is one whose markup this module no longer recognises —
   * both leave the page exactly as they found it.
   */
  read(doc: Document, pageUrl: string): PlatformOrder[];
}
