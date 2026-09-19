// **How an auction sale's screen is being looked at** (#1353) — the vocabulary, the precedence and
// the narrowing rule, kept pure and out of the two components so a test can read them.
//
// `lot-params.ts` one directory up is the same shape for the flat watchlist, and the two are
// deliberately alike: a toolbar's state is a value with names, defaults and a stated answer to
// *does this narrow what I am looking at*, not a scattering of `useState`s. What differs is where
// the narrowing happens. The flat list asks the server; a parcel is already in hand, so every
// filter here is applied in the browser — and the toolbar reaches across **two** units at once,
// which is the one thing this module exists to keep straight:
//
//  - **lots** — the status chips and *not described*: whole cards leave the screen;
//  - **lines** — *unpriced*, *no photo*, *unknown variant*: the composition inside a card is
//    narrowed and the card itself stays.
//
// `notDescribed` is the awkward one, and the awkwardness is real rather than an accident of
// placement. It sits under **Only** beside *no photo* because that is where the collector asked
// for it (2026-09-19), and it asks about a lot — *nothing recorded in its composition* (#353) —
// while its neighbours ask about a line. With **Group by → Lot** off there are no lots on screen,
// only the parcel's stamps in one list, and a lot with nothing in it contributes nothing to that
// list: the filter could only ever empty the screen. So it is **offered and in force only while
// the lots are on screen**, and switching the grouping off clears it outright rather than leaving
// it latched where it cannot act — the collector's decision of 2026-09-19, taken over showing an
// explanatory empty list. {@link resolveAuctionSaleView} enforces it on the way in, so a
// hand-edited address cannot get round it, and {@link auctionSaleViewUpdatesFor} clears the stored
// and addressed copies on the way out, so it does not come back when the grouping returns.

import { COPY_SORT_KEYS, type CopySortKey } from "@/lib/copy-sort";
import { LOT_SIGNALS, type LotSignal } from "@/lib/auction-lot";
import { isAuctionLotOutcome, type AuctionLotOutcome } from "@/lib/auction-rules";

/** Everything the toolbar over a sale's lots decides. */
export interface AuctionSaleView {
  /** A derived state — still biddable, outbid, leading… At most one, like the flat list's. */
  signal?: LotSignal;
  /** How the bidding went. At most one. */
  outcome?: AuctionLotOutcome;
  /** `lot` draws a card per lot; `none` flattens the parcel into one list of lines. */
  group: "lot" | "none";
  /** Sub-group the lines by issue, inside whichever of the two is showing. */
  byIssue: boolean;
  /** Lines with no catalogue price. */
  unpriced: boolean;
  /** Lines with no photo. */
  noPhoto: boolean;
  /** Lines recorded against an umbrella rather than a known variant. */
  unknownVariant: boolean;
  /** **Lots** with nothing recorded in their composition (#353) — see the note at the top. */
  notDescribed: boolean;
  sortKey: CopySortKey;
  sortDir: "asc" | "desc";
}

/**
 * What the screen shows with nothing said. **A default is never written** — to the address or to
 * the memory — so a parcel nobody has narrowed keeps a clean URL and an empty stored set, which is
 * #844's second guard and what keeps *Clear filters* from having anything left to undo.
 */
export const AUCTION_SALE_VIEW_DEFAULTS: AuctionSaleView = {
  signal: undefined,
  outcome: undefined,
  group: "lot",
  byIssue: false,
  unpriced: false,
  noPhoto: false,
  unknownVariant: false,
  notDescribed: false,
  sortKey: "added",
  sortDir: "asc",
};

/**
 * The search param each setting travels as.
 *
 * Typed over **every** key of {@link AuctionSaleView}, for `lot-params.ts`' reason: a control added
 * to the toolbar fails to compile until somebody has said what it is called in the address, which
 * is the only thing standing between "remembered" and "remembered except for the one nobody wired
 * up". Three names differ from their field — `notDescribed` travels as `undescribed`, the name the
 * flat watchlist's own *Not described* filter already uses (#442), and the two sort fields as the
 * short `sort`/`dir` a reader of the address bar can take in.
 */
