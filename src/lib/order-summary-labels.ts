import { normalizeLanguage } from "./languages";
import { isSaleCancelled, type SaleStatus } from "./sale-status";

// The order summary's own words (#2604), **in the buyer's language** — its heading, the sale's facts
// above the sets, the *Titles only* table's column names, the totals and the status.
//
// The words a copy row's columns are headed by, and *3 copies* after a set's heading, are the offer
// specification's (`offer-specification-labels.ts`): the two sheets print the same columns, so they
// name them alike. Everything here is in the same languages the specification and the proposal's
// document have their words in; a language outside them gets English, and the page's selector says so.
//
// What is **not** here: the collector's own controls above the sheet (*Print*, the column chips),
// which stay English like the rest of the app; the page footer, which is the collector's own (#2519);
// and each set's name, which is its offer's stored title — what the buyer bought it under.

/** Plural forms keyed by `Intl.PluralRules` category; `other` is always present. */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export interface OrderSummaryLabels {
  /** The heading, before the sale's number: *Order summary #12*. Also the tab title. */
  orderSummary: string;
  date: string;
  buyer: string;
  /** The shipping option above the sets, and the shipping amount among the totals. */
  shipping: string;
  status: string;
  /** The sale's status, by its stored token — `received` reads *Delivered* (#492). */
  statuses: Record<SaleStatus | "cancelled", string>;
  /** The *Titles only* table's columns. */
  set: string;
  copies: string;
  price: string;
  /** The first total, before how many sets it is for: *Items (2 sets)*. */
  items: string;
  /** "set" / "sets" after a count, by plural category. */
  sets: PluralForms;
  total: string;
  /** What the sale's free extras (#2420) are called. */
  freeExtras: string;
}

const EN: OrderSummaryLabels = {
  orderSummary: "Order summary",
  date: "Date",
  buyer: "Buyer",
  shipping: "Shipping",
  status: "Status",
  statuses: {
    ordered: "Ordered",
    paid: "Paid",
    packed: "Packed",
    sent: "Sent",
    received: "Delivered",
    cancelled: "Cancelled",
  },
  set: "Set",
  copies: "Copies",
  price: "Price",
  items: "Items",
  sets: { one: "set", other: "sets" },
  total: "Total",
  freeExtras: "Free extras",
};

