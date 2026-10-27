import { normalizeLanguage } from "./languages";
import { facebookPostLink, facebookPostStage, isFacebookLotPosted } from "./facebook-post-rules";

// **A Facebook post's preview for a buyer** (#2212) — the pure half, with no database and no
// `server-only`: what the page shows at each stage of the post, which lots it marks, the link's shape
// and addresses, and the page's own words in the post's language.
//
// The link is the specification link's (#1760) one table over, with one difference that runs through
// everything here: **it stays live.** A specification link promises one version of the offer; this
// one shows the post as it is now — the link to it in the group once the group has approved it, the
// lots that sold marked *Sold* — so there is nothing to hash and compare.

/** Every raw token starts with this — beside `stmpa_` (the Assistant), `stmpx_` (a trade), `stmps_`
 *  (a sale) and `stmpo_` (a specification), so credentials authorising different things are told
 *  apart before anything is hashed. */
export const FACEBOOK_POST_PREVIEW_TOKEN_PREFIX = "stmpf_";

/** Cheap shape check, run before any lookup. */
export function isFacebookPostPreviewTokenShape(raw: string): boolean {
  return raw.startsWith(FACEBOOK_POST_PREVIEW_TOKEN_PREFIX) && raw.length > FACEBOOK_POST_PREVIEW_TOKEN_PREFIX.length;
}

/** What a withdrawn, replaced or invented link shows — and nothing of the post. */
export const FACEBOOK_POST_PREVIEW_REFUSAL =
  "This link is not valid. It may have been withdrawn, or replaced by a newer one.";

/** The public page's address for a raw token. */
export function facebookPostPreviewPath(token: string): string {
  return `/fb/${token}`;
}

/** The public route's address for one photo on the page a token opens, as a thumbnail or full size. */
export function facebookPostPreviewPhotoPath(token: string, photoId: string, variant: "thumb" | "full"): string {
  return `/api/fb/${token}/photos/${photoId}/${variant}`;
}

/** Each photo's address on the preview, by photo id — resolved by the page, which knows the route,
 *  and handed to the client document as data. */
export function facebookPostPreviewPhotoSrcs(
  preview: { lots: readonly { photoIds: readonly string[] }[] },
  address: (photoId: string) => string
): Record<string, string> {
  return Object.fromEntries(preview.lots.flatMap((lot) => lot.photoIds.map((id) => [id, address(id)])));
}

/**
 * What the preview shows of a post, by its lots' states:
 *
 * - `shown` — the post: Ready, waiting for the group's approval, up, or over with something sold.
 * - `updating` — taken back to being prepared; the buyer is asked for a current preview, and the post
 *   is shown again once it is Ready.
 * - `gone` — no longer current: the post was withdrawn (over with nothing sold) or deleted.
 */
export type FacebookPostPreviewStanding = "shown" | "updating" | "gone";

export function facebookPostPreviewStanding(lots: readonly { state: string }[] | null): FacebookPostPreviewStanding {
  if (!lots || lots.length === 0) return "gone";
  const stage = facebookPostStage(lots);
  if (stage === "preparing") return "updating";
  if (stage === "over" && !lots.some((l) => l.state === "sold")) return "gone";
  return "shown";
}

/** Whether a post's preview can be handed out: once it is Ready, and while it waits or is up. */
export function canPreviewFacebookPost(lots: readonly { state: string }[]): boolean {
  const stage = facebookPostStage(lots);
  return stage === "ready" || stage === "pending" || stage === "up";
}

/** How one lot is marked on the preview: `sold` — sold, an auction won included, with no buyer named;
 *  `unavailable` — withdrawn from a post still shown; null — still on offer. */
export type FacebookPostPreviewMark = "sold" | "unavailable" | null;

export function facebookPostPreviewMark(state: string): FacebookPostPreviewMark {
  if (state === "sold") return "sold";
  if (state === "withdrawn") return "unavailable";
  return null;
}

/** The post's link in the group, **once the group has approved it**: a pending post's link opens only
 *  for its author, so it is never handed to a buyer. Read off the lots that went up, as the post's
 *  screen reads it. */
export function facebookPostPreviewLink(lots: readonly { state: string; url: string | null }[]): string | null {
  return facebookPostLink(lots.filter((l) => isFacebookLotPosted(l.state) && l.state !== "pending"));
}

// ── The page's own words ────────────────────────────────────────────────────────────────────────
//
// In the post's language, in the languages a specification has its words in (#1760); English
// otherwise. The post's text is the post's own and is not touched.

export interface FacebookPostPreviewLabels {
  /** The page's name — the tab title where the post has no title. */
  preview: string;
  /** Before a lot's number: *Lot 3*. */
  lot: string;
  /** A quick buy's price. */
  price: string;
  startingPrice: string;
  /** Before an auction's closing time. */
  closes: string;
  sold: string;
  /** A lot withdrawn from a post still shown. */
  unavailable: string;
  /** The link to the post in the group. */
  viewPost: string;
  /** Said in place of the post while it is being prepared again. */
  updating: string;
  /** Said in place of the post once it is withdrawn or deleted. */
  gone: string;
}

