import { normalizeLanguage } from "./languages";
import type { TradeSide, TradeStatus } from "./trade-rules";
import type { TradeGroupLevel } from "./trade-grouping";

// **The partner's page in the partner's language** (#2606; ADR-0039 §9): the trade's shared page's
// own words — its heading, its notes, the controls the partner answers with — in every language the
// offer specification has its words in (`COMMON_LANGUAGES`, #1760). A language outside them gets
// English, and the collector's share dialog says so.
//
// Pure and free of `server-only`, because the page is half server code and half client: the rows are
// one server render, while the feedback controls and the copy picker are client components that look
// their words up here by the language the page hands them.
//
// The data on the page — stamp, series, area, condition, certificate and format names — is not here:
// it is the collection's own wording, translated where the collection has a translation
// (`trade-share-translation.ts`). What is **not** in the partner's language: what is said before the
// link has been resolved to a trade — the tab's title, the rate limit, a dead link — since there is no
// partner yet whose language it could be, and the refusals the routes answer a write with.

/** Plural forms keyed by `Intl.PluralRules` category; `other` is always present. */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export interface TradeShareLabels {
  /** The heading: *Exchange #12*. */
  exchangeNo: (tradeNo: number) => string;
  status: Record<TradeStatus, string>;
  /** *Anna and Karel* under the heading. */
  parties: (collector: string, partner: string) => string;
  /** A side's heading, by who the material comes from — never *give* and *receive*. */
  from: (name: string) => string;
  /** After a side's heading over its Colnect lists. */
  onColnect: string;
  noFigures: string;
  agreedFigures: (catalogName: string | null, currency: string) => string;
  ownFigures: (collector: string, currency: string) => string;
  frozen: string;
  convertedAt: string;
  groupBy: string;
  groupLevel: Record<TradeGroupLevel, string>;
  noArea: string;
  noYear: string;
  noIssue: string;
  unnamedIssue: string;
  noCondition: string;
  total: string;
  notPriced: string;
  stamps: PluralForms;
  lines: PluralForms;
  notes: PluralForms;
  emptySide: string;
  /** Said under a side cut short: *Only the first 500 lines of this side are shown.* — `lines` is the
   *  count with its noun. */
  truncated: (lines: string) => string;
  /** A row with neither a number nor a name. */
  stamp: string;
  variantNotSpecified: string;
  estimate: string;
  ownFigure: string;
  withdrawn: string;
  neverArrived: string;
  notWanted: string;
  cannotSend: string;
  /** *You left 2 notes and 1 marked not wanted on this side.* — `notes` is the counted notes or null,
   *  `marked` the count of struck lines or null, `mark` the side's word for striking one. */
  sideSummary: (notes: string | null, marked: number | null, mark: string) => string;
  saving: string;
  saved: string;
  saveFailed: string;
  change: string;
  addNote: string;
  lineNoteLabel: string;
  yourComments: string;
  feedbackIntro: (collector: string) => string;
  tradeNotePlaceholder: string;
  tradeNoteLabel: string;
  /** Why the comments are closed on a finished exchange. */
  feedbackFinished: string;
  /** Why they are closed otherwise — `status` is this language's word for it. */
  feedbackClosed: (status: string) => string;
  choicePrompt: (options: number) => string;
  choiceHint: string;
  chosenNow: string;
  youAsked: string;
  copyNo: (n: number) => string;
  noScan: string;
  choicePreparing: string;
  choiceSettled: (status: string) => string;
  unanswered: (status: string) => string;
}

const EN: TradeShareLabels = {
  exchangeNo: (n) => `Exchange #${n}`,
  status: { preparing: "Preparing", shared: "Shared", agreed: "Agreed", closed: "Closed", cancelled: "Cancelled" },
  parties: (a, b) => `${a} and ${b}`,
  from: (name) => `From ${name}`,
  onColnect: "on Colnect",
  noFigures: "This list shows what is on each side. Figures are not included.",
  agreedFigures: (catalog, currency) =>
    `Figures are ${catalog ?? "the agreed catalogue"} prices, in ${currency}. A line read in a different publisher’s catalogue says so beside its figure.`,
  ownFigures: (collector, currency) =>
    `No single catalogue has been agreed for this exchange, so the figures are ${collector}’s own valuation, in ${currency}. Each line says which catalogue and edition it was read in.`,
  frozen: "These are the figures as agreed, not today's.",
  convertedAt: "Converted at",
  groupBy: "Group by",
  groupLevel: { area: "Area", year: "Year", issue: "Issue", condition: "Condition" },
  noArea: "No area",
  noYear: "No year",
  noIssue: "No issue",
  unnamedIssue: "(unnamed issue)",
  noCondition: "No condition",
  total: "Total",
  notPriced: "Not priced",
  stamps: { one: "stamp", other: "stamps" },
  lines: { one: "line", other: "lines" },
  notes: { one: "note", other: "notes" },
  emptySide: "Nothing on this side.",
  truncated: (lines) => `Only the first ${lines} of this side are shown.`,
  stamp: "Stamp",
  variantNotSpecified: "variant not specified",
  estimate: "estimate",
  ownFigure: "own figure",
  withdrawn: "Withdrawn",
  neverArrived: "Never arrived",
  notWanted: "Not wanted",
  cannotSend: "Cannot send",
  sideSummary: (notes, marked, mark) =>
    `You left ${[notes, marked !== null ? `${marked} marked ${mark.toLowerCase()}` : null].filter(Boolean).join(" and ")} on this side.`,
  saving: "Saving…",
  saved: "Saved",
  saveFailed: "That could not be saved.",
  change: "Change",
  addNote: "Add a note",
  lineNoteLabel: "Note about this line",
  yourComments: "Your comments",
  feedbackIntro: (collector) =>
    `Tick a line you do not want, or add a note to it — ${collector} sees everything you leave here, and nothing you write changes the list itself. Use the box below for anything about the exchange as a whole.`,
  tradeNotePlaceholder: "A note about the whole exchange",
  tradeNoteLabel: "Note about the whole exchange",
  feedbackFinished:
    "This exchange is finished, so this list no longer takes comments. Anything already said is shown below.",
  feedbackClosed: (status) => `This exchange is ${status.toLowerCase()} and no longer takes comments.`,
  choicePrompt: (n) =>
    n === 2 ? "Two of these would do — which would you like?" : `${n} of these would do — which would you like?`,
  choiceHint:
    "Nothing is decided by choosing here — it is a request, and your partner confirms it. Picking the copy that is already chosen takes the request back.",
  chosenNow: "Chosen now",
  youAsked: "You asked for this one",
  copyNo: (n) => `Copy ${n}`,
  noScan: "No scan",
  choicePreparing: "This list is still being put together, so which copy travels is not open yet.",
  choiceSettled: (status) => `This exchange is ${status.toLowerCase()}, so which copy travels is settled.`,
  unanswered: (status) => `You asked for a different copy; this exchange was ${status.toLowerCase()} with the one shown.`,
};

/** `A, B` → `A and B` in a language's own conjunction. */
function both(parts: (string | null)[], and: string): string {
  return parts.filter(Boolean).join(` ${and} `);
}

