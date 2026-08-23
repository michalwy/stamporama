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
  /** The row's own date, exactly as printed. Null on a marketplace that dates the **order** instead
   *  of its rows — see {@link PlatformOrder.soldAtText}. */
  soldAtText: string | null;
  /**
   * How many of that listing the row is for, exactly as printed — `"Item count: 1"` (#698).
   *
   * Colnect states one per row and Delcampe's rows are one item each, so it is null there. As
   * printed, label and all, like every other field on this interface: what a count of more than one
   * means for the price beside it is the instance's answer, not this module's.
   */
  quantityText: string | null;
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
   *
   * **With whatever label the screen prints beside the figure**, where it prints one. Colnect states
   * four amounts in its header and each means something different (`Items total € 9.97`,
   * `Shipping price € 2.40`, `Discount -€ 0.37`, `Total with shipping € 12.00`); dropping the words
   * would hand the instance four figures and no way to tell which of them a buyer actually paid,
   * which is a decision destroyed rather than deferred.
   */
  totalTexts: string[];
  /**
   * The order's own date, exactly as printed — Colnect's `Started: August 23, 2026 2:21 PM` (#698).
   *
   * Null where the marketplace dates its **rows** instead of the order, which is Delcampe's shape:
   * there the date is on each {@link PlatformOrderLine} and the instance decides what the order's
   * own date is from them. One of the two is always null, and which is a fact about the screen.
   */
  soldAtText: string | null;
  /**
   * The delivery method the order names, exactly as printed and with the screen's own label off it
   * — `"Stamps→domestic: Registered mail (Poczta Polska)"` (#698). Null where the screen states
   * none, which is every Delcampe sold row.
   */
  shippingMethodText: string | null;
  lines: PlatformOrderLine[];
  /**
   * Whether **this screen** states the whole order — the question that decides whether the row may
   * offer to record it (#698).
   *
   * A marketplace can print an order in two places and only one of them completely: Colnect's
   * transaction list truncates its items (`+ 12 more listings`), so an import from there would
   * write a sale missing lines it should have carried, which is exactly what ADR-0038 §3 refuses.
   * Such a screen still answers *whether* the order is recorded — that is worth knowing on a list —
   * so it reports the order with `canImport: false` and the mark drops its button.
   */
  canImport: boolean;
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
  /**
   * Where the mark goes relative to {@link anchor}: **after** it, or as the last thing **inside** it.
   *
   * A row's own order link is a link, and a mark belongs beside it — that is `after`. A page that
   * names its order in a heading (`Transactions › Transaction #hflVE`) states it as text inside a
   * container, and there is no element to sit beside: `after` would drop the mark onto the next line
   * under the heading. Which of the two a screen is, is a fact about that screen, so the module that
   * read it says so rather than the shell guessing from tag names.
   */
  markPlacement: "after" | "inside";
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
