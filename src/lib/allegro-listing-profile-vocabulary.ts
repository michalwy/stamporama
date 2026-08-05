// Allegro's own vocabularies a listing profile is written in (#486; ADR-0025) — pure, no Prisma and
// no `server-only`, because the settings editor is a client component and these are exactly what its
// two plain selects are built from.
//
// They are **Allegro's** lists, not this app's: the values are what `POST /sale/product-offers`
// accepts, and the labels are only how they read on screen. Kept here rather than as database enums
// so a value Allegro adds is a one-line change instead of a migration — and kept out of
// `allegro-listing-profile.ts` so that the browser can read them without pulling the server module's
// Prisma import along with it.

/** Handling times, as the ISO-8601 durations Allegro states them in, in the order a seller reads
 *  them. Deliberately not a number of days: `PT0S` and `PT24H` are not days, and re-deriving
 *  Allegro's wording from an integer is a translation with nothing to gain. */
export const ALLEGRO_HANDLING_TIMES: { value: string; label: string }[] = [
  { value: "PT0S", label: "Same day" },
  { value: "PT24H", label: "1 working day" },
  { value: "P2D", label: "2 working days" },
  { value: "P3D", label: "3 working days" },
  { value: "P4D", label: "4 working days" },
  { value: "P5D", label: "5 working days" },
  { value: "P7D", label: "7 working days" },
  { value: "P10D", label: "10 working days" },
  { value: "P14D", label: "14 working days" },
  { value: "P21D", label: "21 working days" },
  { value: "P30D", label: "30 working days" },
  { value: "P60D", label: "60 working days" },
];

/**
 * How long a listing runs, as Allegro's **sale form** offers it (#493).
 *
 * A second vocabulary rather than a reuse of the handling times above, and the difference is the
 * whole point: the API states the same durations in a different notation (`P3D` where the form says
 * `PT72H`), so a value stored for one path does not select an option on the other. What is stored
 * here is the form's own, and the module matches an option by **how long it is** rather than by the
 * string, so either notation lands on the right row.
 *
 * Only the durations both of the form's two selects offer are listed: a fixed-price listing may also
 * run 20 or 30 days and an auction may run 1, but a profile is one setting used by whichever format
 * the offer turns out to be, and a value only one of them accepts is a value that silently does
 * nothing on the other.
 */
export const ALLEGRO_LISTING_DURATIONS: { value: string; label: string }[] = [
  { value: "PT72H", label: "3 days" },
  { value: "PT120H", label: "5 days" },
  { value: "PT168H", label: "7 days" },
  { value: "PT240H", label: "10 days" },
];

/** What a listing promises about invoicing (`payments.invoice`). A private collector sells without
 *  one, which is why that leads and is the column default. */
export const ALLEGRO_INVOICE_TYPES: { value: string; label: string }[] = [
  { value: "NO_INVOICE", label: "No invoice" },
  { value: "VAT", label: "VAT invoice" },
  { value: "WITHOUT_VAT", label: "Invoice without VAT" },
];

export function isAllegroHandlingTime(value: string): boolean {
  return ALLEGRO_HANDLING_TIMES.some((h) => h.value === value);
}

/** Whether a stored duration is one this app offers. Null — "leave the form as served" — is a state
 *  rather than a value and is not asked about here. */
export function isAllegroListingDuration(value: string): boolean {
  return ALLEGRO_LISTING_DURATIONS.some((d) => d.value === value);
}

export function isAllegroInvoiceType(value: string): boolean {
  return ALLEGRO_INVOICE_TYPES.some((i) => i.value === value);
}
