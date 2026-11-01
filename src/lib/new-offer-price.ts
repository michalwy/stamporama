// The figure the *New offer* form suggests from the copies going in (#2302) — the pure half, so the
// unit suite holds the rule the dialog draws.
//
// An offer's price is the price of **one set**, what a buyer takes, so the suggestion is one set's
// figure and the packaging the collector chose decides it (settled with the collector on 2026-11-01):
//
//  - **One set holding every copy** — a series, a lot sold together — is priced at the **sum** of
//    the copies' figures, whatever the stamps.
//  - **One single-copy set each** — a quantity of interchangeable singles — is priced at **one
//    piece's** figure, and only when every copy has the same one (#1829's rule). Copies whose
//    figures differ have no one price per set, so nothing is suggested.
//
// Either way **a copy with no figure leaves no suggestion**, and the result says how many copies
// have none, so a sum never looks complete while it is not. The same rule serves the Estimated
// value the price is seeded with (#1829) and the catalogue value a Facebook group's opening share is
// taken of (#1663).

/** How the copies go into the new offer: all in one set, or one single-copy set each (#373). */
export type NewOfferPackaging = "one-set" | "per-copy";

export type NewOfferFigure =
  /** The suggested figure, 2-dp. `summed` when it adds up several copies. */
  | { kind: "figure"; amount: string; summed: boolean }
  /** `missing` of the copies have no figure. */
  | { kind: "missing"; missing: number }
  /** One set each, and the copies' figures differ. */
  | { kind: "differ" }
  /** No copies. */
  | { kind: "none" };

const cents = (amount: string) => Math.round(Number(amount) * 100);

/** One set's figure from each copy's (null where the copy has none), under `packaging`. */
export function newOfferFigure(
  figures: readonly (string | null | undefined)[],
  packaging: NewOfferPackaging
): NewOfferFigure {
  if (figures.length === 0) return { kind: "none" };
  const priced = figures.filter((f): f is string => f != null && f !== "").map(cents);
  const missing = figures.length - priced.length;
  if (missing > 0) return { kind: "missing", missing };
  if (priced.length === 1) return { kind: "figure", amount: (priced[0] / 100).toFixed(2), summed: false };
  if (packaging === "one-set") {
    const total = priced.reduce((sum, c) => sum + c, 0);
    return { kind: "figure", amount: (total / 100).toFixed(2), summed: true };
  }
  return priced.every((c) => c === priced[0])
    ? { kind: "figure", amount: (priced[0] / 100).toFixed(2), summed: false }
    : { kind: "differ" };
}

/** The suggested amount, or "" where there is none. */
export function newOfferFigureAmount(figure: NewOfferFigure): string {
  return figure.kind === "figure" ? figure.amount : "";
}