const LABELS: Record<string, OrderSummaryLabels> = {
  en: EN,
  cs: {
    orderSummary: "Souhrn objednávky",
    date: "Datum",
    buyer: "Kupující",
    shipping: "Doprava",
    status: "Stav",
    statuses: {
      ordered: "Objednáno",
      paid: "Zaplaceno",
      packed: "Zabaleno",
      sent: "Odesláno",
      received: "Doručeno",
      cancelled: "Zrušeno",
    },
    set: "Sada",
    copies: "Kusy",
    price: "Cena",
    items: "Položky",
    sets: { one: "sada", few: "sady", many: "sady", other: "sad" },
    total: "Celkem",
    freeExtras: "Dárky zdarma",
  },
  da: {
    orderSummary: "Ordreoversigt",
    date: "Dato",
    buyer: "Køber",
    shipping: "Forsendelse",
    status: "Status",
    statuses: {
      ordered: "Bestilt",
      paid: "Betalt",
      packed: "Pakket",
      sent: "Sendt",
      received: "Leveret",
      cancelled: "Annulleret",
    },
    set: "Sæt",
    copies: "Eksemplarer",
    price: "Pris",
    items: "Varer",
    sets: { one: "sæt", other: "sæt" },
    total: "I alt",
    freeExtras: "Gratis ekstra",
  },
  de: {
    orderSummary: "Bestellübersicht",
    date: "Datum",
    buyer: "Käufer",
    shipping: "Versand",
    status: "Status",
    statuses: {
      ordered: "Bestellt",
      paid: "Bezahlt",
      packed: "Verpackt",
      sent: "Versandt",
      received: "Zugestellt",
      cancelled: "Storniert",
    },
    set: "Set",
    copies: "Exemplare",
    price: "Preis",
    items: "Artikel",
    sets: { one: "Set", other: "Sets" },
    total: "Gesamt",
    freeExtras: "Gratisbeigaben",
  },
  es: {
    orderSummary: "Resumen del pedido",
    date: "Fecha",
    buyer: "Comprador",
    shipping: "Envío",
    status: "Estado",
    statuses: {
      ordered: "Pedido",
      paid: "Pagado",
      packed: "Empaquetado",
      sent: "Enviado",
      received: "Entregado",
      cancelled: "Cancelado",
    },
    set: "Conjunto",
    copies: "Ejemplares",
    price: "Precio",
    items: "Artículos",
    sets: { one: "conjunto", many: "conjuntos", other: "conjuntos" },
    total: "Total",
    freeExtras: "Extras gratuitos",
  },
  fi: {
    orderSummary: "Tilausyhteenveto",
    date: "Päivämäärä",
    buyer: "Ostaja",
    shipping: "Toimitus",
    status: "Tila",
    statuses: {
      ordered: "Tilattu",
      paid: "Maksettu",
      packed: "Pakattu",
      sent: "Lähetetty",
      received: "Toimitettu",
      cancelled: "Peruttu",
    },
    set: "Sarja",
    copies: "Kappaleet",
    price: "Hinta",
    items: "Tuotteet",
    sets: { one: "sarja", other: "sarjaa" },
    total: "Yhteensä",
    freeExtras: "Ilmaiset lisät",
  },
  fr: {
    orderSummary: "Récapitulatif de commande",
    date: "Date",
    buyer: "Acheteur",
    shipping: "Livraison",
    status: "Statut",
    statuses: {
      ordered: "Commandé",
      paid: "Payé",
      packed: "Emballé",
      sent: "Expédié",
      received: "Livré",
      cancelled: "Annulé",
    },
    set: "Ensemble",
    copies: "Exemplaires",
    price: "Prix",
    items: "Articles",
    sets: { one: "ensemble", many: "ensembles", other: "ensembles" },
    total: "Total",
    freeExtras: "Cadeaux offerts",
  },
  hu: {
    orderSummary: "Rendelés összesítő",
    date: "Dátum",
    buyer: "Vevő",
    shipping: "Szállítás",
    status: "Állapot",
    statuses: {
      ordered: "Megrendelve",
      paid: "Fizetve",
      packed: "Csomagolva",
      sent: "Elküldve",
      received: "Kézbesítve",
      cancelled: "Törölve",
    },
    set: "Készlet",
    copies: "Példányok",
    price: "Ár",
    items: "Tételek",
    sets: { one: "készlet", other: "készlet" },
    total: "Összesen",
    freeExtras: "Ingyenes ajándékok",
  },
  it: {
    orderSummary: "Riepilogo dell'ordine",
    date: "Data",
    buyer: "Acquirente",
    shipping: "Spedizione",
    status: "Stato",
    statuses: {
      ordered: "Ordinato",
      paid: "Pagato",
      packed: "Imballato",
      sent: "Spedito",
      received: "Consegnato",
      cancelled: "Annullato",
    },
    set: "Set",
    copies: "Esemplari",
    price: "Prezzo",
    items: "Articoli",
    sets: { one: "set", many: "set", other: "set" },
    total: "Totale",
    freeExtras: "Omaggi",
  },
  nl: {
    orderSummary: "Besteloverzicht",
    date: "Datum",
    buyer: "Koper",
    shipping: "Verzending",
    status: "Status",
    statuses: {
      ordered: "Besteld",
      paid: "Betaald",
      packed: "Ingepakt",
      sent: "Verzonden",
      received: "Bezorgd",
      cancelled: "Geannuleerd",
    },
    set: "Set",
    copies: "Exemplaren",
    price: "Prijs",
    items: "Artikelen",
    sets: { one: "set", other: "sets" },
    total: "Totaal",
    freeExtras: "Gratis extra's",
  },
  no: {
    orderSummary: "Ordreoversikt",
    date: "Dato",
    buyer: "Kjøper",
    shipping: "Frakt",
    status: "Status",
    statuses: {
      ordered: "Bestilt",
      paid: "Betalt",
      packed: "Pakket",
      sent: "Sendt",
      received: "Levert",
      cancelled: "Kansellert",
    },
    set: "Sett",
    copies: "Eksemplarer",
    price: "Pris",
    items: "Varer",
    sets: { one: "sett", other: "sett" },
    total: "Totalt",
    freeExtras: "Gratis ekstra",
  },
  pl: {
    orderSummary: "Podsumowanie zamówienia",
    date: "Data",
    buyer: "Kupujący",
    shipping: "Wysyłka",
    status: "Status",
    statuses: {
      ordered: "Zamówione",
      paid: "Opłacone",
      packed: "Spakowane",
      sent: "Wysłane",
      received: "Doręczone",
      cancelled: "Anulowane",
    },
    set: "Zestaw",
    copies: "Egzemplarze",
    price: "Cena",
    items: "Przedmioty",
    sets: { one: "zestaw", few: "zestawy", many: "zestawów", other: "zestawu" },
    total: "Razem",
    freeExtras: "Gratisy",
  },
  pt: {
    orderSummary: "Resumo da encomenda",
    date: "Data",
    buyer: "Comprador",
    shipping: "Envio",
    status: "Estado",
    statuses: {
      ordered: "Encomendado",
      paid: "Pago",
      packed: "Embalado",
      sent: "Enviado",
      received: "Entregue",
      cancelled: "Cancelado",
    },
    set: "Conjunto",
    copies: "Exemplares",
    price: "Preço",
    items: "Artigos",
    sets: { one: "conjunto", many: "conjuntos", other: "conjuntos" },
    total: "Total",
    freeExtras: "Extras grátis",
  },
  ro: {
    orderSummary: "Rezumatul comenzii",
    date: "Data",
    buyer: "Cumpărător",
    shipping: "Livrare",
    status: "Stare",
    statuses: {
      ordered: "Comandat",
      paid: "Plătit",
      packed: "Ambalat",
      sent: "Expediat",
      received: "Livrat",
      cancelled: "Anulat",
    },
    set: "Set",
    copies: "Exemplare",
    price: "Preț",
    items: "Articole",
    sets: { one: "set", few: "seturi", other: "de seturi" },
    total: "Total",
    freeExtras: "Extra gratuite",
  },
  ru: {
    orderSummary: "Сводка заказа",
    date: "Дата",
    buyer: "Покупатель",
    shipping: "Доставка",
    status: "Статус",
    statuses: {
      ordered: "Заказан",
      paid: "Оплачен",
      packed: "Упакован",
      sent: "Отправлен",
      received: "Доставлен",
      cancelled: "Отменён",
    },
    set: "Набор",
    copies: "Экземпляры",
    price: "Цена",
    items: "Товары",
    sets: { one: "набор", few: "набора", many: "наборов", other: "набора" },
    total: "Итого",
    freeExtras: "Бесплатные дополнения",
  },
  sk: {
    orderSummary: "Súhrn objednávky",
    date: "Dátum",
    buyer: "Kupujúci",
    shipping: "Doprava",
    status: "Stav",
    statuses: {
      ordered: "Objednané",
      paid: "Zaplatené",
      packed: "Zabalené",
      sent: "Odoslané",
      received: "Doručené",
      cancelled: "Zrušené",
    },
    set: "Súprava",
    copies: "Kusy",
    price: "Cena",
    items: "Položky",
    sets: { one: "súprava", few: "súpravy", many: "súpravy", other: "súprav" },
    total: "Spolu",
    freeExtras: "Darčeky zadarmo",
  },
  sv: {
    orderSummary: "Orderöversikt",
    date: "Datum",
    buyer: "Köpare",
    shipping: "Frakt",
    status: "Status",
    statuses: {
      ordered: "Beställd",
      paid: "Betald",
      packed: "Packad",
      sent: "Skickad",
      received: "Levererad",
      cancelled: "Avbruten",
    },
    set: "Set",
    copies: "Exemplar",
    price: "Pris",
    items: "Varor",
    sets: { one: "set", other: "set" },
    total: "Totalt",
    freeExtras: "Gratis extra",
  },
  uk: {
    orderSummary: "Підсумок замовлення",
    date: "Дата",
    buyer: "Покупець",
    shipping: "Доставка",
    status: "Статус",
    statuses: {
      ordered: "Замовлено",
      paid: "Оплачено",
      packed: "Упаковано",
      sent: "Надіслано",
      received: "Доставлено",
      cancelled: "Скасовано",
    },
    set: "Набір",
    copies: "Примірники",
    price: "Ціна",
    items: "Товари",
    sets: { one: "набір", few: "набори", many: "наборів", other: "набору" },
    total: "Разом",
    freeExtras: "Безкоштовні додатки",
  },
};

