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

/** What the buyer's ticks come to on their page (#2601): how many lots, and their prices at the lots'
 *  current prices, two decimals. A ticked lot with no price adds nothing to the sum. */
export function proposalPickedTotal(lots: readonly { amount: string | null }[]): { count: number; total: string } {
  let cents = 0;
  for (const lot of lots) if (lot.amount !== null) cents += Math.round(Number(lot.amount) * 100);
  return { count: lots.length, total: (cents / 100).toFixed(2) };
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
  /** Beside a lot's tick box on the buyer's page (#2601). */
  pick: string;
  /** Under the lots while nothing is ticked. */
  pickHint: string;
  /** Under the lots once something is: *3 lots ticked · 45.00 EUR*. Outside English it reads
   *  *Wybrane: 3 · 45,00 zł* — a count after a colon needs no plural forms. */
  picked: (count: number, total: string) => string;
  /** A tick the server did not take; the box goes back to what it was. */
  pickFailed: string;
}

const EN: ProposalDocumentLabels = {
  offer: "Offer",
  lot: "Lot",
  price: "Price",
  total: "Total",
  sold: "Sold",
  unavailable: "No longer available",
  closed: "This offer is closed.",
  pick: "I want this lot",
  pickHint: "Tick the lots you want.",
  picked: (count, total) => `${count} ${count === 1 ? "lot" : "lots"} ticked · ${total}`,
  pickFailed: "Not saved — please try again.",
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
    pick: "Chci tuto položku",
    pickHint: "Zaškrtněte položky, které chcete.",
    picked: (count, total) => `Vybráno: ${count} · ${total}`,
    pickFailed: "Neuloženo — zkuste to prosím znovu.",
  },
  da: {
    offer: "Tilbud",
    lot: "Lot",
    price: "Pris",
    total: "I alt",
    sold: "Solgt",
    unavailable: "Ikke længere tilgængelig",
    closed: "Dette tilbud er afsluttet.",
    pick: "Jeg vil gerne have dette lot",
    pickHint: "Sæt kryds ved de lots, du ønsker.",
    picked: (count, total) => `Valgt: ${count} · ${total}`,
    pickFailed: "Ikke gemt — prøv venligst igen.",
  },
  de: {
    offer: "Angebot",
    lot: "Los",
    price: "Preis",
    total: "Gesamt",
    sold: "Verkauft",
    unavailable: "Nicht mehr verfügbar",
    closed: "Dieses Angebot ist abgeschlossen.",
    pick: "Dieses Los möchte ich",
    pickHint: "Kreuzen Sie die Lose an, die Sie möchten.",
    picked: (count, total) => `Ausgewählt: ${count} · ${total}`,
    pickFailed: "Nicht gespeichert — bitte erneut versuchen.",
  },
  es: {
    offer: "Oferta",
    lot: "Lote",
    price: "Precio",
    total: "Total",
    sold: "Vendido",
    unavailable: "Ya no está disponible",
    closed: "Esta oferta está cerrada.",
    pick: "Quiero este lote",
    pickHint: "Marque los lotes que desea.",
    picked: (count, total) => `Seleccionados: ${count} · ${total}`,
    pickFailed: "No se ha guardado — inténtelo de nuevo.",
  },
  fi: {
    offer: "Tarjous",
    lot: "Kohde",
    price: "Hinta",
    total: "Yhteensä",
    sold: "Myyty",
    unavailable: "Ei enää saatavilla",
    closed: "Tämä tarjous on päättynyt.",
    pick: "Haluan tämän kohteen",
    pickHint: "Valitse haluamasi kohteet.",
    picked: (count, total) => `Valittu: ${count} · ${total}`,
    pickFailed: "Ei tallennettu — yritä uudelleen.",
  },
  fr: {
    offer: "Offre",
    lot: "Lot",
    price: "Prix",
    total: "Total",
    sold: "Vendu",
    unavailable: "Plus disponible",
    closed: "Cette offre est close.",
    pick: "Je veux ce lot",
    pickHint: "Cochez les lots que vous souhaitez.",
    picked: (count, total) => `Sélectionnés: ${count} · ${total}`,
    pickFailed: "Non enregistré — veuillez réessayer.",
  },
  hu: {
    offer: "Ajánlat",
    lot: "Tétel",
    price: "Ár",
    total: "Összesen",
    sold: "Eladva",
    unavailable: "Már nem elérhető",
    closed: "Ez az ajánlat lezárult.",
    pick: "Ezt a tételt kérem",
    pickHint: "Jelölje be a kívánt tételeket.",
    picked: (count, total) => `Kiválasztva: ${count} · ${total}`,
    pickFailed: "Nem sikerült menteni — próbálja újra.",
  },
  it: {
    offer: "Offerta",
    lot: "Lotto",
    price: "Prezzo",
    total: "Totale",
    sold: "Venduto",
    unavailable: "Non più disponibile",
    closed: "Questa offerta è chiusa.",
    pick: "Voglio questo lotto",
    pickHint: "Seleziona i lotti che desideri.",
    picked: (count, total) => `Selezionati: ${count} · ${total}`,
    pickFailed: "Non salvato — riprova.",
  },
  nl: {
    offer: "Aanbod",
    lot: "Kavel",
    price: "Prijs",
    total: "Totaal",
    sold: "Verkocht",
    unavailable: "Niet meer beschikbaar",
    closed: "Dit aanbod is gesloten.",
    pick: "Ik wil deze kavel",
    pickHint: "Vink de kavels aan die u wilt.",
    picked: (count, total) => `Geselecteerd: ${count} · ${total}`,
    pickFailed: "Niet opgeslagen — probeer het opnieuw.",
  },
  no: {
    offer: "Tilbud",
    lot: "Objekt",
    price: "Pris",
    total: "Totalt",
    sold: "Solgt",
    unavailable: "Ikke lenger tilgjengelig",
    closed: "Dette tilbudet er avsluttet.",
    pick: "Jeg vil ha dette objektet",
    pickHint: "Kryss av objektene du ønsker.",
    picked: (count, total) => `Valgt: ${count} · ${total}`,
    pickFailed: "Ikke lagret — prøv igjen.",
  },
  pl: {
    offer: "Oferta",
    lot: "Pozycja",
    price: "Cena",
    total: "Razem",
    sold: "Sprzedane",
    unavailable: "Już niedostępne",
    closed: "Ta oferta jest zamknięta.",
    pick: "Chcę tę pozycję",
    pickHint: "Zaznacz pozycje, które chcesz.",
    picked: (count, total) => `Wybrane: ${count} · ${total}`,
    pickFailed: "Nie zapisano — spróbuj ponownie.",
  },
  pt: {
    offer: "Oferta",
    lot: "Lote",
    price: "Preço",
    total: "Total",
    sold: "Vendido",
    unavailable: "Já não está disponível",
    closed: "Esta oferta está encerrada.",
    pick: "Quero este lote",
    pickHint: "Assinale os lotes que deseja.",
    picked: (count, total) => `Selecionados: ${count} · ${total}`,
    pickFailed: "Não guardado — tente novamente.",
  },
  ro: {
    offer: "Ofertă",
    lot: "Lot",
    price: "Preț",
    total: "Total",
    sold: "Vândut",
    unavailable: "Nu mai este disponibil",
    closed: "Această ofertă este închisă.",
    pick: "Vreau acest lot",
    pickHint: "Bifați loturile dorite.",
    picked: (count, total) => `Selectate: ${count} · ${total}`,
    pickFailed: "Nu s-a salvat — încercați din nou.",
  },
  ru: {
    offer: "Предложение",
    lot: "Лот",
    price: "Цена",
    total: "Итого",
    sold: "Продано",
    unavailable: "Больше не доступно",
    closed: "Это предложение закрыто.",
    pick: "Хочу этот лот",
    pickHint: "Отметьте лоты, которые хотите.",
    picked: (count, total) => `Выбрано: ${count} · ${total}`,
    pickFailed: "Не сохранено — попробуйте ещё раз.",
  },
  sk: {
    offer: "Ponuka",
    lot: "Položka",
    price: "Cena",
    total: "Spolu",
    sold: "Predané",
    unavailable: "Už nie je k dispozícii",
    closed: "Táto ponuka je uzavretá.",
    pick: "Chcem túto položku",
    pickHint: "Označte položky, ktoré chcete.",
    picked: (count, total) => `Vybraté: ${count} · ${total}`,
    pickFailed: "Neuložené — skúste to znova.",
  },
  sv: {
    offer: "Erbjudande",
    lot: "Objekt",
    price: "Pris",
    total: "Totalt",
    sold: "Såld",
    unavailable: "Inte längre tillgänglig",
    closed: "Det här erbjudandet är avslutat.",
    pick: "Jag vill ha det här objektet",
    pickHint: "Kryssa i de objekt du vill ha.",
    picked: (count, total) => `Valda: ${count} · ${total}`,
    pickFailed: "Inte sparat — försök igen.",
  },
  uk: {
    offer: "Пропозиція",
    lot: "Лот",
    price: "Ціна",
    total: "Разом",
    sold: "Продано",
    unavailable: "Більше не доступно",
    closed: "Ця пропозиція закрита.",
    pick: "Хочу цей лот",
    pickHint: "Позначте лоти, які бажаєте.",
    picked: (count, total) => `Вибрано: ${count} · ${total}`,
    pickFailed: "Не збережено — спробуйте ще раз.",
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
