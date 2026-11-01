import { normalizeLanguage } from "./languages";
import { isProposalOpen, type ProposalStatus } from "./proposal-rules";

// **What a proposal's buyer is sent** (#2288) — the pure half, with no database and no `server-only`:
// the document's standing and marks, the link's shape and addresses, the photos' file names, and the
// document's own words in the proposal's language.
//
// The document is a Facebook post's preview (#2212) for one person: the proposal's lots, each with its
// number, title, price and photos, and the total. Its link **stays live** while the proposal is open —
// it follows the prices — and says only that the offer is closed once it is sold or declined.

/** Every raw token starts with this — beside `stmpa_` (the Assistant), `stmpx_` (a trade), `stmps_`
 *  (a sale), `stmpo_` (a specification), `stmpf_` (a post's preview) and `stmpr_` (an Assistant's
 *  registration) — so credentials authorising different things are told apart before anything is
 *  hashed. `d` for Direct, the platform a proposal is sold on. */
export const PROPOSAL_SHARE_TOKEN_PREFIX = "stmpd_";

/** Cheap shape check, run before any lookup. */
export function isProposalShareTokenShape(raw: string): boolean {
  return raw.startsWith(PROPOSAL_SHARE_TOKEN_PREFIX) && raw.length > PROPOSAL_SHARE_TOKEN_PREFIX.length;
}

/** What a withdrawn, replaced or invented link shows — and nothing of the proposal. */
export const PROPOSAL_SHARE_REFUSAL = "This link is not valid. It may have been withdrawn, or replaced by a newer one.";

/** The buyer's page's address for a raw token. */
export function proposalSharePath(token: string): string {
  return `/p/${token}`;
}

/** The public route's address for one photo on the page a token opens, as a thumbnail or full size. */
export function proposalSharePhotoPath(token: string, photoId: string, variant: "thumb" | "full"): string {
  return `/api/p/${token}/photos/${photoId}/${variant}`;
}

/** Each photo's address on the document, by photo id — resolved by the page, which knows the route,
 *  and handed to the client document as data. */
export function proposalDocumentPhotoSrcs(
  document: { lots: readonly { photoIds: readonly string[] }[] },
  address: (photoId: string) => string
): Record<string, string> {
  return Object.fromEntries(document.lots.flatMap((lot) => lot.photoIds.map((id) => [id, address(id)])));
}

/**
 * What the document shows: `shown` — the proposal, while it is open; `closed` — only that the offer is
 * closed, once it is sold or declined, or gone.
 */
export type ProposalDocumentStanding = "shown" | "closed";

export function proposalDocumentStanding(status: ProposalStatus | null): ProposalDocumentStanding {
  return status !== null && isProposalOpen(status) ? "shown" : "closed";
}

/** How one lot is marked on the document: `sold`; `unavailable` — withdrawn while the proposal is
 *  open, a copy sold elsewhere for one; null — still on offer. */
export type ProposalDocumentMark = "sold" | "unavailable" | null;

export function proposalDocumentMark(state: string): ProposalDocumentMark {
  if (state === "sold") return "sold";
  if (state === "withdrawn") return "unavailable";
  return null;
}

/** A lot's photo as the archive and its own download name it: `lot-02-<offer>-01.jpg`, so the photos
 *  sort in lot order and each says which lot it is — the numbers the document and the message use. */
export function proposalLotPhotoFileName(lotNo: number, fileName: string): string {
  return `lot-${String(lotNo).padStart(2, "0")}-${fileName}`;
}

/** The name of a proposal's photo archive. */
export function proposalPhotoArchiveName(proposalNo: number): string {
  return `proposal-${proposalNo}-photos.zip`;
}

// ── The document's own words ────────────────────────────────────────────────────────────────────
//
// In the proposal's language — the Direct platform's listing language, else the collection's — in the
// languages a post's preview has its words in (#2212); English otherwise. The lots' titles are their
// own and are not touched.

export interface ProposalDocumentLabels {
  /** The document's heading, before the proposal's number: *Offer #4*. */
  offer: string;
  /** Before a lot's number: *Lot 3*. */
  lot: string;
  price: string;
  total: string;
  sold: string;
  /** A lot withdrawn while the proposal is open. */
  unavailable: string;
  /** Said in place of the proposal once it is sold, declined or gone. */
  closed: string;
}

const EN: ProposalDocumentLabels = {
  offer: "Offer",
  lot: "Lot",
  price: "Price",
  total: "Total",
  sold: "Sold",
  unavailable: "No longer available",
  closed: "This offer is closed.",
};