const VIEW_PARAM: { [K in keyof Required<AuctionSaleView>]-?: string } = {
  signal: "signal",
  outcome: "outcome",
  group: "group",
  byIssue: "byIssue",
  unpriced: "unpriced",
  noPhoto: "noPhoto",
  unknownVariant: "unknownVariant",
  notDescribed: "undescribed",
  sortKey: "sort",
  sortDir: "dir",
};

/** The params this screen tracks, for `usePersistedFilterParams` and for the address mirror. */
export const AUCTION_SALE_VIEW_PARAMS: readonly string[] = Object.values(VIEW_PARAM);

const VIEW_KEYS = Object.keys(VIEW_PARAM) as (keyof AuctionSaleView)[];

/**
 * The view in force, from whatever answers for a param — the URL where it names one, the
 * remembered set otherwise. `readParam` is `usePersistedFilterParams`' reader, so that precedence
 * is decided there and this only has to validate.
 *
 * **Every value is checked against what exists**, because both homes can hold a stale one: a
 * bookmarked link written before a signal was renamed, or a stored set from an older build. An
 * unrecognised value falls back to the default rather than narrowing to nothing — a link that has
 * aged should show the parcel, not an empty screen.
 */
export function resolveAuctionSaleView(
  readParam: (key: string) => string | null
): AuctionSaleView {
  const flag = (key: string) => readParam(key) === "1";
  const signalRaw = readParam(VIEW_PARAM.signal) ?? "";
  const outcomeRaw = readParam(VIEW_PARAM.outcome) ?? "";
  const sortRaw = readParam(VIEW_PARAM.sortKey) ?? "";
  const group = readParam(VIEW_PARAM.group) === "none" ? "none" : "lot";
  return {
    signal: LOT_SIGNALS.includes(signalRaw as LotSignal) ? (signalRaw as LotSignal) : undefined,
    outcome: isAuctionLotOutcome(outcomeRaw) ? outcomeRaw : undefined,
    group,
    byIssue: flag(VIEW_PARAM.byIssue),
    unpriced: flag(VIEW_PARAM.unpriced),
    noPhoto: flag(VIEW_PARAM.noPhoto),
    unknownVariant: flag(VIEW_PARAM.unknownVariant),
    // Lot-level, and there are no lots on screen with the grouping off — the note at the top.
    notDescribed: group === "lot" && flag(VIEW_PARAM.notDescribed),
    sortKey: COPY_SORT_KEYS.includes(sortRaw as CopySortKey) ? (sortRaw as CopySortKey) : "added",
    sortDir: readParam(VIEW_PARAM.sortDir) === "desc" ? "desc" : "asc",
  };
}

/** One setting as the address carries it, or `""` where it is at its default and is not written. */
function serialize(key: keyof AuctionSaleView, view: Partial<AuctionSaleView>): string {
  const value = view[key];
  if (value === undefined || value === false) return "";
  if (value === AUCTION_SALE_VIEW_DEFAULTS[key]) return "";
  return value === true ? "1" : String(value);
}

/**
 * The param updates one change to the toolbar amounts to — the shape the screen's single
 * `updateParams` funnel takes, where `""` deletes.
 *
 * **Only the keys named are written**, so a press says what it changed and nothing else, and a
 * setting restored from memory is not dragged into the address by an unrelated press. The one
 * addition is the rule at the top of this file: switching the grouping off takes *not described*
 * with it, in the same write, because a filter that cannot act must not sit latched waiting to
 * surprise the collector when the grouping comes back.
 */
export function auctionSaleViewUpdatesFor(patch: Partial<AuctionSaleView>): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    if (!(key in patch)) continue;
    updates[VIEW_PARAM[key]] = serialize(key, patch);
  }
  if (patch.group === "none") updates[VIEW_PARAM.notDescribed] = "";
  return updates;
}

/**
 * One filter **narrowing** what is on screen, as the band above the lots reports it (#1018's shape,
 * over a parcel): the field it came from, and the value it is set to.
 *
 * The wording is deliberately not here, for the reason `lot-params.ts` gives: every one of these
 * has a control on the toolbar already, and the band has to name it in *that control's own words*
 * or it points at nothing. What lives here is the harder half — **which** settings narrow.
 */
export interface AuctionSaleNarrowing {
  key: keyof AuctionSaleView;
  /** The raw value, for the panel to look a label up by. `"1"` for the boolean chips. */
  value: string;
}

