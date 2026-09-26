// What the purchase operations answer with, the projections that build it, and the two rules they
// write with — how a seller is matched, and what counts as a name close to one already there (#1390).
//
// **Pure, and structurally typed on purpose**, the shape every `*-reads.ts` beside it has and for
// their reason (`agent-api.md`, *The module layout is the Prisma-free split*). No Prisma, no
// `server-only`, so `pnpm test:unit` holds every decision below.
//
// Four of those decisions are the ones worth a test:
//
//  - **A contact is two fields and never more.** The row behind a seller also carries `email`,
//    `phone` and `notes` — a private person's details, which #1390 puts out of this surface's reach
//    in both directions. The projections name their fields; **do not replace a mapper here with a
//    spread** (#708's measured lesson about the platform vocabulary).
//  - **Money is the purchase screen's, in both currencies** (#852). The transaction figures are
//    what was paid and the base ones the only comparable ones, and a purchase with no frozen rate
//    says so in words: `base` is `null` beside a sentence, never a zero and never a partial sum.
//  - **A seller is matched exactly or not at all.** An id, or a name or full name equal to the
//    input once case and surrounding space are set aside. Anything looser would be a guess, and
//    filing a purchase under the wrong seller is invisible and expensive.
//  - **A new seller's name is refused when it is close to one already there**, unless the agent
//    says it is a different person. The typo that produces a second *Kowalski* is exactly what
//    exact matching lets through, so creation is where the looser comparison belongs.

import { invalidRequest } from "./errors";
import { compact } from "./collection-reads";

// ── Contacts ─────────────────────────────────────────────────────────────────

/** A contact as this surface sees one — the name it is filed under, and nothing personal. */
export interface AgentSeller {
  readonly id: string;
  readonly name: string;
}

/**
 * What a seller is matched against. `fullName` is read so that *Bronisław* finds `bronek_1980`, the
 * way the supplier picker searches (#463); it is never handed back.
 */
export interface SellerCandidate {
  readonly id: string;
  readonly name: string;
  readonly fullName: string | null;
}

/** Trim and case-fold: the exact-match comparison. */
function fold(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * The loose comparison: accents off, letters and digits only. `Łukasz Nowak`, `lukasz.nowak` and
 * `LUKASZ NOWAK` are one string here. `ł`, `đ`, `ø` and `ß` do not decompose, so they are spelled out.
 */
export function looseName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/ø/g, "o")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Levenshtein distance, stopping early once it passes `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * Whether two names are close enough that one is probably the other mistyped.
 *
 * The same once loosened; one containing the other where both are long enough to mean something
 * (`Kowalski` inside `Jan Kowalski`, but not `Anna` inside `Hanna`); or one or two letters apart,
 * scaled to the length — a five-letter name one letter off is a different name, an eight-letter one
 * is a typo, and a twelve-letter one two letters off is still one.
 */
export function namesAreClose(a: string, b: string): boolean {
  const x = looseName(a);
  const y = looseName(b);
  if (x === "" || y === "") return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))) return true;
  const longest = Math.max(x.length, y.length);
  const allowed = longest <= 5 ? 0 : longest <= 10 ? 1 : 2;
  return allowed > 0 && editDistance(x, y, allowed) <= allowed;
}

/** The contacts close to any of `names`, compared against both what they are filed under and their
 *  full name. */
export function closeContacts(
  names: readonly string[],
  candidates: readonly SellerCandidate[]
): readonly AgentSeller[] {
  return candidates
    .filter((candidate) =>
      names.some(
        (name) =>
          namesAreClose(name, candidate.name) ||
          (candidate.fullName !== null && namesAreClose(name, candidate.fullName))
      )
    )
    .map(seller);
}

/** The projection. Two fields, named, so nothing personal can ride along. */
export function seller(candidate: { id: string; name: string }): AgentSeller {
  return { id: candidate.id, name: candidate.name };
}

/** How many close names a refusal lists before sending the agent to ask the collector. */
export const MAX_SELLER_SUGGESTIONS = 10;

/**
 * The contact behind `value`, which may be an id or a name.
 *
 * #708's three branches, over the address book rather than a vocabulary: an id is taken as an id,
 * a name or full name matching exactly one contact resolves, and a name matching several is refused
 * with their ids — named in the sentence, because there is no vocabulary read that would say which
 * is which. **An unknown name is refused rather than created**: creating a seller is its own act
 * (`create_seller`), and a misspelt name must not quietly become a new person. The refusal lists the
 * contacts close to what was sent, which is usually the one that was meant.
 */
export function resolveSeller(
  value: string,
  candidates: readonly SellerCandidate[],
  parameter: string
): string {
  const trimmed = value.trim();
  const byId = candidates.find((candidate) => candidate.id === trimmed);
  if (byId) return byId.id;

  const wanted = fold(trimmed);
  const matched = candidates.filter(
    (candidate) =>
      fold(candidate.name) === wanted ||
      (candidate.fullName !== null && fold(candidate.fullName) === wanted)
  );
  if (matched.length === 1) return matched[0].id;
  if (matched.length > 1) {
    // The ids in `accepted`, as #708's ambiguity refusal carries them — and the names in the
    // sentence, since no vocabulary read would tell the agent which id is which.
    throw invalidRequest(
      `"${trimmed}" matches ${matched.length} contacts in this collection, so the name is not enough: ${matched
        .map((candidate) => `${candidate.name} (${candidate.id})`)
        .join(", ")}. Send the id of the one meant as "${parameter}".`,
      matched.map((candidate) => candidate.id)
    );
  }

  const close = closeContacts([trimmed], candidates).slice(0, MAX_SELLER_SUGGESTIONS);
  throw invalidRequest(
    close.length > 0
      ? `No contact in this collection is called "${trimmed}". These are close: ${close
          .map((candidate) => candidate.name)
          .join(", ")}. Send one of them as "${parameter}" if it is the one meant; if the seller is somebody new, create them with \`create_seller\` first.`
      : `No contact in this collection is called "${trimmed}", and none is close to it. If the seller is somebody new, create them with \`create_seller\` first and send the id it returns as "${parameter}".`,
    close.map((candidate) => candidate.name)
  );
}

