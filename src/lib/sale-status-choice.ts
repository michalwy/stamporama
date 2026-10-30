/**
 * A sale's status as the collector chose it, ahead of its save (#2270).
 *
 * A status change shows the moment it is chosen and saves behind it, without the sale page being
 * read again — so the screen carries the chosen status over the one the page was drawn with until
 * the two agree. The rules:
 *
 * - **The last one chosen is what shows.** Choosing again does not wait for the save before it;
 *   Next runs server actions one at a time, in the order they were called, so the last chosen is
 *   also the last written.
 * - **A failed save puts back what was there**: the status last saved, or the page's own when
 *   nothing was. Only the latest choice's failure moves the screen — an earlier one failing under a
 *   later choice has already been overtaken by it.
 * - **A fresh page reading wins once nothing is in flight**: it carries every save that came back,
 *   so the choice has nothing left to add. One that lands while a save is out is from before it,
 *   and the choice stays over it.
 */

export interface SaleStatusChoice {
  /** The status drawn over the page's, or null to draw the page's own. */
  shown: string | null;
  /** The status the last successful save wrote, or null when none has come back since the page was
   *  read. What a failed save falls back to. */
  saved: string | null;
  /** The number of the latest choice, which is the only one whose failure moves the screen. */
  latest: number;
  /** Saves not yet come back. */
  inFlight: number;
}

export type SaleStatusChoiceEvent =
  | { type: "chose"; status: string }
  | { type: "settled"; seq: number; status: string; ok: boolean }
  | { type: "pageRead" };

export const NO_SALE_STATUS_CHOICE: SaleStatusChoice = { shown: null, saved: null, latest: 0, inFlight: 0 };

export function saleStatusChoiceReducer(
  state: SaleStatusChoice,
  event: SaleStatusChoiceEvent
): SaleStatusChoice {
  switch (event.type) {
    case "chose":
      return { ...state, shown: event.status, latest: state.latest + 1, inFlight: state.inFlight + 1 };
    case "settled": {
      const inFlight = Math.max(0, state.inFlight - 1);
      if (event.ok) return { ...state, saved: event.status, inFlight };
      if (event.seq !== state.latest) return { ...state, inFlight };
      return { ...state, shown: state.saved, inFlight };
    }
    case "pageRead":
      return state.inFlight > 0 ? state : { ...state, shown: null, saved: null };
  }
}

/** The status to draw: the chosen one over the page's own. */
export function shownSaleStatus(choice: SaleStatusChoice, pageStatus: string): string {
  return choice.shown ?? pageStatus;
}

/** A status saved without the page being read again, and the page's status it was chosen over. */
export interface SavedSaleStatus {
  over: string;
  status: string;
}

/**
 * The choice a sale's page starts from. A page the router brings back from its cache is the reading
 * from before a save — it still carries the status the save was chosen over — so the saved status is
 * drawn over it. Any other status means the reading has caught up, and it is drawn as it is.
 */
export function restoredSaleStatusChoice(
  saved: SavedSaleStatus | undefined,
  pageStatus: string
): SaleStatusChoice {
  if (!saved || saved.over !== pageStatus) return NO_SALE_STATUS_CHOICE;
  return { ...NO_SALE_STATUS_CHOICE, shown: saved.status, saved: saved.status };
}