/**
 * Which settings narrow, keyed the way {@link VIEW_PARAM} is and for the same reason: typed over
 * **every** key, so a control added later fails to compile until somebody has decided whether it
 * hides anything.
 *
 * `null` means *this one does not narrow*, and there are four. `group` and `byIssue` are how the
 * parcel is **read** — flattening it or sub-grouping it hides nothing — which is the line the flat
 * watchlist draws around `groupBySale` and the Copies list around its own grouping; `sortKey` and
 * `sortDir` are an order, and an order hides nothing either. All four are therefore left alone by
 * *Clear filters* as well: a collector who cleared the filters and found his grouping reset would
 * have lost something the band never claimed to be holding.
 */
const VIEW_NARROWS: {
  [K in keyof Required<AuctionSaleView>]-?:
    | null
    | ((value: NonNullable<AuctionSaleView[K]>) => string | null);
} = {
  signal: (value) => value,
  outcome: (value) => value,
  group: null,
  byIssue: null,
  unpriced: (value) => (value ? "1" : null),
  noPhoto: (value) => (value ? "1" : null),
  unknownVariant: (value) => (value ? "1" : null),
  notDescribed: (value) => (value ? "1" : null),
  sortKey: null,
  sortDir: null,
};

/** Every setting currently narrowing the screen, in the order the toolbar reads. */
export function auctionSaleViewNarrowings(view: AuctionSaleView): AuctionSaleNarrowing[] {
  const out: AuctionSaleNarrowing[] = [];
  for (const key of VIEW_KEYS) {
    const describe = VIEW_NARROWS[key];
    if (!describe) continue;
    const value = view[key];
    if (value === undefined || value === false) continue;
    const described = (describe as (value: unknown) => string | null)(value);
    if (described !== null) out.push({ key, value: described });
  }
  return out;
}

/**
 * Whether any filter in force takes whole **lots** off the screen, which is what decides whether
 * the band can honestly count them.
 *
 * With only the line filters on, every lot is still there and a *Showing 12 of 12 lots* would be
 * true but useless — it would read as a count of what the filters did, over the one unit they did
 * not touch. The band says *This view is narrowed* instead and lets the named filters speak.
 */
export function auctionSaleViewNarrowsLots(view: AuctionSaleView): boolean {
  return Boolean(view.signal || view.outcome || view.notDescribed);
}

/**
 * Back to the whole parcel in one press — `""` for every setting that narrows, and nothing for the
 * four that do not.
 *
 * Written from {@link VIEW_NARROWS} rather than by hand so the band and the button cannot disagree:
 * a filter the band announces and the button misses is a *Clear filters* that leaves the banner up.
 */
export function auctionSaleViewClearUpdates(): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    if (VIEW_NARROWS[key]) updates[VIEW_PARAM[key]] = "";
  }
  return updates;
}

/**
 * The view in force, written **back into the address** — #844's missing half, applied here.
 *
 * A setting restored from memory and applied to the screen but never written to the URL leaves a
 * reload, a Back press and a copied link with nothing to read, which is exactly the reset #1353
 * reports. One rule makes it safe to run on every render: **only a value that differs from both the
 * default and the address is written**. Everything else follows from it —
 *
 *  - it returns `null` where the address already says what the screen shows, so it writes once;
 *  - a parcel nobody has narrowed keeps a clean address, rather than acquiring `?group=lot&sort=added`
 *    on arrival, because every one of its settings serialises to `""` and `""` is never written.
 *    That is #844's second guard, and it is a consequence here rather than a separate test — an
 *    explicit early return for it was carried for a while and deleted once it was shown to be
 *    unreachable (nothing reached it that the loop did not already handle).
 *
 * Clearing is not its job and must not be: a filter switched off leaves the URL through the press
 * itself, and a mirror that also deleted params would race that write.
 */
export function auctionSaleViewUrlUpdates(
  view: AuctionSaleView,
  urlValue: (key: string) => string | null
): Record<string, string> | null {
  const wanted: Record<string, string> = {};
  for (const key of VIEW_KEYS) wanted[VIEW_PARAM[key]] = serialize(key, view);
  const updates: Record<string, string> = {};
  for (const [param, value] of Object.entries(wanted)) {
    if (!value) continue;
    if ((urlValue(param) ?? "") !== value) updates[param] = value;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}