/** The languages the order summary has its own words in. */
export const ORDER_SUMMARY_LABEL_LANGUAGES: readonly string[] = Object.keys(LABELS).sort();

/** Whether the order summary has its own words in `language` — false sends it to English, which the
 *  page's language selector states. */
export function hasOrderSummaryLabels(language: string | null): boolean {
  const code = normalizeLanguage(language);
  return !!code && code in LABELS;
}

/** The order summary's words in `language`, or English where it has none. */
export function orderSummaryLabels(language: string | null): OrderSummaryLabels {
  const code = normalizeLanguage(language);
  return (code && LABELS[code]) || EN;
}

/** The language the words actually come out in — `language` itself, or `en` where it has none. */
function labelLanguage(language: string | null): string {
  const code = normalizeLanguage(language);
  return code && code in LABELS ? code : "en";
}

/** *Items (2 sets)*, *Przedmioty (5 zestawów)* — the first total's label, its count in the right plural
 *  form. */
export function orderSummaryItemsLabel(language: string | null, sets: number): string {
  const labels = orderSummaryLabels(language);
  const category = new Intl.PluralRules(labelLanguage(language)).select(sets);
  return `${labels.items} (${sets} ${labels.sets[category] ?? labels.sets.other})`;
}

/** The sale's status in the summary's language; a status the sheet does not know prints as stored. */
export function orderSummaryStatus(language: string | null, status: string): string {
  const { statuses } = orderSummaryLabels(language);
  if (isSaleCancelled(status)) return statuses.cancelled;
  return (statuses as Record<string, string>)[status] ?? status;
}