const LABELS: Record<string, TradeShareLabels> = {
  en: EN,
  cs: {
    exchangeNo: (n) => `Výměna č. ${n}`,
    status: { preparing: "Připravuje se", shared: "Sdíleno", agreed: "Dohodnuto", closed: "Uzavřeno", cancelled: "Zrušeno" },
    parties: (a, b) => `${a} a ${b}`,
    from: (name) => `Od: ${name}`,
    onColnect: "na Colnectu",
    noFigures: "Tento seznam ukazuje, co je na každé straně. Hodnoty nejsou uvedeny.",
    agreedFigures: (catalog, currency) =>
      `Hodnoty jsou ceny ${catalog ?? "dohodnutého katalogu"} v ${currency}. Řádek oceněný v katalogu jiného vydavatele to uvádí u své hodnoty.`,
    ownFigures: (collector, currency) =>
      `Pro tuto výměnu nebyl dohodnut žádný katalog, takže hodnoty jsou vlastním oceněním (${collector}) v ${currency}. U každého řádku je uvedeno, ve kterém katalogu a vydání byl oceněn.`,
    frozen: "Jsou to hodnoty z doby dohody, ne dnešní.",
    convertedAt: "Přepočteno kurzem",
    groupBy: "Seskupit podle",
    groupLevel: { area: "Území", year: "Rok", issue: "Série", condition: "Stav" },
    noArea: "Bez území",
    noYear: "Bez roku",
    noIssue: "Bez série",
    unnamedIssue: "(série bez názvu)",
    noCondition: "Bez stavu",
    total: "Celkem",
    notPriced: "Bez ceny",
    stamps: { one: "známka", few: "známky", many: "známky", other: "známek" },
    lines: { one: "řádek", few: "řádky", many: "řádku", other: "řádků" },
    notes: { one: "poznámka", few: "poznámky", many: "poznámky", other: "poznámek" },
    emptySide: "Na této straně nic není.",
    truncated: (lines) => `Zobrazeno je jen prvních ${lines} této strany.`,
    stamp: "Známka",
    variantNotSpecified: "varianta neurčena",
    estimate: "odhad",
    ownFigure: "vlastní hodnota",
    withdrawn: "Staženo",
    neverArrived: "Nedorazilo",
    notWanted: "Nechci",
    cannotSend: "Nemohu poslat",
    sideSummary: (notes, marked, mark) =>
      `Na této straně jste zanechali ${both([notes, marked !== null ? `${marked}× „${mark}“` : null], "a")}.`,
    saving: "Ukládá se…",
    saved: "Uloženo",
    saveFailed: "Nepodařilo se uložit.",
    change: "Změnit",
    addNote: "Přidat poznámku",
    lineNoteLabel: "Poznámka k tomuto řádku",
    yourComments: "Vaše poznámky",
    feedbackIntro: (collector) =>
      `Zaškrtněte řádek, který nechcete, nebo k němu připište poznámku — ${collector} uvidí vše, co zde zanecháte, a nic z toho, co napíšete, samotný seznam nezmění. Pole níže slouží ke všemu, co se týká výměny jako celku.`,
    tradeNotePlaceholder: "Poznámka k celé výměně",
    tradeNoteLabel: "Poznámka k celé výměně",
    feedbackFinished:
      "Tato výměna je dokončena, takže seznam už nepřijímá poznámky. Vše, co již bylo řečeno, je uvedeno níže.",
    feedbackClosed: (status) => `Stav této výměny: ${status}. Poznámky už nepřijímá.`,
    choicePrompt: (n) => `Poslouží kterýkoli z těchto ${n} kusů — který byste chtěli?`,
    choiceHint:
      "Výběrem zde se nic nerozhoduje — je to žádost a váš partner ji potvrdí. Výběrem již zvoleného kusu žádost odvoláte.",
    chosenNow: "Nyní zvoleno",
    youAsked: "O tento jste požádali",
    copyNo: (n) => `Kus ${n}`,
    noScan: "Bez skenu",
    choicePreparing: "Seznam se ještě sestavuje, takže výběr kusu zatím není otevřen.",
    choiceSettled: (status) => `Stav této výměny: ${status}. Který kus se posílá, je již rozhodnuto.`,
    unanswered: (status) => `Požádali jste o jiný kus; stav výměny je nyní „${status}“ s kusem, který je zobrazen.`,
  },
  da: {
    exchangeNo: (n) => `Bytte nr. ${n}`,
    status: { preparing: "Under forberedelse", shared: "Delt", agreed: "Aftalt", closed: "Afsluttet", cancelled: "Annulleret" },
    parties: (a, b) => `${a} og ${b}`,
    from: (name) => `Fra ${name}`,
    onColnect: "på Colnect",
    noFigures: "Denne liste viser, hvad der er på hver side. Værdier er ikke medtaget.",
    agreedFigures: (catalog, currency) =>
      `Værdierne er priser fra ${catalog ?? "det aftalte katalog"}, i ${currency}. En linje vurderet i et andet forlags katalog oplyser det ved sin værdi.`,
    ownFigures: (collector, currency) =>
      `Der er ikke aftalt et fælles katalog for dette bytte, så værdierne er ${collector}s egen vurdering, i ${currency}. Hver linje oplyser, hvilket katalog og hvilken udgave den er vurderet i.`,
    frozen: "Det er værdierne som aftalt, ikke dagens.",
    convertedAt: "Omregnet til",
    groupBy: "Gruppér efter",
    groupLevel: { area: "Område", year: "År", issue: "Serie", condition: "Stand" },
    noArea: "Intet område",
    noYear: "Intet år",
    noIssue: "Ingen serie",
    unnamedIssue: "(serie uden navn)",
    noCondition: "Ingen stand",
    total: "I alt",
    notPriced: "Uden pris",
    stamps: { one: "frimærke", other: "frimærker" },
    lines: { one: "linje", other: "linjer" },
    notes: { one: "note", other: "noter" },
    emptySide: "Intet på denne side.",
    truncated: (lines) => `Kun de første ${lines} af denne side vises.`,
    stamp: "Frimærke",
    variantNotSpecified: "variant ikke angivet",
    estimate: "skøn",
    ownFigure: "egen værdi",
    withdrawn: "Trukket tilbage",
    neverArrived: "Kom aldrig frem",
    notWanted: "Ønskes ikke",
    cannotSend: "Kan ikke sende",
    sideSummary: (notes, marked, mark) =>
      `Du har efterladt ${both([notes, marked !== null ? `${marked} markeret „${mark.toLowerCase()}“` : null], "og")} på denne side.`,
    saving: "Gemmer…",
    saved: "Gemt",
    saveFailed: "Det kunne ikke gemmes.",
    change: "Ændr",
    addNote: "Tilføj en note",
    lineNoteLabel: "Note om denne linje",
    yourComments: "Dine kommentarer",
    feedbackIntro: (collector) =>
      `Sæt flueben ved en linje, du ikke ønsker, eller skriv en note til den — ${collector} ser alt, hvad du efterlader her, og intet af det, du skriver, ændrer selve listen. Brug feltet nedenfor til alt, der gælder byttet som helhed.`,
    tradeNotePlaceholder: "En note om hele byttet",
    tradeNoteLabel: "Note om hele byttet",
    feedbackFinished:
      "Dette bytte er afsluttet, så listen modtager ikke længere kommentarer. Det, der allerede er sagt, vises nedenfor.",
    feedbackClosed: (status) => `Dette bytte har status „${status}“ og modtager ikke længere kommentarer.`,
    choicePrompt: (n) => `${n} af disse vil passe — hvilket vil du helst have?`,
    choiceHint:
      "Intet afgøres ved at vælge her — det er en anmodning, som din byttepartner bekræfter. Vælger du det eksemplar, der allerede er valgt, trækker du anmodningen tilbage.",
    chosenNow: "Valgt nu",
    youAsked: "Du bad om dette",
    copyNo: (n) => `Eksemplar ${n}`,
    noScan: "Ingen scanning",
    choicePreparing: "Listen er stadig under udarbejdelse, så valget af eksemplar er ikke åbent endnu.",
    choiceSettled: (status) => `Dette bytte har status „${status}“, så det er afgjort, hvilket eksemplar der sendes.`,
    unanswered: (status) => `Du bad om et andet eksemplar; byttet fik status „${status}“ med det viste.`,
  },
  de: {
    exchangeNo: (n) => `Tausch Nr. ${n}`,
    status: { preparing: "In Vorbereitung", shared: "Geteilt", agreed: "Vereinbart", closed: "Abgeschlossen", cancelled: "Abgesagt" },
    parties: (a, b) => `${a} und ${b}`,
    from: (name) => `Von ${name}`,
    onColnect: "auf Colnect",
    noFigures: "Diese Liste zeigt, was auf jeder Seite steht. Werte sind nicht enthalten.",
    agreedFigures: (catalog, currency) =>
      `Die Werte sind Preise aus ${catalog ?? "dem vereinbarten Katalog"}, in ${currency}. Eine Zeile, die in einem Katalog eines anderen Verlags bewertet wurde, sagt das neben ihrem Wert.`,
    ownFigures: (collector, currency) =>
      `Für diesen Tausch wurde kein gemeinsamer Katalog vereinbart, daher sind die Werte die eigene Bewertung von ${collector}, in ${currency}. Jede Zeile nennt den Katalog und die Ausgabe, nach der sie bewertet wurde.`,
    frozen: "Es sind die Werte zum Zeitpunkt der Vereinbarung, nicht die heutigen.",
    convertedAt: "Umgerechnet zu",
    groupBy: "Gruppieren nach",
    groupLevel: { area: "Gebiet", year: "Jahr", issue: "Serie", condition: "Erhaltung" },
    noArea: "Kein Gebiet",
    noYear: "Kein Jahr",
    noIssue: "Keine Serie",
    unnamedIssue: "(Serie ohne Namen)",
    noCondition: "Keine Erhaltung",
    total: "Summe",
    notPriced: "Ohne Wert",
    stamps: { one: "Marke", other: "Marken" },
    lines: { one: "Zeile", other: "Zeilen" },
    notes: { one: "Notiz", other: "Notizen" },
    emptySide: "Auf dieser Seite steht nichts.",
    truncated: (lines) => `Es werden nur die ersten ${lines} dieser Seite gezeigt.`,
    stamp: "Marke",
    variantNotSpecified: "Variante nicht angegeben",
    estimate: "geschätzt",
    ownFigure: "eigener Wert",
    withdrawn: "Zurückgezogen",
    neverArrived: "Nie angekommen",
    notWanted: "Nicht gewünscht",
    cannotSend: "Kann ich nicht schicken",
    sideSummary: (notes, marked, mark) =>
      `Sie haben auf dieser Seite ${both([notes, marked !== null ? `${marked}× „${mark}“` : null], "und")} hinterlassen.`,
    saving: "Wird gespeichert…",
    saved: "Gespeichert",
    saveFailed: "Das konnte nicht gespeichert werden.",
    change: "Ändern",
    addNote: "Notiz hinzufügen",
    lineNoteLabel: "Notiz zu dieser Zeile",
    yourComments: "Ihre Anmerkungen",
    feedbackIntro: (collector) =>
      `Haken Sie eine Zeile ab, die Sie nicht möchten, oder schreiben Sie eine Notiz dazu — ${collector} sieht alles, was Sie hier hinterlassen, und nichts davon ändert die Liste selbst. Das Feld unten ist für alles, was den Tausch als Ganzes betrifft.`,
    tradeNotePlaceholder: "Eine Notiz zum ganzen Tausch",
    tradeNoteLabel: "Notiz zum ganzen Tausch",
    feedbackFinished:
      "Dieser Tausch ist abgeschlossen, daher nimmt die Liste keine Anmerkungen mehr an. Was bereits gesagt wurde, steht unten.",
    feedbackClosed: (status) => `Dieser Tausch hat den Stand „${status}“ und nimmt keine Anmerkungen mehr an.`,
    choicePrompt: (n) =>
      n === 2 ? "Zwei davon kämen infrage — welche hätten Sie gern?" : `${n} davon kämen infrage — welche hätten Sie gern?`,
    choiceHint:
      "Mit der Auswahl hier wird nichts entschieden — es ist eine Bitte, die Ihr Tauschpartner bestätigt. Wählen Sie das bereits gewählte Exemplar, nehmen Sie die Bitte zurück.",
    chosenNow: "Derzeit gewählt",
    youAsked: "Darum haben Sie gebeten",
    copyNo: (n) => `Exemplar ${n}`,
    noScan: "Kein Scan",
    choicePreparing: "Die Liste wird noch zusammengestellt, daher ist die Wahl des Exemplars noch nicht offen.",
    choiceSettled: (status) => `Dieser Tausch hat den Stand „${status}“, daher steht fest, welches Exemplar verschickt wird.`,
    unanswered: (status) =>
      `Sie haben um ein anderes Exemplar gebeten; der Tausch hat mit dem gezeigten den Stand „${status}“ erreicht.`,
  },
  es: {
    exchangeNo: (n) => `Intercambio n.º ${n}`,
    status: { preparing: "En preparación", shared: "Compartido", agreed: "Acordado", closed: "Cerrado", cancelled: "Cancelado" },
    parties: (a, b) => `${a} y ${b}`,
    from: (name) => `De ${name}`,
    onColnect: "en Colnect",
    noFigures: "Esta lista muestra lo que hay en cada lado. No incluye valores.",
    agreedFigures: (catalog, currency) =>
      `Los valores son precios de ${catalog ?? "el catálogo acordado"}, en ${currency}. Una línea valorada en el catálogo de otra editorial lo indica junto a su valor.`,
    ownFigures: (collector, currency) =>
      `No se ha acordado un catálogo común para este intercambio, así que los valores son la valoración propia de ${collector}, en ${currency}. Cada línea indica en qué catálogo y edición se valoró.`,
    frozen: "Son los valores acordados, no los de hoy.",
    convertedAt: "Convertido a",
    groupBy: "Agrupar por",
    groupLevel: { area: "Territorio", year: "Año", issue: "Serie", condition: "Estado" },
    noArea: "Sin territorio",
    noYear: "Sin año",
    noIssue: "Sin serie",
    unnamedIssue: "(serie sin nombre)",
    noCondition: "Sin estado",
    total: "Total",
    notPriced: "Sin valor",
    stamps: { one: "sello", other: "sellos" },
    lines: { one: "línea", other: "líneas" },
    notes: { one: "nota", other: "notas" },
    emptySide: "No hay nada en este lado.",
    truncated: (lines) => `Solo se muestran las primeras ${lines} de este lado.`,
    stamp: "Sello",
    variantNotSpecified: "variante sin especificar",
    estimate: "estimado",
    ownFigure: "valor propio",
    withdrawn: "Retirado",
    neverArrived: "No llegó",
    notWanted: "No lo quiero",
    cannotSend: "No puedo enviarlo",
    sideSummary: (notes, marked, mark) =>
      `Ha dejado ${both([notes, marked !== null ? `${marked} marcadas «${mark.toLowerCase()}»` : null], "y")} en este lado.`,
    saving: "Guardando…",
    saved: "Guardado",
    saveFailed: "No se pudo guardar.",
    change: "Cambiar",
    addNote: "Añadir una nota",
    lineNoteLabel: "Nota sobre esta línea",
    yourComments: "Sus comentarios",
    feedbackIntro: (collector) =>
      `Marque una línea que no quiera o añádale una nota — ${collector} ve todo lo que deje aquí, y nada de lo que escriba cambia la lista. Use el cuadro de abajo para cualquier cosa sobre el intercambio en su conjunto.`,
    tradeNotePlaceholder: "Una nota sobre todo el intercambio",
    tradeNoteLabel: "Nota sobre todo el intercambio",
    feedbackFinished:
      "Este intercambio ha terminado, así que la lista ya no admite comentarios. Lo que ya se dijo aparece abajo.",
    feedbackClosed: (status) => `Este intercambio está en estado «${status}» y ya no admite comentarios.`,
    choicePrompt: (n) => `Cualquiera de estos ${n} serviría — ¿cuál prefiere?`,
    choiceHint:
      "Elegir aquí no decide nada — es una petición que su compañero de intercambio confirma. Elegir el ejemplar ya escogido retira la petición.",
    chosenNow: "Elegido ahora",
    youAsked: "Usted pidió este",
    copyNo: (n) => `Ejemplar ${n}`,
    noScan: "Sin escaneo",
    choicePreparing: "La lista aún se está preparando, así que la elección del ejemplar todavía no está abierta.",
    choiceSettled: (status) => `Este intercambio está en estado «${status}», así que ya está decidido qué ejemplar se envía.`,
    unanswered: (status) => `Pidió otro ejemplar; el intercambio pasó a «${status}» con el que se muestra.`,
  },
  fi: {
    exchangeNo: (n) => `Vaihto nro ${n}`,
    status: { preparing: "Valmisteilla", shared: "Jaettu", agreed: "Sovittu", closed: "Päättynyt", cancelled: "Peruttu" },
    parties: (a, b) => `${a} ja ${b}`,
    from: (name) => `Lähettäjä: ${name}`,
    onColnect: "Colnectissa",
    noFigures: "Tämä lista näyttää, mitä kummallakin puolella on. Arvoja ei ole mukana.",
    agreedFigures: (catalog, currency) =>
      `Arvot ovat hintoja luettelosta ${catalog ?? "(sovittu luettelo)"}, valuuttana ${currency}. Jos rivi on arvioitu toisen kustantajan luettelosta, se kerrotaan arvon vieressä.`,
    ownFigures: (collector, currency) =>
      `Tälle vaihdolle ei ole sovittu yhteistä luetteloa, joten arvot ovat keräilijän ${collector} oma arvio, valuuttana ${currency}. Jokainen rivi kertoo, mistä luettelosta ja painoksesta se on arvioitu.`,
    frozen: "Arvot ovat sopimushetken arvoja, eivät tämänpäiväisiä.",
    convertedAt: "Muunnettu kurssilla",
    groupBy: "Ryhmittele",
    groupLevel: { area: "Alue", year: "Vuosi", issue: "Sarja", condition: "Kunto" },
    noArea: "Ei aluetta",
    noYear: "Ei vuotta",
    noIssue: "Ei sarjaa",
    unnamedIssue: "(nimetön sarja)",
    noCondition: "Ei kuntoa",
    total: "Yhteensä",
    notPriced: "Ei arvoa",
    stamps: { one: "merkki", other: "merkkiä" },
    lines: { one: "rivi", other: "riviä" },
    notes: { one: "huomautus", other: "huomautusta" },
    emptySide: "Tällä puolella ei ole mitään.",
    truncated: (lines) => `Tältä puolelta näytetään vain ensimmäiset ${lines}.`,
    stamp: "Merkki",
    variantNotSpecified: "muunnelmaa ei ole määritetty",
    estimate: "arvio",
    ownFigure: "oma arvo",
    withdrawn: "Peruttu",
    neverArrived: "Ei saapunut",
    notWanted: "En halua",
    cannotSend: "En voi lähettää",
    sideSummary: (notes, marked, mark) =>
      `Jätit tälle puolelle ${both([notes, marked !== null ? `${marked} merkintää ”${mark.toLowerCase()}”` : null], "ja")}.`,
    saving: "Tallennetaan…",
    saved: "Tallennettu",
    saveFailed: "Tallennus ei onnistunut.",
    change: "Muuta",
    addNote: "Lisää huomautus",
    lineNoteLabel: "Huomautus tästä rivistä",
    yourComments: "Kommenttisi",
    feedbackIntro: (collector) =>
      `Rastita rivi, jota et halua, tai lisää siihen huomautus — ${collector} näkee kaiken, mitä jätät tähän, eikä mikään kirjoittamasi muuta itse listaa. Käytä alla olevaa kenttää kaikkeen, mikä koskee vaihtoa kokonaisuutena.`,
    tradeNotePlaceholder: "Huomautus koko vaihdosta",
    tradeNoteLabel: "Huomautus koko vaihdosta",
    feedbackFinished:
      "Tämä vaihto on päättynyt, joten lista ei enää ota vastaan kommentteja. Jo sanottu näkyy alla.",
    feedbackClosed: (status) => `Tämän vaihdon tila on ”${status}”, eikä se enää ota vastaan kommentteja.`,
    choicePrompt: (n) => `Mikä tahansa näistä ${n} kelpaa — minkä haluaisit?`,
    choiceHint:
      "Valinta tässä ei päätä mitään — se on pyyntö, jonka vaihtokumppanisi vahvistaa. Jo valitun kappaleen valitseminen peruu pyynnön.",
    chosenNow: "Nyt valittu",
    youAsked: "Pyysit tätä",
    copyNo: (n) => `Kappale ${n}`,
    noScan: "Ei skannausta",
    choicePreparing: "Listaa kootaan vielä, joten kappaleen valinta ei ole vielä auki.",
    choiceSettled: (status) => `Tämän vaihdon tila on ”${status}”, joten lähetettävä kappale on jo päätetty.`,
    unanswered: (status) => `Pyysit toista kappaletta; vaihto eteni tilaan ”${status}” näytetyllä kappaleella.`,
  },
  fr: {
    exchangeNo: (n) => `Échange n° ${n}`,
    status: { preparing: "En préparation", shared: "Partagé", agreed: "Convenu", closed: "Clôturé", cancelled: "Annulé" },
    parties: (a, b) => `${a} et ${b}`,
    from: (name) => `De ${name}`,
    onColnect: "sur Colnect",
    noFigures: "Cette liste montre ce qui figure de chaque côté. Les valeurs ne sont pas incluses.",
    agreedFigures: (catalog, currency) =>
      `Les valeurs sont les prix de ${catalog ?? "le catalogue convenu"}, en ${currency}. Une ligne évaluée dans le catalogue d’un autre éditeur l’indique à côté de sa valeur.`,
    ownFigures: (collector, currency) =>
      `Aucun catalogue commun n’a été convenu pour cet échange : les valeurs sont donc l’estimation propre de ${collector}, en ${currency}. Chaque ligne indique le catalogue et l’édition dans lesquels elle a été évaluée.`,
    frozen: "Ce sont les valeurs convenues, pas celles d’aujourd’hui.",
    convertedAt: "Converti au taux",
    groupBy: "Regrouper par",
    groupLevel: { area: "Pays", year: "Année", issue: "Série", condition: "État" },
    noArea: "Sans pays",
    noYear: "Sans année",
    noIssue: "Sans série",
    unnamedIssue: "(série sans nom)",
    noCondition: "Sans état",
    total: "Total",
    notPriced: "Sans valeur",
    stamps: { one: "timbre", other: "timbres" },
    lines: { one: "ligne", other: "lignes" },
    notes: { one: "note", other: "notes" },
    emptySide: "Rien de ce côté.",
    truncated: (lines) => `Seules les ${lines} premières de ce côté sont affichées.`,
    stamp: "Timbre",
    variantNotSpecified: "variété non précisée",
    estimate: "estimation",
    ownFigure: "valeur propre",
    withdrawn: "Retiré",
    neverArrived: "Jamais arrivé",
    notWanted: "Pas souhaité",
    cannotSend: "Impossible à envoyer",
    sideSummary: (notes, marked, mark) =>
      `Vous avez laissé ${both([notes, marked !== null ? `${marked} marquée(s) « ${mark.toLowerCase()} »` : null], "et")} de ce côté.`,
    saving: "Enregistrement…",
    saved: "Enregistré",
    saveFailed: "L’enregistrement a échoué.",
    change: "Modifier",
    addNote: "Ajouter une note",
    lineNoteLabel: "Note sur cette ligne",
    yourComments: "Vos commentaires",
    feedbackIntro: (collector) =>
      `Cochez une ligne dont vous ne voulez pas, ou ajoutez-y une note — ${collector} voit tout ce que vous laissez ici, et rien de ce que vous écrivez ne modifie la liste elle-même. Utilisez la zone ci-dessous pour tout ce qui concerne l’échange dans son ensemble.`,
    tradeNotePlaceholder: "Une note sur l’ensemble de l’échange",
    tradeNoteLabel: "Note sur l’ensemble de l’échange",
    feedbackFinished:
      "Cet échange est terminé, la liste n’accepte donc plus de commentaires. Ce qui a déjà été dit figure ci-dessous.",
    feedbackClosed: (status) => `Cet échange est à l’état « ${status} » et n’accepte plus de commentaires.`,
    choicePrompt: (n) => `${n} de ces exemplaires conviendraient — lequel préférez-vous ?`,
    choiceHint:
      "Rien n’est décidé en choisissant ici — c’est une demande, que votre partenaire confirme. Choisir l’exemplaire déjà retenu retire la demande.",
    chosenNow: "Retenu actuellement",
    youAsked: "Vous avez demandé celui-ci",
    copyNo: (n) => `Exemplaire ${n}`,
    noScan: "Pas de scan",
    choicePreparing: "La liste est encore en cours de préparation : le choix de l’exemplaire n’est pas encore ouvert.",
    choiceSettled: (status) => `Cet échange est à l’état « ${status} » : l’exemplaire envoyé est donc fixé.`,
    unanswered: (status) =>
      `Vous avez demandé un autre exemplaire ; l’échange est passé à l’état « ${status} » avec celui affiché.`,
  },
  hu: {
    exchangeNo: (n) => `${n}. csere`,
    status: { preparing: "Előkészítés alatt", shared: "Megosztva", agreed: "Megegyezve", closed: "Lezárva", cancelled: "Lemondva" },
    parties: (a, b) => `${a} és ${b}`,
    from: (name) => `Küldi: ${name}`,
    onColnect: "a Colnecten",
    noFigures: "Ez a lista azt mutatja, mi van az egyes oldalakon. Értékeket nem tartalmaz.",
    agreedFigures: (catalog, currency) =>
      `Az értékek ${catalog ?? "a megállapodott katalógus"} árai, ${currency} pénznemben. Ha egy sort más kiadó katalógusa alapján értékeltek, az értéke mellett ez szerepel.`,
    ownFigures: (collector, currency) =>
      `Ehhez a cseréhez nem állapodtak meg közös katalógusban, ezért az értékek ${collector} saját értékelései, ${currency} pénznemben. Minden sor feltünteti, melyik katalógus melyik kiadása alapján értékelték.`,
    frozen: "Ezek a megállapodáskori értékek, nem a mai napiak.",
    convertedAt: "Átváltva:",
    groupBy: "Csoportosítás",
    groupLevel: { area: "Terület", year: "Év", issue: "Sorozat", condition: "Állapot" },
    noArea: "Nincs terület",
    noYear: "Nincs év",
    noIssue: "Nincs sorozat",
    unnamedIssue: "(névtelen sorozat)",
    noCondition: "Nincs állapot",
    total: "Összesen",
    notPriced: "Érték nélkül",
    stamps: { one: "bélyeg", other: "bélyeg" },
    lines: { one: "sor", other: "sor" },
    notes: { one: "megjegyzés", other: "megjegyzés" },
    emptySide: "Ezen az oldalon nincs semmi.",
    truncated: (lines) => `Ennek az oldalnak csak az első ${lines} látható.`,
    stamp: "Bélyeg",
    variantNotSpecified: "változat nincs megadva",
    estimate: "becslés",
    ownFigure: "saját érték",
    withdrawn: "Visszavonva",
    neverArrived: "Nem érkezett meg",
    notWanted: "Nem kérem",
    cannotSend: "Nem tudom küldeni",
    sideSummary: (notes, marked, mark) =>
      `Ezen az oldalon ${both([notes, marked !== null ? `${marked} „${mark.toLowerCase()}” jelölés` : null], "és")} van tőled.`,
    saving: "Mentés…",
    saved: "Mentve",
    saveFailed: "Nem sikerült menteni.",
    change: "Módosítás",
    addNote: "Megjegyzés hozzáadása",
    lineNoteLabel: "Megjegyzés ehhez a sorhoz",
    yourComments: "Megjegyzéseid",
    feedbackIntro: (collector) =>
      `Jelöld be azt a sort, amelyet nem kérsz, vagy fűzz hozzá megjegyzést — ${collector} mindent lát, amit itt hagysz, és semmi, amit írsz, nem változtatja meg magát a listát. Az alábbi mezőt használd mindenre, ami a cserét egészében érinti.`,
    tradeNotePlaceholder: "Megjegyzés az egész cseréről",
    tradeNoteLabel: "Megjegyzés az egész cseréről",
    feedbackFinished:
      "Ez a csere befejeződött, ezért a lista már nem fogad megjegyzéseket. A már elhangzottak lent láthatók.",
    feedbackClosed: (status) => `Ennek a cserének az állapota: „${status}”, ezért már nem fogad megjegyzéseket.`,
    choicePrompt: (n) => `Ebből a ${n} példányból bármelyik megfelel — melyiket kérnéd?`,
    choiceHint:
      "Az itteni választás nem dönt el semmit — ez egy kérés, amelyet a cserepartnered megerősít. A már kiválasztott példány választása visszavonja a kérést.",
    chosenNow: "Jelenleg kiválasztva",
    youAsked: "Ezt kérted",
    copyNo: (n) => `${n}. példány`,
    noScan: "Nincs szkennelés",
    choicePreparing: "A lista még összeállítás alatt van, ezért a példány kiválasztása még nem nyitott.",
    choiceSettled: (status) => `Ennek a cserének az állapota: „${status}”, ezért eldőlt, melyik példány megy.`,
    unanswered: (status) => `Másik példányt kértél; a csere a mutatott példánnyal került „${status}” állapotba.`,
  },
  it: {
    exchangeNo: (n) => `Scambio n. ${n}`,
    status: { preparing: "In preparazione", shared: "Condiviso", agreed: "Concordato", closed: "Chiuso", cancelled: "Annullato" },
    parties: (a, b) => `${a} e ${b}`,
    from: (name) => `Da ${name}`,
    onColnect: "su Colnect",
    noFigures: "Questa lista mostra cosa c’è da ciascun lato. I valori non sono inclusi.",
    agreedFigures: (catalog, currency) =>
      `I valori sono prezzi di ${catalog ?? "il catalogo concordato"}, in ${currency}. Una riga valutata nel catalogo di un altro editore lo indica accanto al suo valore.`,
    ownFigures: (collector, currency) =>
      `Per questo scambio non è stato concordato un catalogo comune, quindi i valori sono la valutazione propria di ${collector}, in ${currency}. Ogni riga indica in quale catalogo ed edizione è stata valutata.`,
    frozen: "Sono i valori concordati, non quelli di oggi.",
    convertedAt: "Convertito al cambio",
    groupBy: "Raggruppa per",
    groupLevel: { area: "Paese", year: "Anno", issue: "Serie", condition: "Stato" },
    noArea: "Nessun paese",
    noYear: "Nessun anno",
    noIssue: "Nessuna serie",
    unnamedIssue: "(serie senza nome)",
    noCondition: "Nessuno stato",
    total: "Totale",
    notPriced: "Senza valore",
    stamps: { one: "francobollo", other: "francobolli" },
    lines: { one: "riga", other: "righe" },
    notes: { one: "nota", other: "note" },
    emptySide: "Niente da questo lato.",
    truncated: (lines) => `Sono mostrate solo le prime ${lines} di questo lato.`,
    stamp: "Francobollo",
    variantNotSpecified: "varietà non specificata",
    estimate: "stima",
    ownFigure: "valore proprio",
    withdrawn: "Ritirato",
    neverArrived: "Mai arrivato",
    notWanted: "Non lo voglio",
    cannotSend: "Non posso inviarlo",
    sideSummary: (notes, marked, mark) =>
      `Hai lasciato ${both([notes, marked !== null ? `${marked} segnate «${mark.toLowerCase()}»` : null], "e")} su questo lato.`,
    saving: "Salvataggio…",
    saved: "Salvato",
    saveFailed: "Non è stato possibile salvare.",
    change: "Modifica",
    addNote: "Aggiungi una nota",
    lineNoteLabel: "Nota su questa riga",
    yourComments: "I tuoi commenti",
    feedbackIntro: (collector) =>
      `Spunta una riga che non vuoi o aggiungile una nota — ${collector} vede tutto ciò che lasci qui, e nulla di ciò che scrivi cambia la lista. Usa la casella qui sotto per tutto ciò che riguarda lo scambio nel suo insieme.`,
    tradeNotePlaceholder: "Una nota sull’intero scambio",
    tradeNoteLabel: "Nota sull’intero scambio",
    feedbackFinished:
      "Questo scambio è concluso, quindi la lista non accetta più commenti. Quanto già detto è riportato sotto.",
    feedbackClosed: (status) => `Questo scambio è nello stato «${status}» e non accetta più commenti.`,
    choicePrompt: (n) => `Va bene uno qualsiasi di questi ${n} — quale preferisci?`,
    choiceHint:
      "Scegliere qui non decide nulla — è una richiesta che il tuo partner conferma. Scegliere l’esemplare già scelto ritira la richiesta.",
    chosenNow: "Scelto ora",
    youAsked: "Hai chiesto questo",
    copyNo: (n) => `Esemplare ${n}`,
    noScan: "Nessuna scansione",
    choicePreparing: "La lista è ancora in preparazione, quindi la scelta dell’esemplare non è ancora aperta.",
    choiceSettled: (status) => `Questo scambio è nello stato «${status}», quindi l’esemplare da inviare è deciso.`,
    unanswered: (status) => `Hai chiesto un altro esemplare; lo scambio è passato a «${status}» con quello mostrato.`,
  },
  nl: {
    exchangeNo: (n) => `Ruil nr. ${n}`,
    status: { preparing: "In voorbereiding", shared: "Gedeeld", agreed: "Overeengekomen", closed: "Afgerond", cancelled: "Geannuleerd" },
    parties: (a, b) => `${a} en ${b}`,
    from: (name) => `Van ${name}`,
    onColnect: "op Colnect",
    noFigures: "Deze lijst toont wat er aan elke kant staat. Waarden zijn niet opgenomen.",
    agreedFigures: (catalog, currency) =>
      `De waarden zijn prijzen uit ${catalog ?? "de overeengekomen catalogus"}, in ${currency}. Een regel die in de catalogus van een andere uitgever is gewaardeerd, vermeldt dat naast de waarde.`,
    ownFigures: (collector, currency) =>
      `Voor deze ruil is geen gezamenlijke catalogus overeengekomen, dus de waarden zijn de eigen waardering van ${collector}, in ${currency}. Elke regel vermeldt in welke catalogus en editie hij is gewaardeerd.`,
    frozen: "Dit zijn de waarden zoals overeengekomen, niet die van vandaag.",
    convertedAt: "Omgerekend tegen",
    groupBy: "Groeperen op",
    groupLevel: { area: "Gebied", year: "Jaar", issue: "Serie", condition: "Kwaliteit" },
    noArea: "Geen gebied",
    noYear: "Geen jaar",
    noIssue: "Geen serie",
    unnamedIssue: "(serie zonder naam)",
    noCondition: "Geen kwaliteit",
    total: "Totaal",
    notPriced: "Zonder waarde",
    stamps: { one: "zegel", other: "zegels" },
    lines: { one: "regel", other: "regels" },
    notes: { one: "notitie", other: "notities" },
    emptySide: "Niets aan deze kant.",
    truncated: (lines) => `Alleen de eerste ${lines} van deze kant worden getoond.`,
    stamp: "Zegel",
    variantNotSpecified: "variant niet opgegeven",
    estimate: "schatting",
    ownFigure: "eigen waarde",
    withdrawn: "Teruggetrokken",
    neverArrived: "Nooit aangekomen",
    notWanted: "Niet gewenst",
    cannotSend: "Kan ik niet sturen",
    sideSummary: (notes, marked, mark) =>
      `U liet ${both([notes, marked !== null ? `${marked} gemarkeerd als ‘${mark.toLowerCase()}’` : null], "en")} achter aan deze kant.`,
    saving: "Opslaan…",
    saved: "Opgeslagen",
    saveFailed: "Dat kon niet worden opgeslagen.",
    change: "Wijzigen",
    addNote: "Notitie toevoegen",
    lineNoteLabel: "Notitie bij deze regel",
    yourComments: "Uw opmerkingen",
    feedbackIntro: (collector) =>
      `Vink een regel aan die u niet wilt, of voeg er een notitie aan toe — ${collector} ziet alles wat u hier achterlaat, en niets wat u schrijft verandert de lijst zelf. Gebruik het vak hieronder voor alles over de ruil als geheel.`,
    tradeNotePlaceholder: "Een notitie over de hele ruil",
    tradeNoteLabel: "Notitie over de hele ruil",
    feedbackFinished:
      "Deze ruil is afgerond, dus de lijst neemt geen opmerkingen meer aan. Wat al gezegd is, staat hieronder.",
    feedbackClosed: (status) => `Deze ruil heeft de status ‘${status}’ en neemt geen opmerkingen meer aan.`,
    choicePrompt: (n) => `${n} hiervan zouden passen — welke wilt u?`,
    choiceHint:
      "Hier kiezen beslist niets — het is een verzoek dat uw ruilpartner bevestigt. Het al gekozen exemplaar kiezen trekt het verzoek in.",
    chosenNow: "Nu gekozen",
    youAsked: "Hier vroeg u om",
    copyNo: (n) => `Exemplaar ${n}`,
    noScan: "Geen scan",
    choicePreparing: "De lijst wordt nog samengesteld, dus de keuze van het exemplaar is nog niet open.",
    choiceSettled: (status) => `Deze ruil heeft de status ‘${status}’, dus welk exemplaar verstuurd wordt, staat vast.`,
    unanswered: (status) => `U vroeg om een ander exemplaar; de ruil kreeg de status ‘${status}’ met het getoonde.`,
  },
  no: {
    exchangeNo: (n) => `Bytte nr. ${n}`,
    status: { preparing: "Under forberedelse", shared: "Delt", agreed: "Avtalt", closed: "Avsluttet", cancelled: "Avlyst" },
    parties: (a, b) => `${a} og ${b}`,
    from: (name) => `Fra ${name}`,
    onColnect: "på Colnect",
    noFigures: "Denne listen viser hva som er på hver side. Verdier er ikke tatt med.",
    agreedFigures: (catalog, currency) =>
      `Verdiene er priser fra ${catalog ?? "den avtalte katalogen"}, i ${currency}. En linje vurdert i et annet forlags katalog opplyser om det ved verdien.`,
    ownFigures: (collector, currency) =>
      `Det er ikke avtalt en felles katalog for dette byttet, så verdiene er ${collector}s egen vurdering, i ${currency}. Hver linje oppgir hvilken katalog og utgave den er vurdert i.`,
    frozen: "Dette er verdiene slik de ble avtalt, ikke dagens.",
    convertedAt: "Omregnet til",
    groupBy: "Grupper etter",
    groupLevel: { area: "Område", year: "År", issue: "Serie", condition: "Tilstand" },
    noArea: "Intet område",
    noYear: "Intet år",
    noIssue: "Ingen serie",
    unnamedIssue: "(serie uten navn)",
    noCondition: "Ingen tilstand",
    total: "Totalt",
    notPriced: "Uten verdi",
    stamps: { one: "frimerke", other: "frimerker" },
    lines: { one: "linje", other: "linjer" },
    notes: { one: "merknad", other: "merknader" },
    emptySide: "Ingenting på denne siden.",
    truncated: (lines) => `Bare de første ${lines} på denne siden vises.`,
    stamp: "Frimerke",
    variantNotSpecified: "variant ikke angitt",
    estimate: "anslag",
    ownFigure: "egen verdi",
    withdrawn: "Trukket tilbake",
    neverArrived: "Kom aldri fram",
    notWanted: "Ønskes ikke",
    cannotSend: "Kan ikke sende",
    sideSummary: (notes, marked, mark) =>
      `Du har lagt igjen ${both([notes, marked !== null ? `${marked} merket «${mark.toLowerCase()}»` : null], "og")} på denne siden.`,
    saving: "Lagrer…",
    saved: "Lagret",
    saveFailed: "Det kunne ikke lagres.",
    change: "Endre",
    addNote: "Legg til en merknad",
    lineNoteLabel: "Merknad om denne linjen",
    yourComments: "Dine kommentarer",
    feedbackIntro: (collector) =>
      `Kryss av for en linje du ikke vil ha, eller skriv en merknad til den — ${collector} ser alt du legger igjen her, og ingenting du skriver endrer selve listen. Bruk feltet nedenfor til alt som gjelder byttet som helhet.`,
    tradeNotePlaceholder: "En merknad om hele byttet",
    tradeNoteLabel: "Merknad om hele byttet",
    feedbackFinished:
      "Dette byttet er avsluttet, så listen tar ikke lenger imot kommentarer. Det som allerede er sagt, vises nedenfor.",
    feedbackClosed: (status) => `Dette byttet har status «${status}» og tar ikke lenger imot kommentarer.`,
    choicePrompt: (n) => `${n} av disse vil passe — hvilket vil du helst ha?`,
    choiceHint:
      "Ingenting avgjøres ved å velge her — det er en forespørsel som byttepartneren din bekrefter. Velger du eksemplaret som allerede er valgt, trekker du forespørselen tilbake.",
    chosenNow: "Valgt nå",
    youAsked: "Du ba om dette",
    copyNo: (n) => `Eksemplar ${n}`,
    noScan: "Ingen skanning",
    choicePreparing: "Listen settes fortsatt sammen, så valget av eksemplar er ikke åpent ennå.",
    choiceSettled: (status) => `Dette byttet har status «${status}», så det er avgjort hvilket eksemplar som sendes.`,
    unanswered: (status) => `Du ba om et annet eksemplar; byttet fikk status «${status}» med det som vises.`,
  },
  pl: {
    exchangeNo: (n) => `Wymiana nr ${n}`,
    status: { preparing: "W przygotowaniu", shared: "Udostępniona", agreed: "Uzgodniona", closed: "Zamknięta", cancelled: "Odwołana" },
    parties: (a, b) => `${a} i ${b}`,
    from: (name) => `Od: ${name}`,
    onColnect: "na Colnect",
    noFigures: "Ta lista pokazuje, co jest po każdej stronie. Wartości nie są podane.",
    agreedFigures: (catalog, currency) =>
      `Wartości to ceny z katalogu ${catalog ?? "uzgodnionego"}, w ${currency}. Pozycja wyceniona w katalogu innego wydawcy mówi o tym obok swojej wartości.`,
    ownFigures: (collector, currency) =>
      `Dla tej wymiany nie uzgodniono wspólnego katalogu, więc wartości to własna wycena (${collector}), w ${currency}. Każda pozycja podaje, w którym katalogu i wydaniu została wyceniona.`,
    frozen: "To wartości z chwili uzgodnienia, nie dzisiejsze.",
    convertedAt: "Przeliczono po kursie",
    groupBy: "Grupuj według",
    groupLevel: { area: "Obszar", year: "Rok", issue: "Seria", condition: "Stan" },
    noArea: "Bez obszaru",
    noYear: "Bez roku",
    noIssue: "Bez serii",
    unnamedIssue: "(seria bez nazwy)",
    noCondition: "Bez stanu",
    total: "Razem",
    notPriced: "Bez wyceny",
    stamps: { one: "znaczek", few: "znaczki", many: "znaczków", other: "znaczka" },
    lines: { one: "pozycja", few: "pozycje", many: "pozycji", other: "pozycji" },
    notes: { one: "uwaga", few: "uwagi", many: "uwag", other: "uwagi" },
    emptySide: "Po tej stronie nic nie ma.",
    truncated: (lines) => `Pokazano tylko pierwsze ${lines} tej strony.`,
    stamp: "Znaczek",
    variantNotSpecified: "wariant nieokreślony",
    estimate: "szacunek",
    ownFigure: "własna wartość",
    withdrawn: "Wycofana",
    neverArrived: "Nie dotarła",
    notWanted: "Nie chcę",
    cannotSend: "Nie mogę wysłać",
    sideSummary: (notes, marked, mark) =>
      `Po tej stronie zostawiono: ${both([notes, marked !== null ? `${marked} × „${mark.toLowerCase()}”` : null], "i")}.`,
    saving: "Zapisywanie…",
    saved: "Zapisano",
    saveFailed: "Nie udało się zapisać.",
    change: "Zmień",
    addNote: "Dodaj uwagę",
    lineNoteLabel: "Uwaga do tej pozycji",
    yourComments: "Twoje uwagi",
    feedbackIntro: (collector) =>
      `Zaznacz pozycję, której nie chcesz, albo dopisz do niej uwagę — ${collector} widzi wszystko, co tu zostawisz, a nic, co napiszesz, nie zmienia samej listy. Pole poniżej służy do wszystkiego, co dotyczy wymiany jako całości.`,
    tradeNotePlaceholder: "Uwaga do całej wymiany",
    tradeNoteLabel: "Uwaga do całej wymiany",
    feedbackFinished:
      "Ta wymiana jest zakończona, więc lista nie przyjmuje już uwag. To, co już powiedziano, jest pokazane poniżej.",
    feedbackClosed: (status) => `Ta wymiana ma status „${status}” i nie przyjmuje już uwag.`,
    choicePrompt: (n) => `Pasuje dowolny z tych ${n} egzemplarzy — który wolisz?`,
    choiceHint:
      "Wybór tutaj niczego nie przesądza — to prośba, którą potwierdza partner wymiany. Wybranie egzemplarza, który już jest wybrany, wycofuje prośbę.",
    chosenNow: "Teraz wybrany",
    youAsked: "O ten prosisz",
    copyNo: (n) => `Egzemplarz ${n}`,
    noScan: "Brak skanu",
    choicePreparing: "Lista jest jeszcze przygotowywana, więc wybór egzemplarza nie jest jeszcze otwarty.",
    choiceSettled: (status) => `Ta wymiana ma status „${status}”, więc to, który egzemplarz zostanie wysłany, jest już ustalone.`,
    unanswered: (status) => `Prosiłeś o inny egzemplarz; wymiana otrzymała status „${status}” z egzemplarzem pokazanym tutaj.`,
  },
  pt: {
    exchangeNo: (n) => `Troca n.º ${n}`,
    status: { preparing: "Em preparação", shared: "Partilhada", agreed: "Acordada", closed: "Fechada", cancelled: "Cancelada" },
    parties: (a, b) => `${a} e ${b}`,
    from: (name) => `De ${name}`,
    onColnect: "no Colnect",
    noFigures: "Esta lista mostra o que está de cada lado. Não inclui valores.",
    agreedFigures: (catalog, currency) =>
      `Os valores são preços de ${catalog ?? "o catálogo acordado"}, em ${currency}. Uma linha avaliada no catálogo de outra editora indica-o junto ao seu valor.`,
    ownFigures: (collector, currency) =>
      `Não foi acordado um catálogo comum para esta troca, por isso os valores são a avaliação própria de ${collector}, em ${currency}. Cada linha indica em que catálogo e edição foi avaliada.`,
    frozen: "São os valores acordados, não os de hoje.",
    convertedAt: "Convertido à taxa",
    groupBy: "Agrupar por",
    groupLevel: { area: "Território", year: "Ano", issue: "Série", condition: "Estado" },
    noArea: "Sem território",
    noYear: "Sem ano",
    noIssue: "Sem série",
    unnamedIssue: "(série sem nome)",
    noCondition: "Sem estado",
    total: "Total",
    notPriced: "Sem valor",
    stamps: { one: "selo", other: "selos" },
    lines: { one: "linha", other: "linhas" },
    notes: { one: "nota", other: "notas" },
    emptySide: "Nada deste lado.",
    truncated: (lines) => `Só são mostradas as primeiras ${lines} deste lado.`,
    stamp: "Selo",
    variantNotSpecified: "variante não especificada",
    estimate: "estimativa",
    ownFigure: "valor próprio",
    withdrawn: "Retirado",
    neverArrived: "Nunca chegou",
    notWanted: "Não quero",
    cannotSend: "Não posso enviar",
    sideSummary: (notes, marked, mark) =>
      `Deixou ${both([notes, marked !== null ? `${marked} marcadas «${mark.toLowerCase()}»` : null], "e")} deste lado.`,
    saving: "A guardar…",
    saved: "Guardado",
    saveFailed: "Não foi possível guardar.",
    change: "Alterar",
    addNote: "Adicionar uma nota",
    lineNoteLabel: "Nota sobre esta linha",
    yourComments: "Os seus comentários",
    feedbackIntro: (collector) =>
      `Assinale uma linha que não quer, ou acrescente-lhe uma nota — ${collector} vê tudo o que deixar aqui, e nada do que escrever altera a lista em si. Use a caixa abaixo para tudo o que diga respeito à troca no seu conjunto.`,
    tradeNotePlaceholder: "Uma nota sobre toda a troca",
    tradeNoteLabel: "Nota sobre toda a troca",
    feedbackFinished:
      "Esta troca está concluída, por isso a lista já não aceita comentários. O que já foi dito aparece abaixo.",
    feedbackClosed: (status) => `Esta troca está no estado «${status}» e já não aceita comentários.`,
    choicePrompt: (n) => `Qualquer um destes ${n} serve — qual prefere?`,
    choiceHint:
      "Escolher aqui não decide nada — é um pedido que o seu parceiro confirma. Escolher o exemplar já escolhido retira o pedido.",
    chosenNow: "Escolhido agora",
    youAsked: "Pediu este",
    copyNo: (n) => `Exemplar ${n}`,
    noScan: "Sem digitalização",
    choicePreparing: "A lista ainda está a ser preparada, por isso a escolha do exemplar ainda não está aberta.",
    choiceSettled: (status) => `Esta troca está no estado «${status}», por isso já está decidido que exemplar segue.`,
    unanswered: (status) => `Pediu outro exemplar; a troca passou a «${status}» com o exemplar mostrado.`,
  },
  ro: {
    exchangeNo: (n) => `Schimbul nr. ${n}`,
    status: { preparing: "În pregătire", shared: "Partajat", agreed: "Convenit", closed: "Încheiat", cancelled: "Anulat" },
    parties: (a, b) => `${a} și ${b}`,
    from: (name) => `De la ${name}`,
    onColnect: "pe Colnect",
    noFigures: "Această listă arată ce se află de fiecare parte. Valorile nu sunt incluse.",
    agreedFigures: (catalog, currency) =>
      `Valorile sunt prețuri din ${catalog ?? "catalogul convenit"}, în ${currency}. Un rând evaluat în catalogul altui editor menționează acest lucru lângă valoarea sa.`,
    ownFigures: (collector, currency) =>
      `Pentru acest schimb nu s-a convenit un catalog comun, așa că valorile sunt evaluarea proprie a lui ${collector}, în ${currency}. Fiecare rând arată în ce catalog și ediție a fost evaluat.`,
    frozen: "Acestea sunt valorile convenite, nu cele de azi.",
    convertedAt: "Convertit la cursul",
    groupBy: "Grupează după",
    groupLevel: { area: "Teritoriu", year: "An", issue: "Serie", condition: "Stare" },
    noArea: "Fără teritoriu",
    noYear: "Fără an",
    noIssue: "Fără serie",
    unnamedIssue: "(serie fără nume)",
    noCondition: "Fără stare",
    total: "Total",
    notPriced: "Fără valoare",
    stamps: { one: "timbru", few: "timbre", other: "de timbre" },
    lines: { one: "rând", few: "rânduri", other: "de rânduri" },
    notes: { one: "notă", few: "note", other: "de note" },
    emptySide: "Nimic de această parte.",
    truncated: (lines) => `Se afișează doar primele ${lines} de această parte.`,
    stamp: "Timbru",
    variantNotSpecified: "variantă nespecificată",
    estimate: "estimare",
    ownFigure: "valoare proprie",
    withdrawn: "Retras",
    neverArrived: "Nu a sosit",
    notWanted: "Nu îl vreau",
    cannotSend: "Nu îl pot trimite",
    sideSummary: (notes, marked, mark) =>
      `Ați lăsat ${both([notes, marked !== null ? `${marked} marcate „${mark.toLowerCase()}”` : null], "și")} de această parte.`,
    saving: "Se salvează…",
    saved: "Salvat",
    saveFailed: "Nu s-a putut salva.",
    change: "Modifică",
    addNote: "Adaugă o notă",
    lineNoteLabel: "Notă despre acest rând",
    yourComments: "Comentariile dvs.",
    feedbackIntro: (collector) =>
      `Bifați un rând pe care nu îl doriți sau adăugați-i o notă — ${collector} vede tot ce lăsați aici, iar nimic din ce scrieți nu schimbă lista în sine. Folosiți caseta de mai jos pentru orice privește schimbul în ansamblu.`,
    tradeNotePlaceholder: "O notă despre întregul schimb",
    tradeNoteLabel: "Notă despre întregul schimb",
    feedbackFinished:
      "Acest schimb s-a încheiat, așa că lista nu mai primește comentarii. Ce s-a spus deja apare mai jos.",
    feedbackClosed: (status) => `Acest schimb are starea „${status}” și nu mai primește comentarii.`,
    choicePrompt: (n) => `Oricare dintre aceste ${n} ar fi potrivit — pe care îl preferați?`,
    choiceHint:
      "Alegerea de aici nu decide nimic — este o cerere pe care partenerul dvs. o confirmă. Alegerea exemplarului deja ales retrage cererea.",
    chosenNow: "Ales acum",
    youAsked: "Ați cerut acesta",
    copyNo: (n) => `Exemplarul ${n}`,
    noScan: "Fără scanare",
    choicePreparing: "Lista este încă în pregătire, așa că alegerea exemplarului nu este încă deschisă.",
    choiceSettled: (status) => `Acest schimb are starea „${status}”, așa că exemplarul trimis este stabilit.`,
    unanswered: (status) => `Ați cerut alt exemplar; schimbul a ajuns la starea „${status}” cu cel afișat.`,
  },
  ru: {
    exchangeNo: (n) => `Обмен № ${n}`,
    status: { preparing: "Готовится", shared: "Отправлен", agreed: "Согласован", closed: "Завершён", cancelled: "Отменён" },
    parties: (a, b) => `${a} и ${b}`,
    from: (name) => `От: ${name}`,
    onColnect: "на Colnect",
    noFigures: "Этот список показывает, что есть с каждой стороны. Стоимость не указана.",
    agreedFigures: (catalog, currency) =>
      `Стоимость указана по ${catalog ?? "согласованному каталогу"}, в ${currency}. Если строка оценена по каталогу другого издателя, это указано рядом с её стоимостью.`,
    ownFigures: (collector, currency) =>
      `Общий каталог для этого обмена не согласован, поэтому стоимость — собственная оценка (${collector}), в ${currency}. Для каждой строки указано, по какому каталогу и изданию она оценена.`,
    frozen: "Это стоимость на момент согласования, а не сегодняшняя.",
    convertedAt: "Пересчитано по курсу",
    groupBy: "Группировать по",
    groupLevel: { area: "Территория", year: "Год", issue: "Серия", condition: "Состояние" },
    noArea: "Без территории",
    noYear: "Без года",
    noIssue: "Без серии",
    unnamedIssue: "(серия без названия)",
    noCondition: "Без состояния",
    total: "Итого",
    notPriced: "Без оценки",
    stamps: { one: "марка", few: "марки", many: "марок", other: "марки" },
    lines: { one: "строка", few: "строки", many: "строк", other: "строки" },
    notes: { one: "заметка", few: "заметки", many: "заметок", other: "заметки" },
    emptySide: "С этой стороны ничего нет.",
    truncated: (lines) => `Показаны только первые ${lines} этой стороны.`,
    stamp: "Марка",
    variantNotSpecified: "вариант не указан",
    estimate: "оценочно",
    ownFigure: "своя оценка",
    withdrawn: "Отозвано",
    neverArrived: "Не дошло",
    notWanted: "Не нужно",
    cannotSend: "Не могу отправить",
    sideSummary: (notes, marked, mark) =>
      `С этой стороны вы оставили: ${both([notes, marked !== null ? `${marked} × «${mark.toLowerCase()}»` : null], "и")}.`,
    saving: "Сохранение…",
    saved: "Сохранено",
    saveFailed: "Не удалось сохранить.",
    change: "Изменить",
    addNote: "Добавить заметку",
    lineNoteLabel: "Заметка к этой строке",
    yourComments: "Ваши комментарии",
    feedbackIntro: (collector) =>
      `Отметьте строку, которая вам не нужна, или добавьте к ней заметку — ${collector} видит всё, что вы здесь оставите, и ничто из написанного не меняет сам список. Поле ниже — для всего, что касается обмена в целом.`,
    tradeNotePlaceholder: "Заметка ко всему обмену",
    tradeNoteLabel: "Заметка ко всему обмену",
    feedbackFinished:
      "Этот обмен завершён, поэтому список больше не принимает комментарии. Всё, что уже сказано, показано ниже.",
    feedbackClosed: (status) => `Статус этого обмена — «${status}», он больше не принимает комментарии.`,
    choicePrompt: (n) => `Подойдёт любой из этих экземпляров (${n}) — какой вы хотите?`,
    choiceHint:
      "Выбор здесь ничего не решает — это просьба, которую подтверждает ваш партнёр. Выбор уже выбранного экземпляра отзывает просьбу.",
    chosenNow: "Выбран сейчас",
    youAsked: "Вы просили этот",
    copyNo: (n) => `Экземпляр ${n}`,
    noScan: "Нет скана",
    choicePreparing: "Список ещё составляется, поэтому выбор экземпляра пока не открыт.",
    choiceSettled: (status) => `Статус этого обмена — «${status}», поэтому решено, какой экземпляр будет отправлен.`,
    unanswered: (status) => `Вы просили другой экземпляр; обмен получил статус «${status}» с показанным экземпляром.`,
  },
  sk: {
    exchangeNo: (n) => `Výmena č. ${n}`,
    status: { preparing: "Pripravuje sa", shared: "Zdieľané", agreed: "Dohodnuté", closed: "Uzavreté", cancelled: "Zrušené" },
    parties: (a, b) => `${a} a ${b}`,
    from: (name) => `Od: ${name}`,
    onColnect: "na Colnecte",
    noFigures: "Tento zoznam ukazuje, čo je na každej strane. Hodnoty nie sú uvedené.",
    agreedFigures: (catalog, currency) =>
      `Hodnoty sú ceny ${catalog ?? "dohodnutého katalógu"} v ${currency}. Riadok ocenený v katalógu iného vydavateľa to uvádza pri svojej hodnote.`,
    ownFigures: (collector, currency) =>
      `Pre túto výmenu nebol dohodnutý žiadny katalóg, takže hodnoty sú vlastným ocenením (${collector}) v ${currency}. Pri každom riadku je uvedené, v ktorom katalógu a vydaní bol ocenený.`,
    frozen: "Sú to hodnoty z času dohody, nie dnešné.",
    convertedAt: "Prepočítané kurzom",
    groupBy: "Zoskupiť podľa",
    groupLevel: { area: "Územie", year: "Rok", issue: "Séria", condition: "Stav" },
    noArea: "Bez územia",
    noYear: "Bez roku",
    noIssue: "Bez série",
    unnamedIssue: "(séria bez názvu)",
    noCondition: "Bez stavu",
    total: "Spolu",
    notPriced: "Bez ceny",
    stamps: { one: "známka", few: "známky", many: "známky", other: "známok" },
    lines: { one: "riadok", few: "riadky", many: "riadka", other: "riadkov" },
    notes: { one: "poznámka", few: "poznámky", many: "poznámky", other: "poznámok" },
    emptySide: "Na tejto strane nič nie je.",
    truncated: (lines) => `Zobrazených je len prvých ${lines} tejto strany.`,
    stamp: "Známka",
    variantNotSpecified: "variant neurčený",
    estimate: "odhad",
    ownFigure: "vlastná hodnota",
    withdrawn: "Stiahnuté",
    neverArrived: "Nedorazilo",
    notWanted: "Nechcem",
    cannotSend: "Nemôžem poslať",
    sideSummary: (notes, marked, mark) =>
      `Na tejto strane ste zanechali ${both([notes, marked !== null ? `${marked}× „${mark}“` : null], "a")}.`,
    saving: "Ukladá sa…",
    saved: "Uložené",
    saveFailed: "Nepodarilo sa uložiť.",
    change: "Zmeniť",
    addNote: "Pridať poznámku",
    lineNoteLabel: "Poznámka k tomuto riadku",
    yourComments: "Vaše poznámky",
    feedbackIntro: (collector) =>
      `Zaškrtnite riadok, ktorý nechcete, alebo k nemu pripíšte poznámku — ${collector} uvidí všetko, čo tu zanecháte, a nič z toho, čo napíšete, samotný zoznam nezmení. Pole nižšie slúži na všetko, čo sa týka výmeny ako celku.`,
    tradeNotePlaceholder: "Poznámka k celej výmene",
    tradeNoteLabel: "Poznámka k celej výmene",
    feedbackFinished:
      "Táto výmena je dokončená, takže zoznam už neprijíma poznámky. Všetko, čo už bolo povedané, je uvedené nižšie.",
    feedbackClosed: (status) => `Stav tejto výmeny: ${status}. Poznámky už neprijíma.`,
    choicePrompt: (n) => `Poslúži ktorýkoľvek z týchto ${n} kusov — ktorý by ste chceli?`,
    choiceHint:
      "Výberom tu sa nič nerozhoduje — je to žiadosť, ktorú váš partner potvrdí. Výberom už zvoleného kusu žiadosť odvoláte.",
    chosenNow: "Teraz zvolené",
    youAsked: "O tento ste požiadali",
    copyNo: (n) => `Kus ${n}`,
    noScan: "Bez skenu",
    choicePreparing: "Zoznam sa ešte zostavuje, takže výber kusu zatiaľ nie je otvorený.",
    choiceSettled: (status) => `Stav tejto výmeny: ${status}. Ktorý kus sa posiela, je už rozhodnuté.`,
    unanswered: (status) => `Požiadali ste o iný kus; stav výmeny je teraz „${status}“ s kusom, ktorý je zobrazený.`,
  },
  sv: {
    exchangeNo: (n) => `Byte nr ${n}`,
    status: { preparing: "Förbereds", shared: "Delat", agreed: "Överenskommet", closed: "Avslutat", cancelled: "Inställt" },
    parties: (a, b) => `${a} och ${b}`,
    from: (name) => `Från ${name}`,
    onColnect: "på Colnect",
    noFigures: "Den här listan visar vad som finns på varje sida. Värden ingår inte.",
    agreedFigures: (catalog, currency) =>
      `Värdena är priser från ${catalog ?? "den överenskomna katalogen"}, i ${currency}. En rad som värderats i ett annat förlags katalog anger det vid sitt värde.`,
    ownFigures: (collector, currency) =>
      `Ingen gemensam katalog har avtalats för det här bytet, så värdena är ${collector}s egen värdering, i ${currency}. Varje rad anger vilken katalog och utgåva den värderats i.`,
    frozen: "Det är värdena som avtalades, inte dagens.",
    convertedAt: "Omräknat till",
    groupBy: "Gruppera efter",
    groupLevel: { area: "Område", year: "År", issue: "Serie", condition: "Skick" },
    noArea: "Inget område",
    noYear: "Inget år",
    noIssue: "Ingen serie",
    unnamedIssue: "(serie utan namn)",
    noCondition: "Inget skick",
    total: "Totalt",
    notPriced: "Utan värde",
    stamps: { one: "frimärke", other: "frimärken" },
    lines: { one: "rad", other: "rader" },
    notes: { one: "anteckning", other: "anteckningar" },
    emptySide: "Ingenting på den här sidan.",
    truncated: (lines) => `Bara de första ${lines} på den här sidan visas.`,
    stamp: "Frimärke",
    variantNotSpecified: "variant inte angiven",
    estimate: "uppskattning",
    ownFigure: "eget värde",
    withdrawn: "Återtaget",
    neverArrived: "Kom aldrig fram",
    notWanted: "Önskas inte",
    cannotSend: "Kan inte skicka",
    sideSummary: (notes, marked, mark) =>
      `Du har lämnat ${both([notes, marked !== null ? `${marked} markerade ”${mark.toLowerCase()}”` : null], "och")} på den här sidan.`,
    saving: "Sparar…",
    saved: "Sparat",
    saveFailed: "Det gick inte att spara.",
    change: "Ändra",
    addNote: "Lägg till en anteckning",
    lineNoteLabel: "Anteckning om den här raden",
    yourComments: "Dina kommentarer",
    feedbackIntro: (collector) =>
      `Kryssa i en rad du inte vill ha, eller skriv en anteckning till den — ${collector} ser allt du lämnar här, och inget du skriver ändrar själva listan. Använd rutan nedan för allt som gäller bytet som helhet.`,
    tradeNotePlaceholder: "En anteckning om hela bytet",
    tradeNoteLabel: "Anteckning om hela bytet",
    feedbackFinished:
      "Det här bytet är avslutat, så listan tar inte längre emot kommentarer. Det som redan sagts visas nedan.",
    feedbackClosed: (status) => `Det här bytet har status ”${status}” och tar inte längre emot kommentarer.`,
    choicePrompt: (n) => `${n} av dessa skulle passa — vilket vill du helst ha?`,
    choiceHint:
      "Inget avgörs genom att välja här — det är en begäran som din bytespartner bekräftar. Väljer du exemplaret som redan är valt drar du tillbaka begäran.",
    chosenNow: "Valt nu",
    youAsked: "Du bad om det här",
    copyNo: (n) => `Exemplar ${n}`,
    noScan: "Ingen skanning",
    choicePreparing: "Listan sätts fortfarande ihop, så valet av exemplar är inte öppet ännu.",
    choiceSettled: (status) => `Det här bytet har status ”${status}”, så det är avgjort vilket exemplar som skickas.`,
    unanswered: (status) => `Du bad om ett annat exemplar; bytet fick status ”${status}” med det som visas.`,
  },
  uk: {
    exchangeNo: (n) => `Обмін № ${n}`,
    status: { preparing: "Готується", shared: "Надіслано", agreed: "Погоджено", closed: "Завершено", cancelled: "Скасовано" },
    parties: (a, b) => `${a} і ${b}`,
    from: (name) => `Від: ${name}`,
    onColnect: "на Colnect",
    noFigures: "Цей список показує, що є з кожного боку. Вартість не вказано.",
    agreedFigures: (catalog, currency) =>
      `Вартість указано за ${catalog ?? "погодженим каталогом"}, у ${currency}. Якщо рядок оцінено за каталогом іншого видавця, це вказано поруч із його вартістю.`,
    ownFigures: (collector, currency) =>
      `Спільного каталогу для цього обміну не погоджено, тому вартість — власна оцінка (${collector}), у ${currency}. Для кожного рядка вказано, за яким каталогом і виданням його оцінено.`,
    frozen: "Це вартість на момент погодження, а не сьогоднішня.",
    convertedAt: "Перераховано за курсом",
    groupBy: "Групувати за",
    groupLevel: { area: "Територія", year: "Рік", issue: "Серія", condition: "Стан" },
    noArea: "Без території",
    noYear: "Без року",
    noIssue: "Без серії",
    unnamedIssue: "(серія без назви)",
    noCondition: "Без стану",
    total: "Разом",
    notPriced: "Без оцінки",
    stamps: { one: "марка", few: "марки", many: "марок", other: "марки" },
    lines: { one: "рядок", few: "рядки", many: "рядків", other: "рядка" },
    notes: { one: "нотатка", few: "нотатки", many: "нотаток", other: "нотатки" },
    emptySide: "З цього боку нічого немає.",
    truncated: (lines) => `Показано лише перші ${lines} цього боку.`,
    stamp: "Марка",
    variantNotSpecified: "варіант не вказано",
    estimate: "орієнтовно",
    ownFigure: "власна оцінка",
    withdrawn: "Відкликано",
    neverArrived: "Не дійшло",
    notWanted: "Не потрібно",
    cannotSend: "Не можу надіслати",
    sideSummary: (notes, marked, mark) =>
      `З цього боку ви залишили: ${both([notes, marked !== null ? `${marked} × «${mark.toLowerCase()}»` : null], "і")}.`,
    saving: "Збереження…",
    saved: "Збережено",
    saveFailed: "Не вдалося зберегти.",
    change: "Змінити",
    addNote: "Додати нотатку",
    lineNoteLabel: "Нотатка до цього рядка",
    yourComments: "Ваші коментарі",
    feedbackIntro: (collector) =>
      `Позначте рядок, який вам не потрібен, або додайте до нього нотатку — ${collector} бачить усе, що ви тут залишите, і ніщо з написаного не змінює сам список. Поле нижче — для всього, що стосується обміну загалом.`,
    tradeNotePlaceholder: "Нотатка до всього обміну",
    tradeNoteLabel: "Нотатка до всього обміну",
    feedbackFinished:
      "Цей обмін завершено, тому список більше не приймає коментарів. Усе, що вже сказано, показано нижче.",
    feedbackClosed: (status) => `Статус цього обміну — «${status}», він більше не приймає коментарів.`,
    choicePrompt: (n) => `Підійде будь-який із цих примірників (${n}) — який ви хочете?`,
    choiceHint:
      "Вибір тут нічого не вирішує — це прохання, яке підтверджує ваш партнер. Вибір уже обраного примірника відкликає прохання.",
    chosenNow: "Обрано зараз",
    youAsked: "Ви просили цей",
    copyNo: (n) => `Примірник ${n}`,
    noScan: "Немає скану",
    choicePreparing: "Список ще складається, тому вибір примірника поки не відкритий.",
    choiceSettled: (status) => `Статус цього обміну — «${status}», тому вирішено, який примірник буде надіслано.`,
    unanswered: (status) => `Ви просили інший примірник; обмін отримав статус «${status}» з показаним примірником.`,
  },
};

