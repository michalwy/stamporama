/**
 * What the **figures row** of a platform's summary strip says (#1960; ADR-0059 §4) — the figures the
 * contact page's Platform section carried (#1710), each opening the list it counts. Pure, so the
 * words, the money rules and the addresses are tested without rendering anything.
 *
 * The money follows the contact page unchanged (`contact-page-rules.ts`): the total in the
 * collection's currency, and the transaction currency's total beside it where every amount shared one
 * other currency. A total with an amount that has no exchange rate states no base figure rather than
 * a partial one, and says how many are why.
 */

import type { MoneyTotal } from "@/lib/contact-page-rules";
import type { PlatformFigures } from "@/lib/platform-figures";

export interface PlatformFigureTile {
  key: string;
  title: string;
  figure: string;
  /** A second, muted line, or null. */
  detail: string | null;
  /** The longer explanation behind the tile, or null. */
  hint: string | null;
  /** The list the figure counts; null where there is nothing to open. */
  href: string | null;
}

/** The lists the figures open, each narrowed to the platform alone. */
export interface PlatformFigureHrefs {
  offers: (state: string) => string;
  sales: string;
  purchases: string;
}

/**
 * The three lists, narrowed to the platform and — by naming every other filter empty — to nothing
 * else the list happens to remember: the contact page's rule (#1710).
 */
export function platformFigureHrefs(collectionSlug: string, platformId: string): PlatformFigureHrefs {
  return {
    offers: (state) =>
      `/c/${collectionSlug}/offers?${new URLSearchParams({ platform: platformId, state, search: "" })}`,
    sales: `/c/${collectionSlug}/sales?${new URLSearchParams({ platform: platformId, status: "", search: "" })}`,
    purchases: `/c/${collectionSlug}/purchases?${new URLSearchParams({
      type: "purchase",
      platform: platformId,
      supplier: "",
      status: "",
    })}`,
  };
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A money total as a tile says it: the figure, the line under it, and the reason behind a missing
 *  base total. */
export function moneyWords(
  total: MoneyTotal,
  noun: string
): { figure: string; detail: string | null; hint: string | null } {
  if (total.base == null) {
    return {
      figure: total.tx ? `${total.tx.total} ${total.tx.currency}` : `No ${total.baseCurrency} total`,
      detail: `${plural(total.unconvertedCount, noun)} without an exchange rate`,
      hint: `${plural(total.unconvertedCount, noun)} ${total.unconvertedCount === 1 ? "has" : "have"} no exchange rate into ${total.baseCurrency}, so no ${total.baseCurrency} total is stated rather than a partial one.`,
    };
  }
  return {
    figure: `${total.base} ${total.baseCurrency}`,
    detail: total.tx ? `${total.tx.total} ${total.tx.currency}` : null,
    hint: null,
  };
}

/** Said in every tile while the figures are still being read. */
export const FIGURE_LOADING = "…";

/**
 * The nine tiles, in the contact page's order. With `figures` null — still being read — each tile
 * names its figure and opens nothing yet.
 */
export function platformFigureTiles(
  figures: PlatformFigures | null,
  href: PlatformFigureHrefs
): PlatformFigureTile[] {
  if (!figures) {
    return FIGURE_TITLES.map(({ key, title }) => ({
      key,
      title,
      figure: FIGURE_LOADING,
      detail: null,
      hint: null,
      href: null,
    }));
  }
  const f = figures;
  const ended = f.soldCount + f.withdrawnCount;
  const plain = (key: FigureKey, figure: string | number, to: string | null, detail: string | null = null) => ({
    key,
    title: TITLE[key],
    figure: String(figure),
    detail,
    hint: null,
    href: to,
  });
  return [
    plain("active", f.activeCount, href.offers("active"), "now"),
    plain("ready", f.readyCount, href.offers("ready"), "now"),
    plain("sold", f.soldCount, href.offers("sold")),
    plain("sales", f.salesCount, href.sales),
    { key: "revenue", title: TITLE.revenue, ...moneyWords(f.revenue, "sale"), href: href.sales },
    plain(
      "sell-through",
      f.sellThrough == null ? "—" : `${Math.round(f.sellThrough * 100)}%`,
      ended > 0 ? href.offers("sold,withdrawn") : null,
      ended > 0 ? `${f.soldCount} of ${ended} ended` : null
    ),
    plain(
      "time-to-sale",
      f.avgDaysToSale == null ? "—" : `${f.avgDaysToSale} days`,
      f.avgDaysToSale == null ? null : href.offers("sold"),
      f.timedCount < f.soldCount ? `over ${f.timedCount} of ${f.soldCount} sold` : null
    ),
    plain("purchases", f.purchaseCount, href.purchases),
    { key: "spent", title: TITLE.spent, ...moneyWords(f.purchaseSpent, "purchase"), href: href.purchases },
  ];
}

const FIGURE_TITLES = [
  { key: "active", title: "Offers active" },
  { key: "ready", title: "Offers ready" },
  { key: "sold", title: "Offers sold" },
  { key: "sales", title: "Sales" },
  { key: "revenue", title: "Revenue" },
  { key: "sell-through", title: "Sell-through" },
  { key: "time-to-sale", title: "Time to sale" },
  { key: "purchases", title: "Purchases" },
  { key: "spent", title: "Spent" },
] as const;

type FigureKey = (typeof FIGURE_TITLES)[number]["key"];

const TITLE = Object.fromEntries(FIGURE_TITLES.map((t) => [t.key, t.title])) as Record<
  FigureKey,
  string
>;