const EN: FacebookPostPreviewLabels = {
  preview: "Preview",
  lot: "Lot",
  price: "Price",
  startingPrice: "Starting price",
  closes: "Closes",
  sold: "Sold",
  unavailable: "No longer available",
  viewPost: "See the post in the group",
  updating: "This post is being updated. Please ask the seller for a current preview.",
  gone: "This offer is no longer current.",
};

const LABELS: Record<string, FacebookPostPreviewLabels> = {
  en: EN,
  cs: {
    preview: "Náhled",
    lot: "Položka",
    price: "Cena",
    startingPrice: "Vyvolávací cena",
    closes: "Končí",
    sold: "Prodáno",
    unavailable: "Již není k dispozici",
    viewPost: "Zobrazit příspěvek ve skupině",
    updating: "Tento příspěvek se právě upravuje. Požádejte prodejce o aktuální náhled.",
    gone: "Tato nabídka již není aktuální.",
  },
  da: {
    preview: "Forhåndsvisning",
    lot: "Lot",
    price: "Pris",
    startingPrice: "Startpris",
    closes: "Slutter",
    sold: "Solgt",
    unavailable: "Ikke længere tilgængelig",
    viewPost: "Se opslaget i gruppen",
    updating: "Dette opslag bliver opdateret. Bed sælgeren om en aktuel forhåndsvisning.",
    gone: "Dette tilbud er ikke længere aktuelt.",
  },
  de: {
    preview: "Vorschau",
    lot: "Los",
    price: "Preis",
    startingPrice: "Startpreis",
    closes: "Endet",
    sold: "Verkauft",
    unavailable: "Nicht mehr verfügbar",
    viewPost: "Beitrag in der Gruppe ansehen",
    updating: "Dieser Beitrag wird gerade überarbeitet. Bitte fragen Sie den Verkäufer nach einer aktuellen Vorschau.",
    gone: "Dieses Angebot ist nicht mehr aktuell.",
  },
  es: {
    preview: "Vista previa",
    lot: "Lote",
    price: "Precio",
    startingPrice: "Precio de salida",
    closes: "Cierra",
    sold: "Vendido",
    unavailable: "Ya no está disponible",
    viewPost: "Ver la publicación en el grupo",
    updating: "Esta publicación se está actualizando. Pida al vendedor una vista previa actual.",
    gone: "Esta oferta ya no está vigente.",
  },
  fi: {
    preview: "Esikatselu",
    lot: "Kohde",
    price: "Hinta",
    startingPrice: "Lähtöhinta",
    closes: "Päättyy",
    sold: "Myyty",
    unavailable: "Ei enää saatavilla",
    viewPost: "Katso julkaisu ryhmässä",
    updating: "Tätä julkaisua päivitetään. Pyydä myyjältä ajantasainen esikatselu.",
    gone: "Tämä tarjous ei ole enää voimassa.",
  },
  fr: {
    preview: "Aperçu",
    lot: "Lot",
    price: "Prix",
    startingPrice: "Prix de départ",
    closes: "Clôture",
    sold: "Vendu",
    unavailable: "Plus disponible",
    viewPost: "Voir la publication dans le groupe",
    updating: "Cette publication est en cours de mise à jour. Demandez au vendeur un aperçu à jour.",
    gone: "Cette offre n'est plus d'actualité.",
  },
  hu: {
    preview: "Előnézet",
    lot: "Tétel",
    price: "Ár",
    startingPrice: "Kikiáltási ár",
    closes: "Zárás",
    sold: "Eladva",
    unavailable: "Már nem elérhető",
    viewPost: "A bejegyzés megtekintése a csoportban",
    updating: "Ez a bejegyzés éppen frissül. Kérjen az eladótól aktuális előnézetet.",
    gone: "Ez az ajánlat már nem érvényes.",
  },
  it: {
    preview: "Anteprima",
    lot: "Lotto",
    price: "Prezzo",
    startingPrice: "Prezzo di partenza",
    closes: "Chiude",
    sold: "Venduto",
    unavailable: "Non più disponibile",
    viewPost: "Vedi il post nel gruppo",
    updating: "Questo post è in fase di aggiornamento. Chiedi al venditore un'anteprima aggiornata.",
    gone: "Questa offerta non è più attuale.",
  },
  nl: {
    preview: "Voorbeeld",
    lot: "Kavel",
    price: "Prijs",
    startingPrice: "Startprijs",
    closes: "Sluit",
    sold: "Verkocht",
    unavailable: "Niet meer beschikbaar",
    viewPost: "Bekijk het bericht in de groep",
    updating: "Dit bericht wordt bijgewerkt. Vraag de verkoper om een actueel voorbeeld.",
    gone: "Dit aanbod is niet meer actueel.",
  },
  no: {
    preview: "Forhåndsvisning",
    lot: "Objekt",
    price: "Pris",
    startingPrice: "Startpris",
    closes: "Avsluttes",
    sold: "Solgt",
    unavailable: "Ikke lenger tilgjengelig",
    viewPost: "Se innlegget i gruppen",
    updating: "Dette innlegget blir oppdatert. Be selgeren om en oppdatert forhåndsvisning.",
    gone: "Dette tilbudet er ikke lenger aktuelt.",
  },
  pl: {
    preview: "Podgląd",
    lot: "Pozycja",
    price: "Cena",
    startingPrice: "Cena wywoławcza",
    closes: "Koniec",
    sold: "Sprzedane",
    unavailable: "Już niedostępne",
    viewPost: "Zobacz post w grupie",
    updating: "Ten post jest właśnie aktualizowany. Poproś sprzedającego o aktualny podgląd.",
    gone: "Ta oferta jest już nieaktualna.",
  },
  pt: {
    preview: "Pré-visualização",
    lot: "Lote",
    price: "Preço",
    startingPrice: "Preço inicial",
    closes: "Termina",
    sold: "Vendido",
    unavailable: "Já não está disponível",
    viewPost: "Ver a publicação no grupo",
    updating: "Esta publicação está a ser atualizada. Peça ao vendedor uma pré-visualização atual.",
    gone: "Esta oferta já não está em vigor.",
  },
  ro: {
    preview: "Previzualizare",
    lot: "Lot",
    price: "Preț",
    startingPrice: "Preț de pornire",
    closes: "Se încheie",
    sold: "Vândut",
    unavailable: "Nu mai este disponibil",
    viewPost: "Vezi postarea în grup",
    updating: "Această postare este în curs de actualizare. Cereți vânzătorului o previzualizare actuală.",
    gone: "Această ofertă nu mai este de actualitate.",
  },
  ru: {
    preview: "Предпросмотр",
    lot: "Лот",
    price: "Цена",
    startingPrice: "Стартовая цена",
    closes: "Окончание",
    sold: "Продано",
    unavailable: "Больше не доступно",
    viewPost: "Посмотреть пост в группе",
    updating: "Этот пост сейчас обновляется. Попросите у продавца актуальный предпросмотр.",
    gone: "Это предложение больше не актуально.",
  },
  sk: {
    preview: "Náhľad",
    lot: "Položka",
    price: "Cena",
    startingPrice: "Vyvolávacia cena",
    closes: "Končí",
    sold: "Predané",
    unavailable: "Už nie je k dispozícii",
    viewPost: "Zobraziť príspevok v skupine",
    updating: "Tento príspevok sa práve upravuje. Požiadajte predajcu o aktuálny náhľad.",
    gone: "Táto ponuka už nie je aktuálna.",
  },
  sv: {
    preview: "Förhandsvisning",
    lot: "Objekt",
    price: "Pris",
    startingPrice: "Utropspris",
    closes: "Avslutas",
    sold: "Såld",
    unavailable: "Inte längre tillgänglig",
    viewPost: "Se inlägget i gruppen",
    updating: "Det här inlägget håller på att uppdateras. Be säljaren om en aktuell förhandsvisning.",
    gone: "Det här erbjudandet är inte längre aktuellt.",
  },
  uk: {
    preview: "Попередній перегляд",
    lot: "Лот",
    price: "Ціна",
    startingPrice: "Стартова ціна",
    closes: "Завершення",
    sold: "Продано",
    unavailable: "Більше не доступно",
    viewPost: "Переглянути допис у групі",
    updating: "Цей допис зараз оновлюється. Попросіть у продавця актуальний попередній перегляд.",
    gone: "Ця пропозиція більше не актуальна.",
  },
};

/** The languages the preview has its own words in. */
export const FACEBOOK_POST_PREVIEW_LABEL_LANGUAGES: readonly string[] = Object.keys(LABELS).sort();

/** Whether the preview has its own words in `language` — false sends it to English, which the
 *  collector's dialog states. */
export function hasFacebookPostPreviewLabels(language: string | null): boolean {
  const code = normalizeLanguage(language);
  return !!code && code in LABELS;
}

/** The preview's words in `language`, or English where it has none. */
export function facebookPostPreviewLabels(language: string | null): FacebookPostPreviewLabels {
  const code = normalizeLanguage(language);
  return (code && LABELS[code]) || EN;
}

/** The language the words actually come out in — `language` itself, or `en` where it has none. */
export function facebookPostPreviewLabelLanguage(language: string | null): string {
  const code = normalizeLanguage(language);
  return code && code in LABELS ? code : "en";
}