/** The languages the partner's page has its own words in. */
export const TRADE_SHARE_LABEL_LANGUAGES: readonly string[] = Object.keys(LABELS).sort();

/** Whether the page has its own words in `language` — false sends it to English, which the
 *  collector's share dialog states. */
export function hasTradeShareLabels(language: string | null): boolean {
  const code = normalizeLanguage(language);
  return !!code && code in LABELS;
}

/** The page's words in `language`, or English where it has none. */
export function tradeShareLabels(language: string | null): TradeShareLabels {
  const code = normalizeLanguage(language);
  return (code && LABELS[code]) || EN;
}

/** The language the words actually come out in — `language` itself, or `en` where it has none. */
export function tradeShareLabelLanguage(language: string | null): string {
  const code = normalizeLanguage(language);
  return code && code in LABELS ? code : "en";
}

/** *3 stamps*, *3 znaczki*, *5 znaczków* — the count with its noun in the language's plural form. */
export function tradeShareCount(
  language: string | null,
  count: number,
  noun: (labels: TradeShareLabels) => PluralForms
): string {
  const forms = noun(tradeShareLabels(language));
  const category = new Intl.PluralRules(tradeShareLabelLanguage(language)).select(count);
  return `${count} ${forms[category] ?? forms.other}`;
}