// ── Amounts and dates ────────────────────────────────────────────────────────

/**
 * An amount as a purchase stores it: digits, at most two decimals, never negative. The two-decimal
 * rule is the order screen's own (every amount there is shown and saved to the cent), so a figure
 * with a third decimal is refused rather than rounded behind the agent's back.
 */
export function parseAmount(value: string, parameter: string): number {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw invalidRequest(
      `"${text}" is not an amount for "${parameter}". Send a number with at most two decimal places and a period as the separator — "12.50" — in the purchase's own currency.`
    );
  }
  return Number(text);
}

/** A calendar date, `yyyy-mm-dd`, that exists. */
export function parseIsoDate(value: string, parameter: string): string {
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? new Date(`${text}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw invalidRequest(`"${text}" is not a date for "${parameter}". Send it as yyyy-mm-dd — "2026-09-26".`);
  }
  return text;
}

// ── Money in both currencies ─────────────────────────────────────────────────

/** Three figures in one currency: the priced lines, the shipping, and the two added up. */
export interface AgentAmounts {
  readonly currency: string;
  readonly total: string;
  readonly price: string;
  readonly shipping: string;
}

/**
 * What a scope cost (#852), as the purchase screen states it.
 *
 * `paid` is the transaction currency — what a receipt would show. `base` is the collection's base
 * currency at the rate frozen on the purchase, and **`null` when the purchase is in another
 * currency and no rate is recorded**, with `baseMissing` saying so: an unconvertible figure is
 * absent, never zero and never partial.
 */
export interface AgentSpend {
  readonly paid: AgentAmounts;
  readonly base: AgentAmounts | null;
  readonly baseMissing?: string;
}

/** The fields of `PurchaseSpend` this projection reads. */
export interface SpendRow {
  readonly tx: AgentAmounts;
  readonly base: AgentAmounts | null;
  readonly baseCurrency: string;
}

export function spend(row: SpendRow): AgentSpend {
  const amounts = (a: AgentAmounts): AgentAmounts => ({
    currency: a.currency,
    total: a.total,
    price: a.price,
    shipping: a.shipping,
  });
  if (row.base) return { paid: amounts(row.tx), base: amounts(row.base) };
  return {
    paid: amounts(row.tx),
    base: null,
    baseMissing: `No exchange rate to ${row.baseCurrency} is recorded for this purchase, so there is no ${row.baseCurrency} figure. The ${row.tx.currency} amounts are exact.`,
  };
}

// ── list_purchases ───────────────────────────────────────────────────────────

/** One purchase in a list. */
export interface AgentPurchaseRow {
  readonly purchaseId: string;
  /** The short number the collector calls it by — what `p12` means in the quick-jump box. */
  readonly purchaseNo: number;
  readonly seller?: AgentSeller;
  readonly platform?: string;
  readonly purchasedAt: string;
  readonly currency: string;
  /** `preparing`, `in_transit` or `arrived`. Nothing on this surface moves it. */
  readonly status: string;
  readonly shippingCost?: string;
  readonly lots: number;
  readonly expenses: number;
  /** Lots, expenses and shipping added up, in `currency`. */
  readonly total: string;
  /** The incoming half of a closed trade (#644): read-only here, its figures being carried over. */
  readonly fromTrade?: true;
  readonly path: string;
}

/** The fields of `PurchaseListItem` this projection reads. */
export interface PurchaseListRow {
  readonly id: string;
  readonly purchaseNo: number;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly platformName: string | null;
  readonly purchasedAt: string;
  readonly currency: string;
  readonly status: string;
  readonly shippingCost: string | null;
  readonly lotCount: number;
  readonly expenseCount: number;
  readonly total: string | null;
  readonly type: string;
}

export function purchaseRow(row: PurchaseListRow, path: string): AgentPurchaseRow {
  return compact({
    purchaseId: row.id,
    purchaseNo: row.purchaseNo,
    seller:
      row.contactId !== null && row.contactName !== null
        ? seller({ id: row.contactId, name: row.contactName })
        : undefined,
    platform: row.platformName ?? undefined,
    purchasedAt: row.purchasedAt,
    currency: row.currency,
    status: row.status,
    shippingCost: row.shippingCost ?? undefined,
    lots: row.lotCount,
    expenses: row.expenseCount,
    // Always set on a purchase (`PurchaseListItem.total` is null only on an opening balance).
    total: row.total ?? "0.00",
    fromTrade: row.type === "trade" ? (true as const) : undefined,
    path,
  });
}

// ── get_purchase ─────────────────────────────────────────────────────────────

/** One lot of a purchase. */
export interface AgentPurchaseLot {
  readonly lotId: string;
  /** Absent when the collector has not named it; the screen then labels it by its copies. */
  readonly title?: string;
  /** In the purchase's currency. */
  readonly price: string;
  /** `open` while copies are still being identified; `closed` once its cost is frozen onto them. */
  readonly status: string;
  readonly copies: number;
  /** Whether `remove_purchase_lot` would take it: open, empty, and on nothing else's record. */
  readonly removable: boolean;
  /** The lot's price and its share of the order's shipping, in both currencies. */
  readonly spend: AgentSpend;
}

/** One non-inventory line. */
export interface AgentPurchaseExpense {
  readonly expenseId: string;
  readonly label: string;
  readonly price: string;
}

/** One purchase in full. */
export interface AgentPurchase {
  readonly purchaseId: string;
  readonly purchaseNo: number;
  readonly seller?: AgentSeller;
  readonly platform?: string;
  readonly purchasedAt: string;
  /** Every amount on the purchase, its lots and its expenses is in this currency. */
  readonly currency: string;
  readonly status: string;
  readonly shippingCost?: string;
  /** Whether this surface may write to it. False on the incoming half of a trade. */
  readonly editable: boolean;
  readonly fromTrade?: true;
  /** The auction sale it was settled from (#28), by name. */
  readonly fromAuctionSale?: string;
  /** What the whole order cost. */
  readonly spend: AgentSpend;
  readonly lots: readonly AgentPurchaseLot[];
  readonly expenses: readonly AgentPurchaseExpense[];
  readonly path: string;
}

/** The fields of `LotSummary` this projection reads. */
export interface PurchaseLotRow {
  readonly id: string;
  readonly title: string | null;
  readonly price: string | null;
  readonly status: string;
  readonly itemCount: number;
  readonly spend: SpendRow;
}

/** The fields of `PurchaseDetail` this projection reads. */
export interface PurchaseDetailRow {
  readonly id: string;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly platformName: string | null;
  readonly purchasedAt: string;
  readonly currency: string;
  readonly status: string;
  readonly shippingCost: string | null;
  readonly spend: SpendRow;
  readonly lots: readonly PurchaseLotRow[];
  readonly expenses: readonly { id: string; label: string; price: string }[];
  readonly auctionSale: { name: string } | null;
  readonly trade: unknown | null;
}

export function purchase(
  row: PurchaseDetailRow,
  extra: {
    readonly purchaseNo: number;
    readonly path: string;
    /** Lots another record points at (a won auction lot, a trade line) — never removable here. */
    readonly linkedLotIds: ReadonlySet<string>;
  }
): AgentPurchase {
  const fromTrade = row.trade !== null;
  return compact({
    purchaseId: row.id,
    purchaseNo: extra.purchaseNo,
    seller:
      row.contactId !== null && row.contactName !== null
        ? seller({ id: row.contactId, name: row.contactName })
        : undefined,
    platform: row.platformName ?? undefined,
    purchasedAt: row.purchasedAt,
    currency: row.currency,
    status: row.status,
    shippingCost: row.shippingCost ?? undefined,
    editable: !fromTrade,
    fromTrade: fromTrade ? (true as const) : undefined,
    fromAuctionSale: row.auctionSale?.name,
    spend: spend(row.spend),
    lots: row.lots.map((lot) =>
      compact({
        lotId: lot.id,
        title: lot.title ?? undefined,
        price: lot.price ?? "0.00",
        status: lot.status,
        copies: lot.itemCount,
        removable:
          !fromTrade && lot.status === "open" && lot.itemCount === 0 && !extra.linkedLotIds.has(lot.id),
        spend: spend(lot.spend),
      })
    ),
    expenses: row.expenses.map((expense) => ({
      expenseId: expense.id,
      label: expense.label,
      price: expense.price,
    })),
    path: extra.path,
  });
}
