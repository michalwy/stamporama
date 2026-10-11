import { normalizeLanguage } from "./languages";

// The specification's own words (#1758, #1760), **in the offer's language** — its heading, its
// column headings, and what the buyer's link says when the offer has moved on.
//
// The data on the page was always in the offer's language (`makeTitleCopyMapper`); the words around
// it were English, the app having no UI translations. A specification goes to a buyer, though, and a
// Polish buyer reading Polish stamp names under *Condition* and *Certificate* is reading a page that
// was only half translated — so these few words are translated here, for every language the
// platform picker offers (`COMMON_LANGUAGES`). A code typed by hand outside that list gets English,
// and the collector's share dialog says so rather than leaving them to find out from a buyer.
//
// What is **not** here: the collector's own controls on the printable page (*Print*, *← Offer*),
// which stay English like the rest of the app, and the link's refusals that come before an offer is
// known (an invalid token, the rate limit) — with no offer there is no offer language to speak.

/** Plural forms keyed by `Intl.PluralRules` category; `other` is always present. */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export interface SpecificationLabels {
  /** The page's own name — the heading word and the tab title. */
  specification: string;
  photo: string;
  catalog: string;
  area: string;
  series: string;
  year: string;
  stamp: string;
  condition: string;
  certificate: string;
  /** "copy" / "copies" after a count, by plural category. */
  copies: PluralForms;
  /** Said in place of the table when the offer holds no copies. */
  empty: string;
  /** Said by the buyer's link in place of the specification once the offer has changed or closed. */
  changed: string;
}

const EN: SpecificationLabels = {
  specification: "Specification",
  photo: "Photo",
  catalog: "Catalog",
  area: "Area",
  series: "Series",
  year: "Year",
  stamp: "Stamp",
  condition: "Condition",
  certificate: "Certificate",
  copies: { one: "copy", other: "copies" },
  empty: "This offer contains no copies.",
  changed:
    "This offer has changed or is no longer available. Please contact the seller for a current specification.",
};