/** What a side carries: *12 stamps (9 lines)*, or only the stamps where every line is one. */
export function tradeShareCountText(
  language: string | null,
  totals: { lines: number; pieces: number }
): string {
  const stamps = tradeShareCount(language, totals.pieces, (l) => l.stamps);
  if (totals.pieces === totals.lines) return stamps;
  return `${stamps} (${tradeShareCount(language, totals.lines, (l) => l.lines)})`;
}

/**
 * What one side of the partner's page says it is carrying (#667), or null for nothing said yet.
 *
 * The count is at the head of the column because the answers are **scattered down** it: a partner
 * who left four remarks on a list of two hundred lines has no way to know they left four, and no way
 * to find them again but by re-reading the list. Notes and marks are counted **apart** — they are
 * different acts, and *5 things* would not say that one of them takes a line off the exchange. The
 * mark's word is the one on the row's chip ({@link tradeShareRejectLabel}).
 */
export function tradeShareSideSummary(
  language: string | null,
  side: TradeSide,
  counts: { notes: number; rejected: number }
): string | null {
  if (counts.notes === 0 && counts.rejected === 0) return null;
  const words = tradeShareLabels(language);
  return words.sideSummary(
    counts.notes > 0 ? tradeShareCount(language, counts.notes, (l) => l.notes) : null,
    counts.rejected > 0 ? counts.rejected : null,
    tradeShareRejectLabel(language, side)
  );
}

/** What striking a line out is called on the partner's page, per side — `tradeFeedbackRejectLabel` in
 *  the page's language: of the collector's material *not wanted*, of the partner's own *cannot send*. */
export function tradeShareRejectLabel(language: string | null, side: TradeSide): string {
  const words = tradeShareLabels(language);
  return side === "give" ? words.notWanted : words.cannotSend;
}