const LABELS: Record<string, ProposalDocumentLabels> = {
  en: EN,
  cs: {
    offer: "Nabídka",
    lot: "Položka",
    price: "Cena",
    total: "Celkem",
    sold: "Prodáno",
    unavailable: "Již není k dispozici",
    closed: "Tato nabídka je uzavřena.",
  },
  da: {
    offer: "Tilbud",
    lot: "Lot",
    price: "Pris",
    total: "I alt",
    sold: "Solgt",
    unavailable: "Ikke længere tilgængelig",
    closed: "Dette tilbud er afsluttet.",
  },
  de: {
    offer: "Angebot",
    lot: "Los",
    price: "Preis",
    total: "Gesamt",
    sold: "Verkauft",
    unavailable: "Nicht mehr verfügbar",
    closed: "Dieses Angebot ist abgeschlossen.",
  },
  es: {
    offer: "Oferta",
    lot: "Lote",
    price: "Precio",
    total: "Total",
    sold: "Vendido",
    unavailable: "Ya no está disponible",
    closed: "Esta oferta está cerrada.",
  },
  fi: {
    offer: "Tarjous",
    lot: "Kohde",
    price: "Hinta",
    total: "Yhteensä",
    sold: "Myyty",
    unavailable: "Ei enää saatavilla",
    closed: "Tämä tarjous on päättynyt.",
  },
  fr: {
    offer: "Offre",
    lot: "Lot",
    price: "Prix",
    total: "Total",
    sold: "Vendu",
    unavailable: "Plus disponible",
    closed: "Cette offre est close.",
  },
  hu: {
    offer: "Ajánlat",
    lot: "Tétel",
    price: "Ár",
    total: "Összesen",
    sold: "Eladva",
    unavailable: "Már nem elérhető",
    closed: "Ez az ajánlat lezárult.",
  },
  it: {
    offer: "Offerta",
    lot: "Lotto",
    price: "Prezzo",
    total: "Totale",
    sold: "Venduto",
    unavailable: "Non più disponibile",
    closed: "Questa offerta è chiusa.",
  },
  nl: {
    offer: "Aanbod",
    lot: "Kavel",
    price: "Prijs",
    total: "Totaal",
    sold: "Verkocht",
    unavailable: "Niet meer beschikbaar",
    closed: "Dit aanbod is gesloten.",
  },
  no: {
    offer: "Tilbud",
    lot: "Objekt",
    price: "Pris",
    total: "Totalt",
    sold: "Solgt",
    unavailable: "Ikke lenger tilgjengelig",
    closed: "Dette tilbudet er avsluttet.",
  },
  pl: {
    offer: "Oferta",
    lot: "Pozycja",
    price: "Cena",
    total: "Razem",
    sold: "Sprzedane",
    unavailable: "Już niedostępne",
    closed: "Ta oferta jest zamknięta.",
  },
  pt: {
    offer: "Oferta",
    lot: "Lote",
    price: "Preço",
    total: "Total",
    sold: "Vendido",
    unavailable: "Já não está disponível",
    closed: "Esta oferta está encerrada.",
  },
  ro: {
    offer: "Ofertă",
    lot: "Lot",
    price: "Preț",
    total: "Total",
    sold: "Vândut",
    unavailable: "Nu mai este disponibil",
    closed: "Această ofertă este închisă.",
  },
  ru: {
    offer: "Предложение",
    lot: "Лот",
    price: "Цена",
    total: "Итого",
    sold: "Продано",
    unavailable: "Больше не доступно",
    closed: "Это предложение закрыто.",
  },
  sk: {
    offer: "Ponuka",
    lot: "Položka",
    price: "Cena",
    total: "Spolu",
    sold: "Predané",
    unavailable: "Už nie je k dispozícii",
    closed: "Táto ponuka je uzavretá.",
  },
  sv: {
    offer: "Erbjudande",
    lot: "Objekt",
    price: "Pris",
    total: "Totalt",
    sold: "Såld",
    unavailable: "Inte längre tillgänglig",
    closed: "Det här erbjudandet är avslutat.",
  },
  uk: {
    offer: "Пропозиція",
    lot: "Лот",
    price: "Ціна",
    total: "Разом",
    sold: "Продано",
    unavailable: "Більше не доступно",
    closed: "Ця пропозиція закрита.",
  },
};

/** The languages the document has its own words in. */
export const PROPOSAL_DOCUMENT_LABEL_LANGUAGES: readonly string[] = Object.keys(LABELS).sort();

/** Whether the document has its own words in `language` — false sends it to English, which the
 *  collector's dialog states. */
export function hasProposalDocumentLabels(language: string | null): boolean {
  const code = normalizeLanguage(language);
  return !!code && code in LABELS;
}

/** The document's words in `language`, or English where it has none. */
export function proposalDocumentLabels(language: string | null): ProposalDocumentLabels {
  const code = normalizeLanguage(language);
  return (code && LABELS[code]) || EN;
}

/** The language the words actually come out in — `language` itself, or `en` where it has none. */
export function proposalDocumentLabelLanguage(language: string | null): string {
  const code = normalizeLanguage(language);
  return code && code in LABELS ? code : "en";
}