const LABELS: Record<string, SpecificationLabels> = {
  en: EN,
  cs: {
    specification: "Specifikace",
    photo: "Foto",
    catalog: "Katalog",
    area: "Území",
    series: "Série",
    year: "Rok",
    stamp: "Známka",
    condition: "Stav",
    certificate: "Atest",
    copies: { one: "kus", few: "kusy", many: "kusu", other: "kusů" },
    empty: "Tato nabídka neobsahuje žádné kusy.",
    changed:
      "Tato nabídka se změnila nebo již není k dispozici. Pro aktuální specifikaci kontaktujte prodávajícího.",
  },
  da: {
    specification: "Specifikation",
    photo: "Foto",
    catalog: "Katalog",
    area: "Område",
    series: "Serie",
    year: "År",
    stamp: "Frimærke",
    condition: "Stand",
    certificate: "Attest",
    copies: { one: "eksemplar", other: "eksemplarer" },
    empty: "Dette tilbud indeholder ingen eksemplarer.",
    changed:
      "Dette tilbud er ændret eller er ikke længere tilgængeligt. Kontakt sælgeren for at få en opdateret specifikation.",
  },
  de: {
    specification: "Spezifikation",
    photo: "Foto",
    catalog: "Katalog",
    area: "Gebiet",
    series: "Serie",
    year: "Jahr",
    stamp: "Marke",
    condition: "Erhaltung",
    certificate: "Attest",
    copies: { one: "Exemplar", other: "Exemplare" },
    empty: "Dieses Angebot enthält keine Exemplare.",
    changed:
      "Dieses Angebot hat sich geändert oder ist nicht mehr verfügbar. Bitte wenden Sie sich für eine aktuelle Spezifikation an den Verkäufer.",
  },
  es: {
    specification: "Especificación",
    photo: "Foto",
    catalog: "Catálogo",
    area: "Territorio",
    series: "Serie",
    year: "Año",
    stamp: "Sello",
    condition: "Estado",
    certificate: "Certificado",
    copies: { one: "ejemplar", other: "ejemplares" },
    empty: "Esta oferta no contiene ningún ejemplar.",
    changed:
      "Esta oferta ha cambiado o ya no está disponible. Póngase en contacto con el vendedor para obtener una especificación actualizada.",
  },
  fi: {
    specification: "Erittely",
    photo: "Kuva",
    catalog: "Luettelo",
    area: "Alue",
    series: "Sarja",
    year: "Vuosi",
    stamp: "Merkki",
    condition: "Kunto",
    certificate: "Sertifikaatti",
    copies: { one: "kappale", other: "kappaletta" },
    empty: "Tässä tarjouksessa ei ole yhtään kappaletta.",
    changed: "Tämä tarjous on muuttunut tai se ei ole enää saatavilla. Pyydä myyjältä ajantasainen erittely.",
  },
  fr: {
    specification: "Spécification",
    photo: "Photo",
    catalog: "Catalogue",
    area: "Territoire",
    series: "Série",
    year: "Année",
    stamp: "Timbre",
    condition: "État",
    certificate: "Certificat",
    copies: { one: "exemplaire", many: "d’exemplaires", other: "exemplaires" },
    empty: "Cette offre ne contient aucun exemplaire.",
    changed:
      "Cette offre a changé ou n’est plus disponible. Veuillez contacter le vendeur pour obtenir une spécification à jour.",
  },
  hu: {
    specification: "Specifikáció",
    photo: "Fotó",
    catalog: "Katalógus",
    area: "Terület",
    series: "Sorozat",
    year: "Év",
    stamp: "Bélyeg",
    condition: "Állapot",
    certificate: "Tanúsítvány",
    // Hungarian keeps the noun singular after a number.
    copies: { other: "példány" },
    empty: "Ez az ajánlat nem tartalmaz példányt.",
    changed: "Ez az ajánlat megváltozott, vagy már nem elérhető. Az aktuális specifikációért forduljon az eladóhoz.",
  },
  it: {
    specification: "Specifica",
    photo: "Foto",
    catalog: "Catalogo",
    area: "Territorio",
    series: "Serie",
    year: "Anno",
    stamp: "Francobollo",
    condition: "Stato",
    certificate: "Certificato",
    copies: { one: "esemplare", many: "di esemplari", other: "esemplari" },
    empty: "Questa offerta non contiene esemplari.",
    changed:
      "Questa offerta è cambiata o non è più disponibile. Contatta il venditore per ricevere una specifica aggiornata.",
  },
  nl: {
    specification: "Specificatie",
    photo: "Foto",
    catalog: "Catalogus",
    area: "Gebied",
    series: "Serie",
    year: "Jaar",
    stamp: "Zegel",
    condition: "Staat",
    certificate: "Certificaat",
    copies: { one: "exemplaar", other: "exemplaren" },
    empty: "Dit aanbod bevat geen exemplaren.",
    changed:
      "Dit aanbod is gewijzigd of niet meer beschikbaar. Neem contact op met de verkoper voor een actuele specificatie.",
  },
  no: {
    specification: "Spesifikasjon",
    photo: "Foto",
    catalog: "Katalog",
    area: "Område",
    series: "Serie",
    year: "År",
    stamp: "Frimerke",
    condition: "Tilstand",
    certificate: "Attest",
    copies: { one: "eksemplar", other: "eksemplarer" },
    empty: "Dette tilbudet inneholder ingen eksemplarer.",
    changed:
      "Dette tilbudet er endret eller er ikke lenger tilgjengelig. Kontakt selgeren for å få en oppdatert spesifikasjon.",
  },
  pl: {
    specification: "Specyfikacja",
    photo: "Zdjęcie",
    catalog: "Katalog",
    area: "Obszar",
    series: "Seria",
    year: "Rok",
    stamp: "Znaczek",
    condition: "Stan",
    certificate: "Atest",
    copies: { one: "egzemplarz", few: "egzemplarze", many: "egzemplarzy", other: "egzemplarza" },
    empty: "Ta oferta nie zawiera żadnych egzemplarzy.",
    changed:
      "Ta oferta zmieniła się lub nie jest już dostępna. Skontaktuj się ze sprzedającym, aby otrzymać aktualną specyfikację.",
  },
  pt: {
    specification: "Especificação",
    photo: "Foto",
    catalog: "Catálogo",
    area: "Território",
    series: "Série",
    year: "Ano",
    stamp: "Selo",
    condition: "Estado",
    certificate: "Certificado",
    copies: { one: "exemplar", many: "de exemplares", other: "exemplares" },
    empty: "Esta oferta não contém exemplares.",
    changed:
      "Esta oferta foi alterada ou já não está disponível. Contacte o vendedor para obter uma especificação atualizada.",
  },
  ro: {
    specification: "Specificație",
    photo: "Fotografie",
    catalog: "Catalog",
    area: "Teritoriu",
    series: "Serie",
    year: "An",
    stamp: "Timbru",
    condition: "Stare",
    certificate: "Certificat",
    copies: { one: "exemplar", few: "exemplare", other: "de exemplare" },
    empty: "Această ofertă nu conține niciun exemplar.",
    changed:
      "Această ofertă s-a modificat sau nu mai este disponibilă. Contactați vânzătorul pentru o specificație actualizată.",
  },
  ru: {
    specification: "Спецификация",
    photo: "Фото",
    catalog: "Каталог",
    area: "Территория",
    series: "Серия",
    year: "Год",
    stamp: "Марка",
    condition: "Состояние",
    certificate: "Сертификат",
    copies: { one: "экземпляр", few: "экземпляра", many: "экземпляров", other: "экземпляра" },
    empty: "Это предложение не содержит ни одного экземпляра.",
    changed:
      "Это предложение изменилось или больше недоступно. Свяжитесь с продавцом, чтобы получить актуальную спецификацию.",
  },
  sk: {
    specification: "Špecifikácia",
    photo: "Foto",
    catalog: "Katalóg",
    area: "Územie",
    series: "Séria",
    year: "Rok",
    stamp: "Známka",
    condition: "Stav",
    certificate: "Atest",
    copies: { one: "kus", few: "kusy", many: "kusu", other: "kusov" },
    empty: "Táto ponuka neobsahuje žiadne kusy.",
    changed:
      "Táto ponuka sa zmenila alebo už nie je k dispozícii. Pre aktuálnu špecifikáciu kontaktujte predávajúceho.",
  },
  sv: {
    specification: "Specifikation",
    photo: "Foto",
    catalog: "Katalog",
    area: "Område",
    series: "Serie",
    year: "År",
    stamp: "Frimärke",
    condition: "Skick",
    certificate: "Attest",
    copies: { one: "exemplar", other: "exemplar" },
    empty: "Det här erbjudandet innehåller inga exemplar.",
    changed:
      "Det här erbjudandet har ändrats eller är inte längre tillgängligt. Kontakta säljaren för en aktuell specifikation.",
  },
  uk: {
    specification: "Специфікація",
    photo: "Фото",
    catalog: "Каталог",
    area: "Територія",
    series: "Серія",
    year: "Рік",
    stamp: "Марка",
    condition: "Стан",
    certificate: "Сертифікат",
    copies: { one: "примірник", few: "примірники", many: "примірників", other: "примірника" },
    empty: "Ця пропозиція не містить жодного примірника.",
    changed:
      "Ця пропозиція змінилася або більше не доступна. Зверніться до продавця, щоб отримати актуальну специфікацію.",
  },
};

/** The languages the specification has its own words in. */
export const SPECIFICATION_LABEL_LANGUAGES: readonly string[] = Object.keys(LABELS).sort();

/** Whether the specification has its own words in `language` — false sends it to English, which
 *  the collector's dialog states. */
export function hasSpecificationLabels(language: string | null): boolean {
  const code = normalizeLanguage(language);
  return !!code && code in LABELS;
}

/** The specification's words in `language`, or English where it has none. */
export function specificationLabels(language: string | null): SpecificationLabels {
  const code = normalizeLanguage(language);
  return (code && LABELS[code]) || EN;
}

/** The language the labels actually come out in — `language` itself, or `en` where it has none. */
export function specificationLabelLanguage(language: string | null): string {
  const code = normalizeLanguage(language);
  return code && code in LABELS ? code : "en";
}

/** "3 copies", "3 egzemplarze", "5 egzemplarzy" — the count with its noun in the right plural form. */
export function specificationCopyCount(language: string | null, count: number): string {
  const labels = specificationLabels(language);
  const category = new Intl.PluralRules(specificationLabelLanguage(language)).select(count);
  return `${count} ${labels.copies[category] ?? labels.copies.other}`;
}
