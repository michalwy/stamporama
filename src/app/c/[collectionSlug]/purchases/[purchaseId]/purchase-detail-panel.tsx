"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  ConfirmDialog,
  LabelWithError,
} from "@/app/dialog-shell";
import { type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { defaultTreeSelectButtonClassName } from "@/app/tree-select";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import { parseDispositionFilter, parseLotCopyFilter } from "@/lib/intake-filter-params";
import type {
  CopyDispositionFilter,
  ItemListItem,
  LotCopyFilter,
  LotCopySort,
} from "@/lib/items";
import type { IssueHeader } from "@/lib/issues";
import type { ChecklistSetCompleteness } from "@/lib/lot-set-completeness";
import type { PurchaseDetail, LotSummary } from "@/lib/lots";
import {
  EMPTY_SELECTION,
  containerBoxState,
  dropDispositionContainers,
  dropFilteredContainers,
  isRowSelected,
  resolveSelection,
  toggleContainer,
  toggleRow,
  type CopyContainer,
  type CopyRef,
  type CopySelection,
} from "@/lib/lot-selection";
import {
  useLotCopiesInfinite,
  usePurchaseCopiesInfinite,
  useLotSummary,
  usePurchaseSummary,
  usePurchaseReturn,
  useLotReturn,
  useLotSetCompleteness,
  usePurchaseSetCompleteness,
  useInvalidateLotCopies,
  useLocationRefUsage,
  useLotSelectionCount,
  bulkScopeFields,
  type BulkScopeClient,
  type IntakeFilterParams,
  type LotCopiesParams,
} from "./use-lot-copies-query";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import {
  DELIVERY_STATES,
  deliveryStateLabel,
  deliveryStateToken,
} from "@/lib/delivery-state";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
import {
  useCollectionFormats,
  useCollectionLocations,
  useInvalidateInventory,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { PhotoEditor, type PhotoEditorValue } from "@/app/c/[collectionSlug]/inventory/photo-editor";
import { IdentifyVariantDialog } from "@/app/c/[collectionSlug]/inventory/identify-variant-dialog";
import { WantReviewDialog } from "@/app/c/[collectionSlug]/wants/want-review-dialog";
import type { ArrivingCopy } from "@/lib/want-rules";
import type { WantMatchForCopy } from "@/lib/wants";
import { AttachCopiesDialog } from "./attach-copies-dialog";
import { IntakeHoldingsLine } from "./intake-holdings-line";
import { IntakeCatalogValueField } from "./intake-catalog-value";
import {
  catalogValueEntry,
  EMPTY_INTAKE_CATALOG_VALUE,
  type IntakeCatalogValue,
} from "@/lib/intake-catalog-value";
import { PurchaseScansCard } from "./purchase-scans-card";
import { IdentifiedPieceAside, type IdentifiedPiece } from "./tile-zoom-view";
import { useInvalidatePurchaseScans } from "./use-purchase-scans-query";
import { useInvalidatePurchases } from "../use-purchases-query";
import { useAreaVendorMaps, type AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  STUCK_SHADOW,
  useMeasuredHeight,
  useStuck,
} from "@/app/c/[collectionSlug]/shared/sticky-header";
import { HoldingsSummaryBar } from "@/app/c/[collectionSlug]/shared/holdings-summary-bar";
import { LotIssueGroupHeader } from "@/app/c/[collectionSlug]/shared/lot-issue-group-header";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import {
  useHydrated,
  usePersistentToggle,
  usePersistentString,
} from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  usePurchaseCollapsedGroups,
  usePurchaseDispositionFilter,
  usePurchaseLotExpansion,
  usePurchaseLotFilter,
} from "@/app/c/[collectionSlug]/shared/purchase-ui-state";
import { ORDER_GROUP_SCOPE } from "@/lib/purchase-ui-state";
import {
  readLast,
  writeLast,
  LS_LAST_CONDITION,
  LS_LAST_CERT,
  LS_LAST_LOCATION,
  LS_LAST_DISPOSITION,
  LS_LAST_SCAN_LOT,
} from "@/app/c/[collectionSlug]/shared/add-copy-defaults";
import {
  StampPickerBrowser,
  type PickedIssue,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-browser";
import {
  pickedStampText,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { useJustAdded } from "@/app/c/[collectionSlug]/shared/use-just-added";
import { useCardExpansion } from "@/app/c/[collectionSlug]/shared/use-card-expansion";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { Icon } from "@/app/icons";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/** The label in front of a group of toolbar controls ("Group by", "Sort copies") — the same shape
 *  the offer and auction-sale toolbars use, which is what lets the three read as one control row. */
const TOOLBAR_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

// The tree-select trigger defaults to a compact toolbar height (min-h-8). In the intake dialog
// it sits beside an INPUT_STYLE ref field, so bump its min-height + vertical padding to line the
// two controls up (mirrors the inventory copy form).
const LOCATION_SELECT_BUTTON_CLASS = defaultTreeSelectButtonClassName
  .replace("min-h-8", "min-h-9")
  .replace("py-1", "py-2");

const PURCHASE_STATUS: Record<string, { label: string; token: string }> = {
  preparing: { label: "Preparing", token: "muted" },
  in_transit: { label: "In transit", token: "accent" },
  arrived: { label: "Arrived", token: "success" },
};

// Purchase delivery status in lifecycle order, for the inline status select (#141).
const PURCHASE_STATUS_ORDER = ["preparing", "in_transit", "arrived"];

// The inline row dropdown offers the states in the shared lifecycle order (#121) — see
// `DELIVERY_STATES` in `@/lib/delivery-state`.

// The happy-path copy progression for the per-copy quick-advance button (#159): each step
// advances one state along this line. "delivered" is terminal (no button), and the exception
// outcomes (not_delivered, damaged) are off this path, so a copy in one shows no advance
// button either.
const DELIVERY_ADVANCE_ORDER = ["ordered", "in_transit", "to_sort", "delivered"];

/** The disposition flags a lot copy can carry, in display order. */
const DISPOSITION_FLAGS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

/** The same three, as the order-level *Kept for* filter (#622). Labelled identically to the flags
 * above on purpose: the chip that files a copy *For sale* and the chip that shows only the for-sale
 * copies are about one thing, and two vocabularies for it would read as two. */
const DISPOSITION_FILTERS: readonly {
  key: CopyDispositionFilter;
  label: string;
  hint: string;
}[] = [
  {
    key: "in-collection",
    label: "In collection",
    hint: "Show only the copies kept for the collection",
  },
  { key: "for-sale", label: "For sale", hint: "Show only the copies kept as stock" },
  { key: "for-trade", label: "For trade", hint: "Show only the copies kept for trading" },
];

function tintChip(token: string, label: string): { style: React.CSSProperties; label: string } {
  if (token === "muted") return { style: CHIP, label };
  return {
    label,
    style: {
      ...CHIP,
      color: `var(--color-${token})`,
      borderColor: `var(--color-${token}-border, var(--color-border))`,
      background: `var(--color-${token}-soft, var(--color-bg-page))`,
    },
  };
}

interface PurchaseDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  /** The resolution this collection's cards are scanned at (#598), carried down to the tile viewer
   * where the ruler and the perforation gauge live. */
  scanDpi: number;
  purchase: PurchaseDetail;
  issueHeaderById: Record<string, IssueHeader>;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
}

/**
 * Everything one tile was identified as (#595) — the whole of the condition step's answers, plus the
 * stamp that got there.
 *
 * The catalogue value is deliberately **not** here. It is a fact about a stamp that is already
 * recorded, so the field prefills itself from what was written for this stamp × condition ×
 * certificate × format (#593); carrying a figure across would be typing the same price twice.
 */
interface TileIdentification {
  stampId: string;
  /** The pick as the condition step's summary box words it. */
  label: string;
  /** The pick in one catalogue number, for an action that has to fit on a button. */
  shortLabel: string;
  conditionId: string;
  certificateStatusId: string;
  formatId: string;
  locationId: string;
  locationRef: string;
  disposition: { inCollection: boolean; forSale: boolean; forTrade: boolean };
  lotId: string;
}

/**
 * A correction in flight: which tile is being identified again, and what its copy answers **now**.
 *
 * The prefill is built where the tile is — from `ScanTileData.item`, which the scans card already
 * holds — rather than fetched at the far end of the chain: it is the copy as the strip last read it,
 * and a second read three dialogs later would be a second answer to a question already in hand.
 * `stampId` rides along for the picker's *current* mark, so the tree says where the copy already
 * sits instead of leaving the collector to check it on the other side of the screen.
 */
interface TileCorrection {
  tileId: string;
  stampId: string;
  prefill: NonNullable<IntakeConditionDialogProps["prefill"]>;
}

/** The condition step's answers as the intake write is given them (#595). One field is absent from
 * the form when the collection defines no formats and another when it has no locations, so every
 * read falls back to the empty string — the same "not chosen" the fields themselves start at. */
function tileAnswersFrom(fd: FormData): Omit<TileIdentification, "stampId" | "label" | "shortLabel"> {
  const text = (key: string) => String(fd.get(key) ?? "");
  return {
    conditionId: text("conditionId"),
    certificateStatusId: text("certificateStatusId"),
    formatId: text("formatId"),
    locationId: text("locationId"),
    locationRef: text("locationRef"),
    disposition: {
      inCollection: text("inCollection") === "true",
      forSale: text("forSale") === "true",
      forTrade: text("forTrade") === "true",
    },
    lotId: text("lotId"),
  };
}

export function PurchaseDetailPanel({
  collectionId,
  collectionSlug,
  scanDpi,
  purchase,
  issueHeaderById,
  areas,
  locations: serverLocations,
  conditions,
  certificateStatuses,
}: PurchaseDetailPanelProps) {
  const router = useRouter();
  // Storage locations, re-read client-side rather than taken from the server render (#624). Filing
  // a parcel is exactly when a collector realises a new location is needed, and they add it in
  // another tab: the picker here has to reflect that without a reload, which a prop from the RSC
  // pass never can. The server-rendered list stands in until the first read answers, so the first
  // paint is unchanged.
  const locations = useCollectionLocations(collectionId).data ?? serverLocations;
  const { invalidateLotCopies } = useInvalidateLotCopies();
  // The purchase list is a client-side infinite query with a 30s stale time, so it survives a
  // back-navigation from here and would keep showing the pre-edit delivery status (#440).
  const { invalidateList: invalidatePurchaseList } = useInvalidatePurchases();
  // What the catalogue screens say about a stamp — held counts, want state, the stamp's own
  // photo — all move when a copy is taken in, and none of it lives in the two namespaces above.
  const { invalidateList: invalidateInventory } = useInvalidateInventory();
  const [isPending, startTransition] = useTransition();
  const [addingLot, setAddingLot] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Briefly highlight a lot right after it is created, so the new card is easy to spot once
  // the panel refreshes with it (#158).
  const [justAddedLotId, markLotAdded] = useJustAdded();
  // Which lot the collector arrived to see (#387). A copy's "Go to purchase" lands here with
  // `?lot=<id>`; the card for it opens, scrolls into view and stays marked — the same arrival
  // treatment an auction sale gives #374's deep link.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const highlightLotId = searchParams.get("lot");
  // Clearing the mark drops that one param and `replace`s, so undoing a highlight is not a step
  // to walk back through.
  function clearHighlight() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lot");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
  // Lot cards are collapsed by default (#382): an order is read as its lots, and a lot's copies
  // are a second question. A lot added while the screen is open opens itself, as does the one
  // that was navigated to.
  // Remembered per order, so a part-finished intake pass resumes where it stopped rather than
  // being clicked back into shape after every reload.
  const lotExpansionStore = usePurchaseLotExpansion(collectionId, purchase.id);
  const lotExpansion = useCardExpansion(
    purchase.lots.map((l) => l.id),
    highlightLotId,
    lotExpansionStore
  );

  // Order-level grouping of the copies view (#121): group by lot and/or by issue. Both off is
  // a flat list of every copy in the order. Persisted per collection; default groups by both.
  const [byLot, setByLot] = usePersistentToggle(`${LS_GROUP_BY_LOT}:${collectionId}`, true);
  const [byIssue, setByIssue] = usePersistentToggle(`${LS_GROUP_BY_ISSUE}:${collectionId}`, true);

  // Sort order for the copies shown inside each lot (and inside the flat / by-issue copy
  // views) (#157). "added" preserves creation order (the historic default); the other keys
  // sort copies by year, catalog number, catalog value, or stamp name. Persisted per
  // collection, alongside the grouping toggles. The actual sort happens where the copies are
  // rendered (LotCard / OrderCopiesView), which already hold the per-area vendor maps.
  const [sortKey, setSortKey] = usePersistentString(`${LS_SORT_KEY}:${collectionId}`, "added");
  const [sortDir, setSortDir] = usePersistentString(`${LS_SORT_DIR}:${collectionId}`, "asc");

  // What the copies on screen are kept for (#622) — the filing pass's other question, beside the
  // header chips' "which of these still need something". Held at the **order** level, unlike those
  // chips: a card of stock copies is filed in one act whatever lot each piece came out of, and one
  // control governing every view is what lets *the for-sale copies still to sort* be asked once.
  //
  // **Remembered per order**, which reverses the original call (#622) that this alone of the view
  // controls must not persist, on the grounds that a filter surviving a reload has the collector
  // open an order and find most of it missing. That risk is real and unchanged; it is outweighed by
  // what the filter is *for*. A filing pass is the long job on this screen, it runs over several
  // sittings, and having to re-narrow the screen each time was the friction being paid — while the
  // filter, unlike a stale expansion, announces itself: the chip stays lit for as long as it is on,
  // so the missing copies are explained on the screen that is hiding them.
  const [storedDisposition, setStoredDisposition] = usePurchaseDispositionFilter(
    collectionId,
    purchase.id
  );
  // Read back through the endpoints' own parser rather than cast: the stored value reaches five
  // query strings, and a hand-edited entry must not put an unknown filter into any of them.
  const dispositionFilter = parseDispositionFilter(storedDisposition) ?? null;
  const setDispositionFilter: (value: CopyDispositionFilter | null) => void = setStoredDisposition;

  // Order-level catalog-value-vs-cost figure (#179): the same holdings summary as the Copies
  // screen (#134), aggregated over every copy in the purchase. Undefined until it loads (the
  // bar renders a fixed-height skeleton so nothing shifts).
  // The same filters the order view reads with, so the two share one cached summary rather than
  // making the order pay for a second whole-order valuation. The holdings inside it are over every
  // copy whatever is filtered — the bar is about the order, not about the current view.
  const orderFilters: IntakeFilterParams = dispositionFilter
    ? { disposition: dispositionFilter }
    : {};
  const purchaseHoldings = usePurchaseSummary(collectionId, purchase.id, orderFilters).data
    ?.holdings;

  // What the order has earned back so far (#559): the cost side above read against the sale side.
  // The bar draws itself away until a copy of this order has actually sold.
  const purchaseReturn = usePurchaseReturn(collectionId, purchase.id).data;

  // "Add lot with stamps" flow (#121): pick a stamp/issue → set condition/certificate/location
  // → set the lot's title/price, then create the lot with its copies in one step. The lot is
  // only created at the final step, so backing out earlier creates nothing.
  const [wsStep, setWsStep] = useState<"none" | "picker" | "condition" | "lot">("none");
  const [wsSelection, setWsSelection] = useState<PendingSelection | null>(null);
  const [wsIntake, setWsIntake] = useState<{
    conditionId: string;
    certificateStatusId: string;
    locationId: string;
    locationRef: string;
    // Serialized photo change-set (#148), carried forward to the final create step. Staged
    // uploads persist server-side until the create promotes them (or the orphan-GC sweeps them
    // if the wizard is abandoned).
    photoChangeSet: string;
    // Physical format chosen at the condition step (#573), blank meaning single. Single-stamp
    // picks only — the step offers no format for a whole checklist, so blank is what arrives.
    formatId: string;
    // Disposition flags chosen at the condition step (#160), carried to the final create step.
    inCollection: string;
    forSale: string;
    forTrade: string;
  } | null>(null);
  function resetWithStamps() {
    setWsStep("none");
    setWsSelection(null);
    setWsIntake(null);
    setError(undefined);
  }

  // The want review (#532; ADR-0032 §7), raised when copies reach the collector's **hands** —
  // marked sorted, or set to `delivered` — and not when they were merely recorded. Intake creates
  // them `ordered`, so nothing is asked then; a parcel won at auction and settled into this order
  // gets its question here, at the point every route through the app converges on.
  //
  // Held here rather than in the lot card because `run` below is the one place every mutation's
  // result passes through, so no caller has to remember to raise it.
  const [wantReview, setWantReview] = useState<{
    copies: ArrivingCopy[];
    matches: WantMatchForCopy[];
  } | null>(null);

  // *Which copies the action bar is about* (#565/#571) — see `lot-selection.ts` for the model.
  //
  // Held **here**, above every view of this order's copies, not inside a lot card. A batch on the
  // desk does not respect lot boundaries: copies from three lots go onto one transport card in one
  // act, so a selection per card would draw an action bar over each of them and make the collector
  // press the same button once per lot. It also means switching how the copies are grouped — by
  // lot, by issue, flat — is a change of *view* and leaves what was picked standing.
  //
  // Ticked copies are held across the filter chips on purpose: narrowing to "to sort", ticking a
  // run, then clearing the chip is one pass over a lot. Whole containers taken *under* a chip are
  // the exception and are retired when that chip changes (`dropFilteredContainers`), since "all 40
  // to sort" must not silently become "all 900".
  const [selection, setSelection] = useState<CopySelection>(EMPTY_SELECTION);
  // A plain function, not a `useCallback`: it is only ever read from event handlers (`onBulkDone`,
  // the bar's `onClear`), so its identity is never a dependency — and hand-memoizing it stopped the
  // React Compiler from optimizing this component at all once the disposition filter stopped being
  // a `useState` setter the compiler could recognise.
  const clearSelection = () => setSelection(EMPTY_SELECTION);

  // The pinned selection bar (#621) and what pins under it: its height is the top offset every lot
  // header takes, and each lot header's own height is added again for the issue headers inside it.
  const [selectionBarRef, selectionBarHeight] = useMeasuredHeight<HTMLDivElement>();
  const { sentinelRef: selectionBarSentinelRef, stuck: selectionBarStuck } = useStuck(0);

  /** *Select the whole order* under the disposition axis (#622): what the bar offers is what the
   *  screen is showing, so with a chip on it means every copy kept for that, not every copy. */
  const wholeOrderContainer: CopyContainer = dispositionFilter
    ? { disposition: dispositionFilter }
    : {};

  /** Press a disposition chip — the same bargain the per-lot chips strike (`changeFilter`): the
   *  loose ticks are the collector's own and stay, the containers taken under the old axis go with
   *  it, since "every for-sale copy here" must not become "every copy here". */
  function changeDisposition(next: CopyDispositionFilter | null) {
    setDispositionFilter(next);
    setSelection(dropDispositionContainers);
  }

  /**
   * Identifying a scan tile into a **new copy** (#567), which since #586 is the order's job rather
   * than a lot card's — the card the tile came from belongs to the parcel, so the chain that turns
   * one of its tiles into a copy has to start here.
   *
   * It is the same picker → condition chain every other intake goes through, deliberately: a second
   * pair of those dialogs would be a second set of remembered choices. What rides with it is the
   * tile and, once the condition step asks it, **which lot** the copy belongs to — the one question
   * the re-parenting left to be answered at identification, where it is answerable at all.
   */
  const [tileStep, setTileStep] = useState<"none" | "picker" | "condition">("none");
  /**
   * The pieces this identification is about — one, or a whole run ticked on the strip (#596).
   *
   * A **list** rather than a piece, all the way down the chain, because with several ticked there is
   * no single piece the step is about and picking the first to stand for the rest is exactly the
   * mistake the aside exists to prevent. One tile is a list of one, so there is one path and not two.
   */
  const [tileIntake, setTileIntake] = useState<IdentifiedPiece[]>([]);
  const [tileSelection, setTileSelection] = useState<PendingSelection | null>(null);
  /** The pick in one catalogue number, kept beside the selection because `PendingSelection` carries
   * only the long form and the repeat action has a button's width to say it in. */
  const [tileShortLabel, setTileShortLabel] = useState("");
  /**
   * How the **previous tile of this sitting** was identified (#595), so the next one can be
   * identified the same way in one press. Component state, never storage: "this sitting" is exactly
   * the life of this screen, and a record surviving a reload would offer to repeat a decision from
   * another day.
   *
   * It is kept at all because **nothing recoverable holds it**. The remembered add-copy defaults
   * (`add-copy-defaults.ts`) are collection-wide and any other add-copy overwrites them, and they
   * carry no stamp, no format and no ref — which are precisely the three the previous tile's answers
   * add. The two sets differ exactly when it matters: after the collector has changed something for
   * this card.
   */
  const [lastTileIdentify, setLastTileIdentify] = useState<TileIdentification | null>(null);
  /** The previous tile's answers, in the fields of the condition step, for the tile being repeated
   * onto. Non-null only on the repeat path — the ordinary picker → condition chain must keep
   * arriving at the remembered defaults and nothing else. */
  const [tileRepeat, setTileRepeat] = useState<TileIdentification | null>(null);
  /**
   * The tile whose identification is being **corrected** — *Identify again* on a tile that already
   * became a copy. Null on every ordinary intake, and what it changes is only the chain's two ends:
   * the condition step opens on the copy's own answers instead of the remembered defaults, and the
   * submit re-answers that copy instead of creating one.
   *
   * The whole middle — the picker, the issue and stamp dialogs it can open, the condition step's own
   * fields, the catalogue value (#593), the piece beside all of them (#592) — is the identification's
   * unchanged. Being wrong about which stamp a piece is usually means being wrong about what was
   * read off it, so the correction has to be able to say everything the identification said; a
   * stamp-only re-point would have sent the collector to the copies list for the other half of the
   * same mistake.
   */
  const [tileCorrection, setTileCorrection] = useState<TileCorrection | null>(null);
  const { invalidatePurchaseScans } = useInvalidatePurchaseScans();
  function resetTileIntake() {
    setTileStep("none");
    setTileIntake([]);
    setTileSelection(null);
    setTileShortLabel("");
    setTileRepeat(null);
    setTileCorrection(null);
    setError(undefined);
  }
  // The dictionaries the repeat action's own wording needs. Conditions arrive as a prop; formats
  // are the one this screen does not have, fetched the way the condition step itself fetches them.
  const { data: collectionFormats = [] } = useCollectionFormats(collectionId);
  /** What *Same as the last* says it will do: the stamp, the condition, and the format when the
   * piece was not a single. Named rather than implied — everything else this action fills is a
   * field the collector would have found pre-filled anyway. */
  const repeatSummary = lastTileIdentify
    ? [
        lastTileIdentify.shortLabel,
        conditions.find((c) => c.id === lastTileIdentify.conditionId)?.abbreviation,
        collectionFormats.find((f) => f.id === lastTileIdentify.formatId)?.abbreviation,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  function run(
    fn: () => Promise<{ status: string; message?: string; id?: string; copies?: ArrivingCopy[] }>,
    onDone?: (result: { status: string; message?: string; id?: string }) => void
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        // Copies stream in via paginated client queries (#172), so a server refresh alone
        // won't reflect copy/lot mutations — invalidate the lot-copies pages and summaries too.
        invalidateLotCopies(collectionId);
        invalidatePurchaseList(collectionId);
        // …and everything the **catalogue** side says about the stamps these copies point at: the
        // copies-held badge and want marker on every picker row (#348/#532), the holdings line in
        // the intake step itself (#562), and the stamp's own thumbnail, which a copy's first front
        // photo may have just become (#149's auto-seed, reached from the tile path too).
        //
        // Cheap to be generous with: these queries are inactive while this screen is up, so
        // invalidating them only marks them stale and the refetch happens when the picker is next
        // opened. What it buys is that the picker cannot open on the state of the collection as it
        // was before the last copy was taken in — which is exactly what it did.
        invalidateInventory(collectionId);
        onDone?.(result);
        // Asked *after* the intake dialog has closed and only when something matches: a review with
        // nothing in it is a dialog that says "no news", which is not worth a click.
        if (result.copies?.length) {
          const copies = result.copies;
          const { findWantsSatisfiedByAction } = await import("@/app/actions/wants");
          const matches = await findWantsSatisfiedByAction(collectionId, copies);
          if (matches.length > 0) setWantReview({ copies, matches });
        }
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

  // The bar's own copy of the bulk dialogs (Store / Move). The cards keep theirs for the per-copy
  // actions on a row; these two belong to the selection, which lives here.
  const selectionEditing = useCopyEditing({
    collectionId,
    areas,
    locations,
    conditions,
    certificateStatuses,
    isPending,
    run,
    onBulkDone: clearSelection,
  });

  // Whole containers resolve to a server-side scope, since their copies run past the loaded rows;
  // a handful of ticks is just a list (#565/#172/#571). `onlyOpenLots` because a closed lot's
  // copies are read-only on this screen in every view, so none of them ever gets a checkbox.
  const resolvedSelection = resolveSelection(selection);
  const selectionScope: BulkScopeClient | null =
    resolvedSelection.kind === "scope"
      ? { purchaseId: purchase.id, onlyOpenLots: true, ...resolvedSelection.scope }
      : null;
  // A scope cannot be counted on the client — a group ticked under a chip has no local figure and
  // `unpriced` is a valuation, not a column — so the bar's number comes from where the write will
  // read it. An id list needs no round trip.
  const scopeCount = useLotSelectionCount(collectionId, selectionScope).data?.count;
  const selectionCount =
    resolvedSelection.kind === "ids"
      ? resolvedSelection.ids.length
      : resolvedSelection.kind === "scope"
        ? scopeCount
        : 0;
  const selectionTarget: BulkTarget | null =
    resolvedSelection.kind === "ids"
      ? { kind: "ids", ids: resolvedSelection.ids }
      : selectionScope
        ? { kind: "scope", scope: selectionScope, count: selectionCount ?? 0 }
        : null;

  // Apply a delivery-status transition, shared by the inline select and the quick-advance
  // button (#159). Arriving moves copies to "to sort" and can bulk-file them, so it routes
  // through the dedicated dialog rather than a bare status write (#141).
  function applyStatus(next: string) {
    if (next === purchase.status) return;
    setError(undefined);
    if (next === "arrived") {
      setArriving(true);
      return;
    }
    run(async () => {
      const { setPurchaseStatusAction } = await import("@/app/actions/purchases");
      return setPurchaseStatusAction(purchase.id, next as "preparing" | "in_transit");
    });
  }

  // The next status in the fixed progression, for the one-click advance button (#159). Null at
  // the terminal "arrived" state (or an unrecognized status), where the button is hidden.
  const statusIdx = PURCHASE_STATUS_ORDER.indexOf(purchase.status);
  const nextStatus =
    statusIdx >= 0 && statusIdx < PURCHASE_STATUS_ORDER.length - 1
      ? PURCHASE_STATUS_ORDER[statusIdx + 1]
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header summary */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
          padding: "1.25rem 1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {purchase.contactName ?? "No supplier"}
          </h2>
          {purchase.platformName && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              via {purchase.platformName}
            </span>
          )}
          {/* Where this order came from, when it was settled from a parcel of won lots (#28). The
              bidding record outlives this purchase — deleting it only clears the link — so it is
              worth a way back to. */}
          {purchase.auctionSale && (
            <Tooltip content="Settled from this auction sale — the bids, the lots that were lost, and what each one went for.">
              <Link
                href={`/c/${collectionSlug}/auctions/sales/${purchase.auctionSale.id}`}
                style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
              >
                <Icon name="auctionSale" size="sm" /> {purchase.auctionSale.name}
              </Link>
            </Tooltip>
          )}
          {/* …and where it came from when it came from an exchange (#644). Worth saying more loudly
              than the auction link, because it changes how every figure below should be read: no
              money was spent here. The lot prices are the cost basis of the copies that went the
              other way, carried over rather than paid, so the trade is where they came from. */}
          {purchase.trade && (
            <Tooltip content="This order is the incoming half of a trade. No money was spent: each lot is priced at the cost basis of the copies that went the other way, carried over so nothing is invented as profit.">
              <Link
                href={`/c/${collectionSlug}/trades/${purchase.trade.id}`}
                style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
              >
                <Icon name="trades" size="sm" /> Traded with {purchase.trade.partnerName} · #
                {purchase.trade.tradeNo}
              </Link>
            </Tooltip>
          )}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {(() => {
              const s = PURCHASE_STATUS[purchase.status] ?? { label: purchase.status, token: "muted" };
              return (
                <>
                <Tooltip content="Set the order's delivery status — saves immediately. Choose Arrived to run the arrival flow.">
                  <select
                    aria-label="Purchase status"
                    value={purchase.status}
                    disabled={isPending}
                    onChange={(e) => applyStatus(e.target.value)}
                    style={{
                      ...tintChip(s.token, s.label).style,
                      // Use longhand border props so toggling between muted (no borderColor)
                      // and tinted (borderColor set) statuses doesn't mix the `border`
                      // shorthand with `borderColor` and trip React's rerender warning.
                      border: undefined,
                      borderWidth: "1px",
                      borderStyle: "solid",
                      borderColor:
                        s.token === "muted"
                          ? "var(--color-border)"
                          : `var(--color-${s.token}-border, var(--color-border))`,
                      cursor: "pointer",
                      paddingRight: "1.25rem",
                      appearance: "auto",
                    }}
                  >
                    {PURCHASE_STATUS_ORDER.map((v) => (
                      <option key={v} value={v}>
                        {PURCHASE_STATUS[v]?.label ?? v}
                      </option>
                    ))}
                  </select>
                </Tooltip>
                {/* One-click advance to the next step in the fixed progression (#159). Hidden at
                    the terminal "arrived" status. */}
                {nextStatus && (
                  <Tooltip
                    content={`Advance to ${PURCHASE_STATUS[nextStatus]?.label ?? nextStatus}`}
                  >
                    <button
                      type="button"
                      aria-label={`Advance status to ${PURCHASE_STATUS[nextStatus]?.label ?? nextStatus}`}
                      onClick={() => applyStatus(nextStatus)}
                      disabled={isPending}
                      style={{
                        ...CHIP,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: isPending ? "default" : "pointer",
                        fontWeight: 600,
                        lineHeight: 1,
                        padding: "0.25rem 0.5rem",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      →
                    </button>
                  </Tooltip>
                )}
                </>
              );
            })()}
            {purchase.status !== "arrived" && (
              <Tooltip content="Mark the whole order arrived: its copies move to “to sort”, ready to be filed">
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setArriving(true);
                  }}
                  disabled={isPending}
                  style={{
                    ...INPUT_STYLE,
                    width: "auto",
                    cursor: "pointer",
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--color-action-primary)",
                    border: "none",
                    padding: "0.375rem 0.875rem",
                  }}
                >
                  Mark arrived
                </button>
              </Tooltip>
            )}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={CHIP}>{purchase.purchasedAt}</span>
          <span style={CHIP}>{purchase.currency}</span>
          {purchase.shippingCost && (
            <Tooltip content="Shipping / shared cost">
              <span style={CHIP}>
                <Icon name="shipping" size="sm" /> {purchase.shippingCost} {purchase.currency}
              </span>
            </Tooltip>
          )}
          <span style={{ marginLeft: "auto", fontSize: "0.9375rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {purchase.total} {purchase.currency}
          </span>
        </div>
        {purchase.fxRateToBase == null && purchase.currency !== purchase.baseCurrency && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--color-warning, var(--color-text-muted))" }}>
            No exchange rate to {purchase.baseCurrency} is known for this purchase yet, so
            base-currency cost-basis cannot be computed on close. Add a rate first.
          </p>
        )}
      </div>

      {/* Catalog value vs. actual purchase cost across the whole order (#179), and what selling
          the order's copies has realized (#559) — one bar over the one set of copies */}
      <HoldingsSummaryBar total={purchaseHoldings} ret={purchaseReturn} />

      {/* Card scans (#566, moved here by #586). **Above the lots**, because that is the order the
          pass runs in and the level the card exists at: a parcel arrives, its cards are scanned and
          cut, and only then does each piece become a copy on one of the lines below. A stockbook
          purchase has one lot and reads exactly as it did; a settled auction gains what a section
          per lot could not express.

          It is a section of the order rather than of the screen's copy views, so the by-lot / by-issue
          toggle below leaves it alone — how the copies are grouped is a question about copies. */}
      <PurchaseScansCard
        collectionId={collectionId}
        // For the picker a parked tile's shortlist is built from (#607) — the same one this panel
        // opens for the identification itself.
        areas={areas}
        scanDpi={scanDpi}
        purchaseId={purchase.id}
        unidentifiedTileCount={purchase.unidentifiedTileCount}
        parkedTileCount={purchase.parkedTileCount}
        scanSheetCount={purchase.scanSheetCount}
        canIdentify={purchase.lots.some((l) => l.status === "open")}
        onIdentifyTiles={(pieces, pick) => {
          setTileIntake(pieces);
          setTileRepeat(null);
          setError(undefined);
          if (pick) {
            // The stamp is already known (#607): a candidate pressed on a parked tile's shortlist,
            // or the parent offered in place of one. So the chain enters at the step the picker
            // would have led to — with **no** prefill, unlike *Same as the last* (#595): what has
            // been answered is the stamp and nothing else, and the condition, the format and the
            // ref must arrive at the ordinary remembered defaults rather than at the previous
            // tile's answers.
            setTileSelection({ kind: "stamp", stampId: pick.stampId, label: pick.label });
            setTileShortLabel(pick.shortLabel);
            setTileStep("condition");
            return;
          }
          setTileStep("picker");
        }}
        // *Identify again*: the same chain, over a tile that already became a copy. It enters at
        // the picker like an ordinary identification — the stamp is the answer being corrected, so
        // it is asked first — and what it carries is the copy's current answers, so the condition
        // step opens on what the copy *is* rather than on defaults remembered from another card.
        onReidentifyTile={(piece, copy) => {
          setTileIntake([piece]);
          setTileRepeat(null);
          setError(undefined);
          setTileCorrection({
            tileId: piece.tileId,
            stampId: copy.stampId,
            prefill: {
              conditionId: copy.conditionId,
              certificateStatusId: copy.certificateStatusId ?? "",
              formatId: copy.formatId ?? "",
              locationId: copy.locationId ?? "",
              locationRef: copy.locationRef ?? "",
              disposition: {
                inCollection: copy.inCollection,
                forSale: copy.forSale,
                forTrade: copy.forTrade,
              },
              // The lot is not asked on a correction — the copy has one, and moving it is a
              // decision about money rather than about what the piece is — so this is the field
              // `lotChoice` being absent leaves unread.
              lotId: "",
            },
          });
          setTileStep("picker");
        }}
        // *Same as the last* (#595): the picker is skipped, because its answer is the record, and
        // the chain resumes at the step that would have followed it — with the fields filled and
        // the ordinary confirm still to press.
        repeatLast={
          lastTileIdentify && {
            summary: repeatSummary,
            onRepeatTile: (pieces) => {
              setTileIntake(pieces);
              setTileSelection({
                kind: "stamp",
                stampId: lastTileIdentify.stampId,
                label: lastTileIdentify.label,
              });
              setTileShortLabel(lastTileIdentify.shortLabel);
              setTileRepeat(lastTileIdentify);
              setError(undefined);
              setTileStep("condition");
            },
          }
        }
        onChanged={() => router.refresh()}
      />

      {/* Lots — heading, grouping, sorting and the two ways in, on **one** row (#588). The three
          controls are read together ("show me the lots, grouped like this, sorted like that") and
          three stacked lines pushed the first lot card a screenful down on a long order. Wraps
          rather than compressing: a narrow window drops the trailing groups to a second line
          instead of squeezing the select. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Lots
        </h3>

        {/* Order-level grouping: by lot and/or by issue; both off = flat list. Only lot-level
            management (add stamps, close, price…) lives in the by-lot view (#121). */}
        {purchase.lots.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={TOOLBAR_LABEL}>Group by</span>
            {(
              [
                { on: byLot, set: setByLot, label: "Lot" },
                { on: byIssue, set: setByIssue, label: "Issue" },
              ] as const
            ).map(({ on, set, label }) => (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => set(!on)}
                style={{
                  ...CHIP,
                  cursor: "pointer",
                  fontWeight: on ? 600 : 500,
                  color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                  background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                }}
              >
                {on && <Icon name="check" size="xs" />} {label}
              </button>
            ))}
            {!byLot && !byIssue && (
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Flat list</span>
            )}
          </div>
        )}

        {/* Disposition filter (#622): show only the copies kept for one purpose, so a filing pass
            can be about the stock or about the collection-bound pieces rather than about
            everything. Order-level and combinable with each lot's own chips — "still to sort" and
            "for sale" are two halves of one question. A copy carries the three flags
            independently, so these are three separate narrowings and not a three-way switch. */}
        {purchase.lots.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={TOOLBAR_LABEL}>Kept for</span>
            {DISPOSITION_FILTERS.map(({ key, label, hint }) => {
              const on = dispositionFilter === key;
              return (
                <Tooltip key={key} content={on ? "Click to show every copy again" : hint}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => changeDisposition(on ? null : key)}
                    style={{
                      ...CHIP,
                      cursor: "pointer",
                      fontWeight: on ? 600 : 500,
                      color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                      background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                    }}
                  >
                    {on && <Icon name="check" size="xs" />} {label}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        {/* Sort order for the copies inside each lot (also the flat / by-issue copy views) (#157).
            Sorts the stamps within a lot, not the lot cards themselves. */}
        {purchase.lots.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={TOOLBAR_LABEL}>Sort copies</span>
            <select
              aria-label="Sort copies by"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              style={{ ...CHIP, cursor: "pointer", appearance: "auto", paddingRight: "1.25rem" }}
            >
              <option value="added">Order added</option>
              <option value="year">Year</option>
              <option value="catalog">Catalog no.</option>
              <option value="price">Price</option>
              <option value="name">Name</option>
            </select>
            <Tooltip content={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}>
              <button
                type="button"
                onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                aria-label={`Sort direction: ${sortDir === "asc" ? "ascending" : "descending"}`}
                style={{ ...CHIP, cursor: "pointer", fontWeight: 600 }}
              >
                {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
              </button>
            </Tooltip>
          </div>
        )}

        {/* Lot cards start collapsed (#382), so the order screen needs the same way out of that
            baseline the offers and auction-sale screens have — hence here, on the toolbar that
            already governs how the lots read. */}
        {purchase.lots.length > 0 && byLot && (
          <button
            type="button"
            onClick={lotExpansion.toggleAll}
            style={{ ...CHIP, cursor: "pointer" }}
          >
            {lotExpansion.allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}

        {/* The two ways to make a lot, kept at the right edge: they act on the list below rather
            than on how it is drawn, which is what every other control on this row does. */}
        <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
          <Tooltip content="Create an empty priced lot, then identify copies into it">
            <button
              type="button"
              onClick={() => setAddingLot(true)}
              disabled={isPending}
              style={{
                ...INPUT_STYLE,
                width: "auto",
                cursor: "pointer",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-strong)",
                padding: "0.375rem 0.875rem",
              }}
            >
              Add lot
            </button>
          </Tooltip>
          <Tooltip content="Pick a stamp or issue first, then create the lot around it">
            <button
              type="button"
              onClick={() => {
                setError(undefined);
                setWsStep("picker");
              }}
              disabled={isPending}
              style={{
                ...INPUT_STYLE,
                width: "auto",
                cursor: "pointer",
                fontWeight: 600,
                color: "#fff",
                background: "var(--color-action-primary)",
                border: "none",
                padding: "0.375rem 0.875rem",
              }}
            >
              Add lot with stamps
            </button>
          </Tooltip>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</div>
      )}

      {/* Selection action bar (#565/#571) — one for the whole order, above every view of its
          copies, and **pinned** while they scroll (#621): a card of forty is ticked from the top of
          a lot and filed from wherever the last tick happened to be, so a bar that scrolled away
          made *Store* a trip back up the page.
          It pins rather than floats, which is the objection it used to answer: the lot header and
          the issue header pin *below* it — each one measured, none of them overlapping — so the
          three read as one stack and cover nothing, exactly the nesting #172 built. */}
      {/* The pinned slot is mounted for the whole life of the screen and merely *hidden* while
          nothing is ticked: it is what the headers below measure themselves against, and a wrapper
          that came and went with the selection would report a height of zero for the first bar it
          ever showed. Hidden with `display: none` rather than by not rendering, so it claims neither
          space nor one of this column's gaps until it has a bar in it. */}
      <div
        ref={selectionBarSentinelRef}
        style={{ height: 0, display: selectionTarget ? "block" : "none" }}
        aria-hidden
      />
      <div
        ref={selectionBarRef}
        style={{
          display: selectionTarget ? "block" : "none",
          position: "sticky",
          top: 0,
          // Above both pinned headers: they slide beneath this bar, never over it.
          zIndex: 5,
          boxShadow: selectionTarget && selectionBarStuck ? STUCK_SHADOW : undefined,
        }}
      >
        {selectionTarget && (
          <CopySelectionBar
            count={selectionCount}
            isPending={isPending}
            onSelectAll={
              containerBoxState(selection, wholeOrderContainer) === "on"
                ? null
                : () => setSelection((sel) => toggleContainer(sel, wholeOrderContainer))
            }
            wholeOrderIsFiltered={!!dispositionFilter}
            onClear={clearSelection}
            onStore={() => selectionEditing.setBulkStore(selectionTarget)}
            onMove={() => selectionEditing.setBulkMove(selectionTarget)}
          />
        )}
      </div>

      {purchase.lots.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          No lots yet. Add a priced lot, then identify copies into it.
        </p>
      ) : byLot ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {purchase.lots.map((lot, idx) => (
            <LotCard
              key={lot.id}
              index={idx}
              lot={lot}
              justAdded={lot.id === justAddedLotId}
              highlighted={lot.id === highlightLotId}
              onClearHighlight={clearHighlight}
              expanded={lotExpansion.isExpanded(lot.id)}
              onToggleExpanded={() => lotExpansion.toggle(lot.id)}
              issueHeaderById={issueHeaderById}
              collectionId={collectionId}
              purchaseId={purchase.id}
              scanDpi={scanDpi}
              currency={purchase.currency}
              baseCurrency={purchase.baseCurrency}
              areas={areas}
              locations={locations}
              conditions={conditions}
              certificateStatuses={certificateStatuses}
              isPending={isPending}
              unidentifiedTileCount={purchase.unidentifiedTileCount}
              parkedTileCount={purchase.parkedTileCount}
              groupByIssue={byIssue}
              sortKey={sortKey}
              sortDir={sortDir}
              dispositionFilter={dispositionFilter}
              stickyTop={selectionBarHeight}
              selection={selection}
              setSelection={setSelection}
              onRun={run}
            />
          ))}
        </div>
      ) : (
        <OrderCopiesView
          collectionId={collectionId}
          purchaseId={purchase.id}
          lots={purchase.lots}
          issueHeaderById={issueHeaderById}
          baseCurrency={purchase.baseCurrency}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          byIssue={byIssue}
          sortKey={sortKey}
          sortDir={sortDir}
          dispositionFilter={dispositionFilter}
          stickyTop={selectionBarHeight}
          isPending={isPending}
          selection={selection}
          setSelection={setSelection}
          run={run}
        />
      )}

      {/* Identifying a tile: pick the stamp (#567) */}
      {tileStep === "picker" && tileIntake.length > 0 && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          // The piece, for the whole of the identification and not only its first dialog (#592).
          // The picker passes it on to the issue and stamp dialogs it opens, which is the deepest
          // point of the chain and the one the collector reaches furthest from where they started.
          // With a run ticked (#596) it is all of them, small — one stamp is being picked for every
          // piece on screen, and this is where a wrong assertion is still free to be corrected.
          aside={
            <IdentifiedPieceAside
              collectionId={collectionId}
              pieces={tileIntake}
              scanDpi={scanDpi}
            />
          }
          asideWidth="26rem"
          // Correcting an identification, the stamp the copy is pointing at now is marked on its own
          // row: the tree is being read *against* that answer, and one that said nothing about where
          // the copy already sits sends the collector to check on the other side of the screen.
          // Pressing it is a complete answer — the condition and the rest may be what was wrong.
          marked={
            tileCorrection
              ? {
                  stampIds: new Set([tileCorrection.stampId]),
                  label: "current",
                  hint: "What this copy is identified as now",
                }
              : undefined
          }
          onPick={(picked: PickedStamp) => {
            setTileSelection({
              kind: "stamp",
              stampId: picked.stampId,
              label: pickedStampText(picked),
            });
            // The primary vendor's number leads `catalogLabels`, so the first of them is the one the
            // collector thinks in; a stamp with no number at all falls back to its name (#595).
            setTileShortLabel(picked.catalogLabels[0] ?? picked.name ?? "(unnamed stamp)");
            setError(undefined);
            setTileStep("condition");
          }}
          // A tile is one piece — one region of one card — so a whole-checklist expansion has
          // nothing to attach its images to. Omitted rather than refused: the picker only draws the
          // "add this whole set" buttons when it is given somewhere to send them, so entering from
          // a tile simply never offers the answer that could not work.
          onClose={resetTileIntake}
        />
      )}

      {/* …then its condition, its lot, and everything else intake asks */}
      {tileStep === "condition" && tileIntake.length > 0 && tileSelection && (
        <IntakeConditionDialog
          selection={tileSelection}
          collectionId={collectionId}
          scanDpi={scanDpi}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          locations={locations}
          isPending={isPending}
          error={error}
          // The tile's crops **are** this copy's front and back, so the uploader is out of the way:
          // a second front would collide with the copy's one front slot.
          hidePhotos
          // *Used or mint?* is read off the piece, and gum and hinge marks are on its back — so the
          // piece is beside the field asking, both sides, at the size the tile dialog showed it
          // (#592). Only here: the two other entries into this dialog have no picture of the piece.
          // Several pieces (#596) are all shown, which is where the collector's assertion that they
          // are one stamp in one condition gets its last look before it becomes N copies.
          pieces={tileIntake}
          // What is about to exist, said before anything is created — the rule every bulk action on
          // this screen follows.
          copyCount={tileIntake.length}
          submitLabel={
            tileCorrection
              ? // Never *Identify the tile*: nothing is created here, and a correction that read
                // like an intake would leave the collector wondering whether they now hold two
                // copies of the piece in their tweezers.
                "Save the identification"
              : tileIntake.length === 1
                ? "Identify the tile"
                : `Identify ${tileIntake.length} tiles`
          }
          // *Same as the last* (#595) arrives here with the previous tile's answers rather than
          // through the picker. Null on every other route in, which is what keeps this an action and
          // not a default.
          prefill={tileCorrection ? tileCorrection.prefill : (tileRepeat ?? undefined)}
          // The one question #586 left to identification. Only the order's **open** lots, since a
          // closed one takes no new copy at all (ADR-0009 §3) and offering it would be offering a
          // refusal.
          lotChoice={
            tileCorrection
              ? // **Not asked on a correction.** The copy already belongs to a lot and takes its
                // cost basis from it (ADR-0009 §3), so which lot it is on is a question about money
                // rather than about what the piece is — and the identification is what is being
                // corrected here. Offering the question would also mean quietly moving a copy off a
                // closed lot, since only open ones can be offered. Absent is the shape this dialog
                // already has for *the lot is not in question*, which is the stockbook case.
                undefined
              : {
                  purchaseId: purchase.id,
                  lots: purchase.lots
                    .map((l, i) => ({
                      id: l.id,
                      label: l.title ?? `Lot ${i + 1}`,
                      status: l.status,
                    }))
                    .filter((l) => l.status === "open"),
                }
          }
          onBack={() => {
            if (!isPending) {
              setError(undefined);
              // Backing out of a repeat retires it (#595). *Back* from here is the collector saying
              // this tile is **not** the same as the last, so the stamp they pick next must arrive
              // at the ordinary remembered defaults — a format left standing from the previous tile
              // would be exactly the inherited value #573 refused.
              setTileRepeat(null);
              setTileStep("picker");
            }
          }}
          onClose={resetTileIntake}
          onSubmit={(fd) => {
            setError(undefined);
            if (tileSelection.kind === "stamp") fd.set("stampId", tileSelection.stampId);
            // Every ticked tile, in card order — the order the copies are created and numbered in
            // (#596). Each one is handed its own tile's images by the write; nothing here is shared
            // between them but the answers on this form.
            const tileIds = tileIntake.map((p) => p.tileId);
            // What the *next* tile can be identified as in one press (#595). Read off the submitted
            // form rather than mirrored from the dialog's state: this is the same set of answers the
            // write itself is given, so the two cannot describe different intakes. Recorded only on
            // success, in `run`'s completion — an intake the server refused is not a decision that
            // was taken.
            const answers = tileAnswersFrom(fd);
            const stampId = tileSelection.kind === "stamp" ? tileSelection.stampId : "";
            const label = tileSelection.label;
            const shortLabel = tileShortLabel;
            const correction = tileCorrection;
            run(
              async () => {
                const scans = await import("@/app/actions/scans");
                // The same form either way, and the only thing that differs is what it lands on: a
                // correction re-answers the copy the tile already became, an identification creates
                // one. Both consume the same fields, which is what keeps the two one vocabulary.
                const r = correction
                  ? await scans.reidentifyTileAction(correction.tileId, fd)
                  : await scans.identifyTilesAction(tileIds, fd);
                if (r.status === "error") setError(r.message);
                // Identifying a tile touches **both** — it creates a copy *and* consumes the tile —
                // so both namespaces are re-read: the shared runner invalidates the copies, and this
                // adds the scans, without which the strip keeps showing a tile that is already a
                // copy. (`purchase-scans-card.tsx` states the rule the other outcomes follow.) A
                // correction touches both for the same reason: the copy changed, and the tile's
                // square is what says what it became.
                else void invalidatePurchaseScans(collectionId);
                return r;
              },
              () => {
                // **A correction is not what *Same as the last* repeats** (#595). That action
                // carries the previous *intake* onto the next tile, lot included, and a correction
                // answers no lot at all — so recording one here would hand the next tile a blank
                // lot that the step would silently resolve to the first one offered.
                if (stampId && !correction) {
                  setLastTileIdentify({ stampId, label, shortLabel, ...answers });
                }
                resetTileIntake();
              }
            );
          }}
        />
      )}

      {addingLot && (
        <LotDialog
          title="Add lot"
          actionLabel="Add lot"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setAddingLot(false);
              setError(undefined);
            }
          }}
          onSubmit={(fd) =>
            run(
              async () => {
                const { createLotAction } = await import("@/app/actions/purchases");
                return createLotAction(purchase.id, fd);
              },
              (result) => {
                setAddingLot(false);
                if (result.id) markLotAdded(result.id);
              }
            )
          }
        />
      )}

      {/* Mark order arrived: status → arrived, ordered copies → to sort, optional bulk location */}
      {arriving && (
        <LocationPickerDialog
          title="Mark order arrived"
          message={
            <>
              Marks the whole order arrived and moves its <strong>ordered</strong> copies to{" "}
              <strong>to sort</strong>. Optionally file every copy into one location now (e.g. an
              incoming box) — you can refine each copy later while sorting.
            </>
          }
          actionLabel="Mark arrived"
          locations={locations}
          allowNone
          rememberForCollectionId={collectionId}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setArriving(false);
              setError(undefined);
            }
          }}
          onConfirm={(locationId) => {
            const fd = new FormData();
            if (locationId) fd.set("locationId", locationId);
            run(
              async () => {
                const { markPurchaseArrivedAction } = await import("@/app/actions/purchases");
                return markPurchaseArrivedAction(purchase.id, fd);
              },
              () => setArriving(false)
            );
          }}
        />
      )}

      {/* Add lot with stamps — step 1: pick a stamp or a whole issue */}
      {wsStep === "picker" && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          onPick={(picked: PickedStamp) => {
            setWsSelection({ kind: "stamp", stampId: picked.stampId, label: pickedStampText(picked) });
            setError(undefined);
            setWsStep("condition");
          }}
          onPickIssue={(picked: PickedIssue) => {
            setWsSelection({
              kind: "checklist",
              checklistId: picked.checklistId,
              label: picked.label,
              requiredCount: picked.requiredCount,
            });
            setError(undefined);
            setWsStep("condition");
          }}
          onClose={resetWithStamps}
        />
      )}

      {/* Add lot with stamps — step 2: condition + certificate + location for the copies */}
      {wsStep === "condition" && wsSelection && (
        <IntakeConditionDialog
          selection={wsSelection}
          collectionId={collectionId}
          scanDpi={scanDpi}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          locations={locations}
          isPending={isPending}
          error={error}
          submitLabel="Continue"
          onBack={() => {
            setError(undefined);
            setWsStep("picker");
          }}
          onClose={resetWithStamps}
          onSubmit={(fd) => {
            // Capture the intake choice; the lot is created only at the final price step.
            setWsIntake({
              conditionId: (fd.get("conditionId") as string) ?? "",
              certificateStatusId: (fd.get("certificateStatusId") as string) ?? "",
              locationId: (fd.get("locationId") as string) ?? "",
              locationRef: (fd.get("locationRef") as string) ?? "",
              photoChangeSet: (fd.get("photoChangeSet") as string) ?? "",
              formatId: (fd.get("formatId") as string) ?? "",
              inCollection: (fd.get("inCollection") as string) ?? "false",
              forSale: (fd.get("forSale") as string) ?? "false",
              forTrade: (fd.get("forTrade") as string) ?? "false",
            });
            setError(undefined);
            setWsStep("lot");
          }}
        />
      )}

      {/* Add lot with stamps — step 3: title + price, then create the lot with its copies */}
      {wsStep === "lot" && wsSelection && wsIntake && (
        <LotDialog
          title="Add lot with stamps"
          actionLabel="Create lot"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) resetWithStamps();
          }}
          onSubmit={(fd) => {
            if (wsSelection.kind === "stamp") fd.set("stampId", wsSelection.stampId);
            else fd.set("checklistId", wsSelection.checklistId);
            fd.set("conditionId", wsIntake.conditionId);
            fd.set("certificateStatusId", wsIntake.certificateStatusId);
            fd.set("locationId", wsIntake.locationId);
            fd.set("locationRef", wsIntake.locationRef);
            fd.set("formatId", wsIntake.formatId);
            fd.set("inCollection", wsIntake.inCollection);
            fd.set("forSale", wsIntake.forSale);
            fd.set("forTrade", wsIntake.forTrade);
            if (wsIntake.photoChangeSet) fd.set("photoChangeSet", wsIntake.photoChangeSet);
            run(
              async () => {
                const { createLotWithStampsAction } = await import("@/app/actions/purchases");
                return createLotWithStampsAction(purchase.id, fd);
              },
              (result) => {
                resetWithStamps();
                if (result.id) markLotAdded(result.id);
              }
            );
          }}
        />
      )}

      {/* The open wants the copies just taken in could satisfy (#532; ADR-0032 §7). Raised by both
          intake paths through `run`, and closing nothing on its own. */}
      {/* The Store / Move dialogs the selection bar opens. */}
      {selectionEditing.dialogs}

      {wantReview && (
        <WantReviewDialog
          collectionId={collectionId}
          copies={wantReview.copies}
          matches={wantReview.matches}
          onClose={() => setWantReview(null)}
        />
      )}
    </div>
  );
}

interface LotCardProps {
  index: number;
  lot: LotSummary;
  /** Flash the card once right after this lot is created (#158). */
  justAdded: boolean;
  /** The lot named by `?lot=` — what a copy's "Go to purchase" arrived to see (#387). The mark
   * **persists** (a ring plus a labelled strip), unlike the one-shot `justAdded` flash: an order
   * can hold a dozen lots, and a flash is over before the eye has finished reading them. */
  highlighted: boolean;
  /** Drop that mark — the panel owns the URL it lives in. */
  onClearHighlight: () => void;
  /** Whether this lot's copies are shown. Owned by the panel (#382) so the whole order shares
   * one collapsed-by-default rule and a lot added here opens by itself. */
  expanded: boolean;
  onToggleExpanded: () => void;
  issueHeaderById: Record<string, IssueHeader>;
  collectionId: string;
  /** The order this lot belongs to — the card's own remembered view state (its collapsed groups
   * and header chip) is kept in that order's entry, so it can be evicted with it. */
  purchaseId: string;
  /** The collection's stated scan resolution (#598), on its way to the tile viewer's measuring
   * tools through the condition dialog this card opens. */
  scanDpi: number;
  
  currency: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  isPending: boolean;
  /** Scan tiles still waiting on the **order** (#586). The close dialog's nudge, which the tiles
   * moving up to the purchase did not retire: a tile still has no catalogue price and so no weight
   * in this lot's cost split, and it is still the collector's memory that needs the reminder — it
   * is only the scope of "which tiles" that widened from the lot to the parcel they came in. */
  unidentifiedTileCount: number;
  /** Scan tiles **parked** on the order (#597) — still to be identified, waiting on a check that
   * cannot be made at the desk. Named in the close dialog beside the waiting ones for exactly the
   * same reason: either could still become a copy on the lot being closed, and a parked one is the
   * likelier of the two to be forgotten, having deliberately left the queue. */
  parkedTileCount: number;
  /** Group this lot's copies by issue (the order-level "By issue" toggle, #121). */
  groupByIssue: boolean;
  /** Copy sort order (order-level control, #157): the field and direction to sort this lot's
   * copies by before rendering. */
  sortKey: string;
  sortDir: string;
  /** The order-level *Kept for* filter (#622), narrowing this card's copies to one disposition.
   * Independent of the card's own chips — both may be on, and the list means their intersection. */
  dispositionFilter: CopyDispositionFilter | null;
  /** How far down the viewport this card's own sticky header pins (#621): the height of the pinned
   * selection bar above it, so the two stack instead of overlapping. */
  stickyTop: number;
  /** The order's one selection (#571), held above the cards: a batch on the desk routinely spans
   *  lots, and a selection per card would put an action bar over every one of them. */
  selection: CopySelection;
  setSelection: React.Dispatch<React.SetStateAction<CopySelection>>;
  onRun: RunFn;
}

/** A stamp or a whole checklist chosen in the picker (#531), awaiting a condition/certificate
 * before its copies are created. */
type PendingSelection =
  | { kind: "stamp"; stampId: string; label: string }
  | { kind: "checklist"; checklistId: string; label: string; requiredCount: number };

type RunFn = (
  /** `copies` is what an intake returns (#532) — the panel's `run` takes the want review from it. */
  fn: () => Promise<{ status: string; message?: string; id?: string; copies?: ArrivingCopy[] }>,
  onDone?: (result: { status: string; message?: string; id?: string }) => void
) => void;

interface BulkChanges {
  locationId?: string | null;
  /** The ref card's identifier, written with the location in one act (#565). */
  locationRef?: string | null;
  deliveryState?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  markSorted?: boolean;
  /** Mark-sorted only (#274): leave each copy's disposition untouched instead of writing one. */
  keepDisposition?: boolean;
}

/** A bulk-action target: either an explicit id list (a single copy from its row menu) or a
 * server-resolved scope with its copy count (a whole lot/issue, which may exceed one page and
 * so can no longer be enumerated client-side, #172). */
type BulkTarget =
  | { kind: "ids"; ids: string[] }
  | { kind: "scope"; scope: BulkScopeClient; count: number };

function bulkTargetCount(t: BulkTarget): number {
  return t.kind === "ids" ? t.ids.length : t.count;
}

/** Serialize the shared bulk-change fields onto a form (location / delivery / disposition /
 * mark-sorted), used by both the id-list and scoped bulk requests. */
function appendBulkChanges(fd: FormData, changes: BulkChanges): void {
  if (changes.locationId !== undefined) fd.set("locationId", changes.locationId ?? "");
  if (changes.locationRef !== undefined) fd.set("locationRef", changes.locationRef ?? "");
  if (changes.deliveryState) fd.set("deliveryState", changes.deliveryState);
  if (changes.inCollection !== undefined) fd.set("inCollection", String(changes.inCollection));
  if (changes.forSale !== undefined) fd.set("forSale", String(changes.forSale));
  if (changes.forTrade !== undefined) fd.set("forTrade", String(changes.forTrade));
  if (changes.markSorted) fd.set("markSorted", "true");
  if (changes.keepDisposition) fd.set("keepDisposition", "true");
}

/** Shared copy-editing machinery (#121) used by both the by-lot cards and the order-level
 * flat / by-issue views: the per-copy dialogs (edit copy, edit stamp, identify variant, quick
 * catalog price), the bulk move / mark-sorted dialogs, and `runBulk`. Returns the openers, the
 * shared error, and a `dialogs` node the caller renders once. Keeping this in one place means
 * the two groupings drive identical editing behaviour. */
function useCopyEditing(ctx: {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  isPending: boolean;
  run: RunFn;
  /** Called after any bulk change lands, so a caller holding a selection can drop it — the copies
   * it named have just been acted on (#565). */
  onBulkDone?: () => void;
}) {
  const { collectionId, areas, locations, conditions, certificateStatuses, isPending, run } = ctx;
  const { onBulkDone } = ctx;
  // Catalog-number rendering context for the quick-price dialog (#147): reuse the same
  // per-area vendor maps the copy rows use so numbers format identically.
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const [editStampItem, setEditStampItem] = useState<ItemListItem | null>(null);
  const [editCopyItem, setEditCopyItem] = useState<ItemListItem | null>(null);
  const [identifyItem, setIdentifyItem] = useState<ItemListItem | null>(null);
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  const [copyError, setCopyError] = useState<string | undefined>();
  const [bulkMove, setBulkMove] = useState<BulkTarget | null>(null);
  const [bulkStore, setBulkStore] = useState<BulkTarget | null>(null);

  /** Apply a bulk change to an explicit id list (a single copy from its row menu). */
  function runBulk(itemIds: string[], changes: BulkChanges) {
    setCopyError(undefined);
    run(
      async () => {
        const fd = new FormData();
        fd.set("itemIds", itemIds.join(","));
        appendBulkChanges(fd, changes);
        const { bulkUpdateLotItemsAction } = await import("@/app/actions/purchases");
        const r = await bulkUpdateLotItemsAction(fd);
        if (r.status === "error") setCopyError(r.message);
        return r;
      },
      () => {
        setBulkMove(null);
        setBulkStore(null);
        onBulkDone?.();
      }
    );
  }

  /** Apply a bulk change to a server-resolved scope (whole issue groups, or a whole filtered
   * list), so it covers copies beyond the loaded page (#172/#571). */
  function runScopedBulk(scope: BulkScopeClient, changes: BulkChanges) {
    setCopyError(undefined);
    run(
      async () => {
        const fd = new FormData();
        fd.set("collectionId", collectionId);
        for (const [name, value] of bulkScopeFields(scope)) fd.set(name, value);
        appendBulkChanges(fd, changes);
        const { bulkUpdateLotItemsScopedAction } = await import("@/app/actions/purchases");
        const r = await bulkUpdateLotItemsScopedAction(fd);
        if (r.status === "error") setCopyError(r.message);
        return r;
      },
      () => {
        setBulkMove(null);
        setBulkStore(null);
        onBulkDone?.();
      }
    );
  }

  /** Dispatch a bulk change to whichever target kind was opened. */
  function applyBulk(target: BulkTarget, changes: BulkChanges) {
    if (target.kind === "ids") runBulk(target.ids, changes);
    else runScopedBulk(target.scope, changes);
  }

  function removeCopy(itemId: string) {
    run(async () => {
      const { removeLotItemAction } = await import("@/app/actions/purchases");
      return removeLotItemAction(itemId);
    });
  }

  const dialogs = (
    <>
      {quickPriceItem && (
        <QuickPriceDialog
          subject={quickPriceItem}
          collectionId={collectionId}
          areaName={
            quickPriceItem.areaId ? (areaNameById.get(quickPriceItem.areaId) ?? null) : null
          }
          primaryVendorId={
            quickPriceItem.areaId
              ? (primaryVendorByArea.get(quickPriceItem.areaId) ?? null)
              : null
          }
          vendorMap={vendorMapFor(quickPriceItem.areaId, quickPriceItem.issueId)}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setQuickPriceItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(entries) => {
            const it = quickPriceItem;
            setCopyError(undefined);
            run(
              async () => {
                const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
                const r = await quickSetCatalogPricesAction(
                  it.stampId,
                  it.conditionId,
                  it.certificateStatusId,
                  entries
                );
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setQuickPriceItem(null)
            );
          }}
        />
      )}

      {editCopyItem && (
        <InventoryItemFormDialog
          mode="edit"
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          item={editCopyItem}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setEditCopyItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(fd) => {
            const itemId = editCopyItem.id;
            setCopyError(undefined);
            run(
              async () => {
                const { updateItemAction } = await import("@/app/actions/items");
                const r = await updateItemAction(itemId, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setEditCopyItem(null)
            );
          }}
        />
      )}

      {editStampItem && (
        <StampFormDialog
          mode="edit"
          stampId={editStampItem.stampId}
          collectionId={collectionId}
          stamp={{
            name: editStampItem.stampName,
            issuedDay: editStampItem.issuedDay,
            issuedMonth: editStampItem.issuedMonth,
            issuedYear: editStampItem.issuedYear,
            catalogNumbers: editStampItem.catalogNumbers,
          }}
          areaVendors={[...vendorMapFor(editStampItem.areaId, editStampItem.issueId).values()]}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setEditStampItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(fd) => {
            const stampId = editStampItem.stampId;
            setCopyError(undefined);
            run(
              async () => {
                const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
                const r = await updateStampWithCatalogAction(stampId, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setEditStampItem(null)
            );
          }}
        />
      )}

      {identifyItem && (
        <IdentifyVariantDialog
          collectionId={collectionId}
          item={identifyItem}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setIdentifyItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(fd) => {
            const itemId = identifyItem.id;
            setCopyError(undefined);
            run(
              async () => {
                const { resolveItemVariantAction } = await import("@/app/actions/items");
                const r = await resolveItemVariantAction(itemId, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setIdentifyItem(null)
            );
          }}
        />
      )}

      {bulkMove && (
        <LocationPickerDialog
          title="Move copies to location"
          message={
            <>
              Move {bulkTargetCount(bulkMove)} cop{bulkTargetCount(bulkMove) === 1 ? "y" : "ies"}{" "}
              into one location, changing nothing else about them. Choose <em>None</em> to clear
              their location instead.
            </>
          }
          actionLabel="Move here"
          locations={locations}
          allowNone
          rememberForCollectionId={collectionId}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setBulkMove(null);
              setCopyError(undefined);
            }
          }}
          onConfirm={(locationId) => applyBulk(bulkMove, { locationId: locationId || null })}
        />
      )}

      {bulkStore && (
        <StoreCopiesDialog
          count={bulkTargetCount(bulkStore)}
          locations={locations}
          collectionId={collectionId}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setBulkStore(null);
              setCopyError(undefined);
            }
          }}
          onConfirm={({ disposition, locationId, locationRef }) =>
            applyBulk(bulkStore, {
              // Storing *is* sorting (#565/#571): the delivery lifecycle already says a
              // `delivered` copy is "sorted and filed", so this is one act with an address on it.
              markSorted: true,
              // A null disposition is the dialog's "leave as is" (#274): send no flags and
              // suppress the server's `inCollection` default.
              ...(disposition ?? { keepDisposition: true }),
              // An absent location is the dialog's own "leave as is" — declaring a batch sorted
              // must not overwrite the filings made copy by copy during the pass (#571). The ref
              // rides with the location it addresses, so it goes only when one was chosen.
              ...(locationId ? { locationId, locationRef } : {}),
            })
          }
        />
      )}
    </>
  );

  return {
    copyError,
    setCopyError,
    runBulk,
    removeCopy,
    setBulkMove,
    setBulkStore,
    setEditCopyItem,
    setEditStampItem,
    setIdentifyItem,
    setQuickPriceItem,
    dialogs,
  };
}

type CopyEditing = ReturnType<typeof useCopyEditing>;

/** One copy row, shared by the by-lot and order-level views (#121): the inventory row plus
 * the lot-specific delivery/disposition/cost chips and the per-copy action menu, all wired to
 * the shared `copy` editing machinery. Inline editing is enabled only when `open` (its lot is
 * still open). */
function CopyRow({
  collectionId,
  item,
  open,
  estimate,
  highlight,
  baseCurrency,
  areas,
  locations,
  primaryVendorByArea,
  vendorMapFor,
  copy,
}: {
  collectionId: string;
  item: ItemListItem;
  open: boolean;
  estimate: number | null;
  highlight: boolean;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  primaryVendorByArea: Map<string, string | null>;
  /** Catalog-entry lookup resolved from the copy's area *and* issue, so a per-issue prefix
   * override (#377) reaches the row. */
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
  copy: CopyEditing;
}) {
  const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
  const vendorMap = vendorMapFor(item.areaId, item.issueId);
  return (
    <InventoryItemRow
      collectionId={collectionId}
      item={item}
      areas={areas}
      locations={locations}
      baseCurrency={baseCurrency}
      primaryVendorId={primaryVendorId}
      vendorMap={vendorMap}
      isLast={false}
      readOnly={!open}
      highlight={highlight}
      onSetCatalogPrice={open ? () => copy.setQuickPriceItem(item) : undefined}
      onSetLocation={open ? () => copy.setBulkMove({ kind: "ids", ids: [item.id] }) : undefined}
      hideDispositions
      // The intake screen's own delivery control lives in `trailingChips` below (#272).
      hideDeliveryState
      trailingChips={
        <LotCopyChips
          item={item}
          baseCurrency={baseCurrency}
          estimate={estimate}
          onSetDeliveryState={
            open ? (state) => copy.runBulk([item.id], { deliveryState: state }) : undefined
          }
          onSetDisposition={
            open ? (flag, value) => copy.runBulk([item.id], { [flag]: value }) : undefined
          }
        />
      }
      actionsOverride={[
        {
          key: "edit-copy",
          label: "Edit copy",
          icon: "edit",
          onSelect: () => copy.setEditCopyItem(item),
        },
        ...(item.unknownVariant
          ? ([
              {
                key: "identify",
                label: "Identify variant",
                icon: "variant",
                onSelect: () => copy.setIdentifyItem(item),
              },
            ] satisfies RowAction[])
          : []),
        {
          key: "edit-stamp",
          label: "Edit stamp (prices…)",
          icon: "variant",
          onSelect: () => copy.setEditStampItem(item),
        },
        {
          key: "remove",
          label: "Remove from lot",
          icon: "remove",
          danger: true,
          separatorBefore: true,
          onSelect: () => copy.removeCopy(item.id),
        },
      ]}
    />
  );
}

// The pinned-header helpers this screen's cards use now live in `shared/sticky-header.ts` (#637):
// the trade screen pins its sections and their group headings the same way, and two copies of "am I
// stuck yet" would drift.

/** A copy's live cost-basis estimate for an open lot: its share of the base-currency pool by
 * catalog-price weight, using the whole-lot weight denominator from the summary (#172). Never
 * persisted — the real snapshot is frozen on close. Null when the lot is closed, no FX rate is
 * known, or the copy carries no positive weight / was not delivered. */
function estimateFor(
  item: ItemListItem,
  poolBase: number | null,
  weightBase: number,
  open: boolean
): number | null {
  if (!open || poolBase == null || weightBase <= 0) return null;
  if (item.deliveryState === "not_delivered") return null;
  const w = item.value.baseAmount;
  if (w == null || w <= 0) return null;
  return Math.round(((poolBase * w) / weightBase) * 100) / 100;
}

/** The plain-text controls in the selection action bar (#565) — "select all matching", "clear".
 * Underlined text rather than buttons, so the one real action in the bar reads as the button. */
const SELECTION_LINK: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  textDecoration: "underline",
};

const COPIES_MUTED_STYLE: React.CSSProperties = {
  padding: "0.875rem 1.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** Presentational paginated copy list: renders the flattened pages of a copies infinite-query
 * plus the shared infinite-scroll sentinel. The query is passed in so the same rendering serves
 * the lot-scoped and purchase-scoped sources (#172). */
function CopyPageList({
  query,
  renderRow,
  emptyText,
}: {
  query: ReturnType<typeof useLotCopiesInfinite>;
  renderRow: (item: ItemListItem) => React.ReactNode;
  emptyText: string;
}) {
  const items = (query.data?.pages ?? []).flatMap((p) => p.items);

  if (query.isLoading) {
    return <div style={COPIES_MUTED_STYLE}>Loading copies…</div>;
  }
  if (query.isError) {
    return (
      <div style={{ ...COPIES_MUTED_STYLE, color: "var(--color-error)" }}>
        Failed to load copies.
      </div>
    );
  }
  if (items.length === 0) {
    return <div style={COPIES_MUTED_STYLE}>{emptyText}</div>;
  }
  return (
    <>
      {/* One argument on purpose: `map` would otherwise pass its index into whatever second
          parameter a caller's `renderRow` happens to declare. */}
      {items.map((it) => renderRow(it))}
      <InfiniteScrollSentinel
        onLoadMore={() => query.fetchNextPage()}
        hasMore={!!query.hasNextPage}
        isLoading={query.isFetchingNextPage}
      />
    </>
  );
}

/**
 * *What the ticked copies can be done to* (#565/#571) — the two acts, side by side.
 *
 * **Store** puts copies away: an address, the ref card they sit on, what they are kept for, and
 * `delivered`. **Move to location** changes where they live and claims nothing else. They are two
 * buttons rather than one dialog with a *mark them sorted* box, because a collector relocating a
 * card who does not notice a pre-ticked box would silently declare copies sorted that nobody
 * touched — two names that mean different things cannot be got wrong that way.
 *
 * Shared by the lot card and the order-level views, since sorting is what all three are for.
 */
function CopySelectionBar({
  count,
  isPending,
  onSelectAll,
  wholeOrderIsFiltered,
  onClear,
  onStore,
  onMove,
}: {
  /** Undefined while the server is still counting a scope — the bar keeps its shape and says so
   *  rather than flashing a wrong number. */
  count: number | undefined;
  isPending: boolean;
  /** Offered while the order is not already wholly ticked. It is the one affordance that reaches
   *  every copy from any view — the flat copy list has no heading to hang a checkbox on — and it
   *  is resolved on the server like every other container (#172). */
  onSelectAll: (() => void) | null;
  /** Whether a disposition chip is narrowing the order (#622) — so the offer says which "whole"
   *  it means rather than promising more than it takes. */
  wholeOrderIsFiltered: boolean;
  onClear: () => void;
  onStore: () => void;
  onMove: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-accent-soft)",
      }}
    >
      <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-accent)" }}>
        {count == null
          ? "Counting the selection…"
          : `${count} cop${count === 1 ? "y" : "ies"} selected`}
      </span>
      {onSelectAll && (
        <Tooltip
          content={
            wholeOrderIsFiltered
              ? "Selects every copy this filter is showing across the order — including the ones further down that have not loaded yet — as long as its lot is still open."
              : "Selects every copy in this order that is still in an open lot, including the ones further down that have not loaded yet."
          }
        >
          <button type="button" onClick={onSelectAll} style={SELECTION_LINK}>
            {wholeOrderIsFiltered ? "Select everything shown" : "Select the whole order"}
          </button>
        </Tooltip>
      )}
      <button type="button" onClick={onClear} style={SELECTION_LINK}>
        Clear
      </button>
      <span style={{ flex: 1 }} />
      <Tooltip content="Change where these copies live, and nothing else about them.">
        <button
          type="button"
          disabled={isPending || !count}
          onClick={onMove}
          style={{
            ...INPUT_STYLE,
            width: "auto",
            cursor: isPending ? "not-allowed" : "pointer",
            fontWeight: 600,
            padding: "0.3125rem 0.75rem",
            whiteSpace: "nowrap",
          }}
        >
          <Icon name="location" size="sm" /> Move to location…
        </button>
      </Tooltip>
      <Tooltip content="Put these copies away: a location, an optional ref, a disposition, and mark them delivered.">
        <button
          type="button"
          disabled={isPending || !count}
          onClick={onStore}
          style={{
            ...INPUT_STYLE,
            width: "auto",
            cursor: isPending ? "not-allowed" : "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-action-primary)",
            border: "none",
            padding: "0.3125rem 0.75rem",
            whiteSpace: "nowrap",
          }}
        >
          <Icon name="check" size="sm" /> Store…
        </button>
      </Tooltip>
    </div>
  );
}

/** A lot-scoped paginated copy list (optionally narrowed to one issue group). */
function LotCopyFlatList({
  collectionId,
  lotId,
  params,
  renderRow,
  emptyText,
}: {
  collectionId: string;
  lotId: string;
  params: LotCopiesParams;
  renderRow: (item: ItemListItem) => React.ReactNode;
  emptyText: string;
}) {
  const query = useLotCopiesInfinite(collectionId, lotId, params);
  return <CopyPageList query={query} renderRow={renderRow} emptyText={emptyText} />;
}

/** A purchase-scoped paginated copy list (across every lot), for the order-level view (#172). */
function PurchaseCopyFlatList({
  collectionId,
  purchaseId,
  params,
  renderRow,
  emptyText,
}: {
  collectionId: string;
  purchaseId: string;
  params: LotCopiesParams;
  renderRow: (item: ItemListItem) => React.ReactNode;
  emptyText: string;
}) {
  const query = usePurchaseCopiesInfinite(collectionId, purchaseId, params);
  return <CopyPageList query={query} renderRow={renderRow} emptyText={emptyText} />;
}

/** A collapsible issue-group section (grouped-by-issue view): a sticky header (built from the
 * summary group + issue header) over the group's copies, supplied as `children` so the copy
 * list can be lot-scoped (by-lot view) or purchase-scoped (order view) (#172). */
function IssueGroupSection({
  group,
  header,
  areaName,
  primaryVendorId,
  vendorMap,
  collapsed,
  countLabel,
  stickyTop,
  onToggle,
  select,
  completeness,
  children,
}: {
  group: { key: string; label: string; count: number };
  header: IssueHeader | null;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  collapsed: boolean;
  /** Wording for the group's copy count. "in lot" ordinarily; "shown" while a filter is narrowing
   * the groups (#622/#623), since the number is then the matching copies rather than the group's
   * whole size. */
  countLabel?: string;
  /** Where this issue header pins — just below the pinned lot header/label above it. */
  stickyTop: number;
  onToggle: () => void;
  /** Tick this whole group into the screen's selection (#571). */
  select?: { state: "on" | "off" | "partial"; onChange: () => void; label: string };
  /** This issue's per-checklist for-sale completeness (#563), absent while it loads. */
  completeness?: ChecklistSetCompleteness[];
  children: React.ReactNode;
}) {
  const { sentinelRef, stuck } = useStuck(stickyTop);
  return (
    <div style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <div
        style={{
          position: "sticky",
          top: stickyTop,
          zIndex: 2,
          boxShadow: stuck ? STUCK_SHADOW : undefined,
        }}
      >
        <LotIssueGroupHeader
          header={header}
          fallbackLabel={group.label}
          copyCount={group.count}
          {...(countLabel ? { countLabel } : {})}
          areaName={areaName}
          primaryVendorId={primaryVendorId}
          vendorMap={vendorMap}
          collapsed={collapsed}
          onToggle={onToggle}
          select={select}
          completeness={completeness}
        />
      </div>
      {!collapsed && (
        <div
          style={{
            background: "var(--color-bg-elevated)",
            borderTop: "1px solid var(--color-border)",
            marginLeft: "1.25rem",
            borderLeft: "2px solid var(--color-border)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function LotCard({
  scanDpi,
  index,
  lot,
  justAdded,
  highlighted,
  onClearHighlight,
  expanded,
  onToggleExpanded,
  issueHeaderById,
  collectionId,
  purchaseId,
  currency,
  baseCurrency,
  areas,
  locations,
  conditions,
  certificateStatuses,
  isPending,
  unidentifiedTileCount,
  parkedTileCount,
  groupByIssue,
  sortKey,
  sortDir,
  dispositionFilter,
  stickyTop,
  selection,
  setSelection,
  onRun,
}: LotCardProps) {
  const [dialog, setDialog] = useState<
    | "none"
    | "picker"
    | "intake-condition"
    | "attach"
    | "edit-price"
    | "delete"
    | "close"
    | "reopen"
  >("none");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  // Collapsed issue groups are remembered per lot, inside the order's entry; the grouping mode
  // itself is an order-level toggle passed in as `groupByIssue` (#121).
  const [collapsedGroups, setCollapsedGroups] = usePurchaseCollapsedGroups(
    collectionId,
    purchaseId,
    lot.id
  );
  // Hold the copies list until the persisted view prefs are read, so grouping/collapse don't
  // flash from their defaults to the stored values for a returning user (#121).
  const hydrated = useHydrated();
  // Optional filter narrowing the copies list to just the blockers ("unpriced"), the not-yet-sorted
  // copies ("to-sort"), or copies still needing a photo ("no-photos", #177), toggled by the matching
  // header chip (#121). Remembered per lot alongside the order's disposition filter, and read back
  // through the endpoints' parser for the same reason.
  const [storedLotFilter, setStoredLotFilter] = usePurchaseLotFilter(
    collectionId,
    purchaseId,
    lot.id
  );
  const filterMode = parseLotCopyFilter(storedLotFilter) ?? "none";
  const setFilterMode = (next: LotCopyFilter) =>
    setStoredLotFilter(next === "none" ? null : next);
  const [blockMessage, setBlockMessage] = useState<string | undefined>();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  // Sticky lot header (#172): pin the name/counts/pool block to the viewport top while its
  // copies scroll, show a drop shadow once pinned, and measure its height so issue-group
  // headers can pin just beneath it.
  const { sentinelRef: headerSentinelRef, stuck: headerStuck } = useStuck(stickyTop);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  // Bring the lot the collector came here for into view, once. `block: "center"` rather than the
  // default: this card's own header is sticky, so a card scrolled to the top edge would sit under
  // the toolbar it just scrolled past.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  const copy = useCopyEditing({
    collectionId,
    areas,
    locations,
    conditions,
    certificateStatuses,
    isPending,
    run: onRun,
  });
  const { copyError, setCopyError } = copy;

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = new Map(areas.map((a) => [a.id, a.name]));

  const open = lot.status === "open";

  // Server-side filter for the copy page query, driven by the header chips. The "unpriced" and
  // "to-sort" chips only show while open, so they collapse to "none" on a closed lot; "no-photos"
  // (#177) stays available regardless of lot status.
  const filter: LotCopyFilter =
    filterMode === "none"
      ? "none"
      : filterMode === "no-photos"
        ? "no-photos"
        : open
          ? filterMode
          : "none";
  // The two filter axes as one value (#622), so the reads, the summary and the containers a tick
  // records cannot end up disagreeing about what is on screen.
  const intakeFilters: IntakeFilterParams = {
    ...(filter === "none" ? {} : { filter }),
    ...(dispositionFilter ? { disposition: dispositionFilter } : {}),
  };

  // Whole-lot aggregates (counts, cost-estimate denominator, derived label, issue groups) that
  // the paginated copy list can no longer compute client-side (#172). Fetched once per lot.
  // Keyed by the filters the list is reading with (#623): the issue groups it reports are the ones
  // those filters leave with copies in them, so a group emptied by a chip stops being drawn instead
  // of heading a "No copies.".
  const summaryQuery = useLotSummary(collectionId, lot.id, intakeFilters);
  const summary = summaryQuery.data;
  // What this lot has earned back (#559), on the same bar as its cost. Only while the card is
  // open: a collapsed lot draws no bar, so the query would answer nobody.
  const lotReturn = useLotReturn(collectionId, lot.id, expanded).data;
  // How close the for-sale stock is to a complete set, per checklist (#563). One read for every
  // issue group on the card — the copies are paged, the groups are not — and only while the card is
  // open *and* grouped by issue, which is the only place the figure is drawn.
  const setCompleteness = useLotSetCompleteness(
    collectionId,
    lot.id,
    expanded && groupByIssue
  ).data;
  const totalCount = summary?.totalCount ?? lot.itemCount;
  // Copies actually in the `to sort` state — the header chip and its filter (#375). Copies still
  // `ordered` or `in transit` have not arrived, so nothing about them is waiting on the collector.
  const toSortCount = summary?.toSortCount ?? 0;
  // The wider "not yet through the sort pass" count (ordered / to sort / in transit), used only
  // to warn before closing (#121) — closing a lot whose copies are still ordered is worth a word.
  const unsortedCount = summary?.unsortedCount ?? 0;
  // A copy blocks a close when it stays in the allocation but has no usable catalog weight.
  const blockingCount = summary?.blockingCount ?? 0;
  // Copies with no attached photo yet — surfaced so the collector can find what still needs
  // photographing (#177). Relevant on open and closed lots alike.
  const noPhotoCount = summary?.noPhotoCount ?? 0;
  // Denominator for the live per-copy cost estimate (Σ positive base weight over staying copies).
  const weightBase = summary?.estimateWeightBase ?? 0;
  const issueGroups = summary?.issueGroups ?? [];

  // Live cost-basis estimate for an open lot needs the base-currency pool, so it is unavailable
  // when no FX rate is known.
  const poolBaseNum = lot.poolBase != null ? Number(lot.poolBase) : null;
  const lotName = lot.title ?? summary?.derivedLabel ?? `Lot ${index + 1}`;
  const statusChip = open ? tintChip("accent", "Open") : tintChip("success", "Closed");

  const listParams: LotCopiesParams = {
    sort: sortKey as LotCopySort,
    sortDir: sortDir as "asc" | "desc",
    filter,
    ...(dispositionFilter ? { disposition: dispositionFilter } : {}),
  };

  // How many copies the current filters are showing — the number "select everything matching"
  // claims, counted over the whole lot by the summary rather than off the loaded page (#565), and
  // over both axes since #622.
  const filteredCount = summary?.filteredCount ?? totalCount;

  // The container this lot's header checkbox stands for. It carries the chip the tick was taken
  // under, so the write means the set the collector was looking at (#565); pressing a chip retires
  // it (`onFilterChange` below), which is what keeps a filter nothing here can evaluate from ever
  // being judged against a row.
  const lotContainer: CopyContainer = {
    lotId: lot.id,
    ...intakeFilters,
  };
  const lotBoxState = containerBoxState(selection, lotContainer);

  /** Press a filter chip. The containers taken under the old chip stop meaning what they said, so
   *  they go with it — the loose ticks are the collector's own choices and stay. */
  function changeFilter(next: typeof filterMode) {
    setFilterMode(next);
    setSelection((s) => dropFilteredContainers(s, lot.id));
  }

  function renderRow(it: ItemListItem) {
    const row = (
      <CopyRow
        collectionId={collectionId}
        item={it}
        open={open}
        estimate={estimateFor(it, poolBaseNum, weightBase, open)}
        highlight={blockedIds.has(it.id)}
        baseCurrency={baseCurrency}
        areas={areas}
        locations={locations}
        primaryVendorByArea={primaryVendorByArea}
        vendorMapFor={vendorMapFor}
        copy={copy}
      />
    );
    // A closed lot's copies are read-only, so they get no checkbox — and no strip either, since
    // there is no mixed list to keep aligned.
    if (!open) return <div key={it.id}>{row}</div>;
    // Where the copy sits comes from the copy itself, not from the heading it happens to be under,
    // so the same selection reads correctly grouped or flat (#571).
    const ref: CopyRef = { id: it.id, lotId: it.lotId ?? null, issueKey: it.issueId ?? "__none__" };
    const checked = isRowSelected(selection, ref);
    return (
      <div
        key={it.id}
        style={{
          display: "flex",
          alignItems: "stretch",
          background: checked ? "var(--color-accent-soft)" : undefined,
        }}
      >
        <label style={SELECT_STRIP}>
          <input
            type="checkbox"
            checked={checked}
            // Unticking a copy a group or the lot above it covers is an *exclusion*, not a shorter
            // list — the container's other copies run past the loaded rows and cannot be
            // enumerated to replace it (#571). So the box is never frozen, at any level.
            onChange={() => setSelection((s) => toggleRow(s, ref))}
            aria-label="Select this copy"
            style={{ cursor: "pointer" }}
          />
        </label>
        <div style={{ flex: 1, minWidth: 0 }}>{row}</div>
      </div>
    );
  }

  const actions: RowAction[] = [
    ...(open
      ? ([
          // "Add stamps" is surfaced as a standalone quick-access button in the header, not here.
          // Attaching an *existing* copy is the correction path beside it (#388) — rare enough to
          // live in the menu, unlike intake, which is what this screen is for.
          {
            key: "attach",
            label: "Attach existing copies…",
            icon: "link",
            hint: "For a copy entered by hand, or filed under the wrong purchase",
            onSelect: () => setDialog("attach"),
          },
          { key: "price", label: "Edit lot", icon: "edit", onSelect: () => setDialog("edit-price") },
          // The whole-lot bulk entries that used to sit here are gone (#571): the lot header's own
          // checkbox selects every copy the list is showing, and the bar above the rows carries
          // Store and Move. A menu entry beside them would be the third door again.
          {
            key: "close",
            label: "Close lot",
            icon: "locked",
            separatorBefore: true,
            onSelect: () => setDialog("close"),
          },
          {
            key: "delete",
            label: "Delete lot",
            icon: "delete",
            danger: true,
            separatorBefore: true,
            onSelect: () => setDialog("delete"),
          },
        ] satisfies RowAction[])
      : ([
          { key: "reopen", label: "Reopen lot", icon: "unlocked", onSelect: () => setDialog("reopen") },
        ] satisfies RowAction[])),
  ];

  function closeDialog() {
    if (!isPending) {
      setDialog("none");
      setCopyError(undefined);
    }
  }

  return (
    <div
      ref={cardRef}
      className={justAdded ? "just-added-flash" : undefined}
      style={{
        border: `1px solid ${blockMessage ? "var(--color-error)" : "var(--color-border)"}`,
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
        overflow: "clip",
        // Drawn as a ring rather than a border so the card does not change size when it appears.
        boxShadow: highlighted ? "0 0 0 2px var(--color-accent)" : undefined,
      }}
    >
      {/* Why this one card is ringed, and the way to stop it being. Deliberately not sticky: the
          ring carries the mark once the strip has scrolled off, and a second sticky band would
          push this lot's figures down the screen. */}
      {highlighted && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.375rem 1.25rem",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-accent-soft)",
            fontSize: "0.75rem",
            color: "var(--color-accent)",
          }}
        >
          <span>Opened from a copy</span>
          <button
            type="button"
            onClick={onClearHighlight}
            aria-label="Clear the highlight"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              fontSize: "0.75rem",
              lineHeight: 1,
            }}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      )}
      {/* Lot header + pool line — pinned to the top while scrolling through this lot's copies
          (#172), so the lot name / counts / pool / actions stay in view; released at the card's
          bottom, where the next lot's header takes over. A drop shadow appears once pinned.
          `overflow: clip` on the card (unlike `hidden`) does not trap the sticky, so this
          degrades to a normal header if a browser disagrees. */}
      <div ref={headerSentinelRef} style={{ height: 0 }} />
      <div
        ref={headerRef}
        style={{
          position: "sticky",
          top: stickyTop,
          zIndex: 3,
          background: "var(--color-bg-elevated)",
          boxShadow: headerStuck ? STUCK_SHADOW : undefined,
        }}
      >
      <div style={{ padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "0.625rem" }}>
        {/* The third checkbox, one level up from an issue group's (#571). It works on a collapsed
            card on purpose: lot cards start collapsed, and making a whole-lot action wait for an
            expand would be the click the ⋮ entries used to save, back by another route. */}
        {open && filteredCount > 0 && (
          <Tooltip
            content={
              filter === "none"
                ? "Select every copy in this lot"
                : "Select every copy the current filter is showing"
            }
          >
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={lotBoxState === "on"}
                ref={(el) => {
                  if (el) el.indeterminate = lotBoxState === "partial";
                }}
                onChange={() => setSelection((sel) => toggleContainer(sel, lotContainer))}
                aria-label="Select every copy this lot is showing"
                style={{ cursor: "pointer" }}
              />
            </label>
          </Tooltip>
        )}
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Collapse" : "Expand"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: 0,
          }}
        >
          <Icon name={expanded ? "collapse" : "expand"} size="sm" />
        </button>
        <Tooltip
          content={lot.title ? undefined : "Derived from the lot's copies — add a title to name it"}
        >
          <span
            style={{
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontStyle: lot.title ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "22rem",
            }}
          >
            {lotName}
          </span>
        </Tooltip>
        <span style={statusChip.style}>{statusChip.label}</span>
        <span style={CHIP}>
          {totalCount} cop{totalCount === 1 ? "y" : "ies"}
        </span>
        {toSortCount > 0 && open && (
          <Tooltip
            content={
              filterMode === "to-sort"
                ? "Showing only copies still to sort — click to show all"
                : "Copies that have arrived and still await sorting — click to show only them"
            }
          >
            <button
              type="button"
              onClick={() =>
                changeFilter(filterMode === "to-sort" ? "none" : "to-sort")
              }
              style={{
                ...tintChip("warning", "").style,
                cursor: "pointer",
                fontWeight: filterMode === "to-sort" ? 700 : 500,
                boxShadow: filterMode === "to-sort" ? "0 0 0 1px var(--color-warning)" : undefined,
              }}
            >
              {toSortCount} to sort
            </button>
          </Tooltip>
        )}
        {blockingCount > 0 && open && (
          <Tooltip
            content={
              filterMode === "unpriced"
                ? "Showing only copies without a catalog price — click to show all"
                : "These copies would block a close — click to show only them"
            }
          >
            <button
              type="button"
              onClick={() =>
                changeFilter(filterMode === "unpriced" ? "none" : "unpriced")
              }
              style={{
                ...tintChip("error", `${blockingCount} unpriced`).style,
                cursor: "pointer",
                fontWeight: filterMode === "unpriced" ? 700 : 500,
                boxShadow: filterMode === "unpriced" ? "0 0 0 1px var(--color-error)" : undefined,
              }}
            >
              <Icon name="warning" size="sm" /> {blockingCount} unpriced
            </button>
          </Tooltip>
        )}
        {noPhotoCount > 0 && (
          <Tooltip
            content={
              filterMode === "no-photos"
                ? "Showing only copies with no photo — click to show all"
                : "Copies with no photo attached — click to show only them"
            }
          >
            <button
              type="button"
              onClick={() =>
                changeFilter(filterMode === "no-photos" ? "none" : "no-photos")
              }
              style={{
                ...tintChip("accent", "").style,
                cursor: "pointer",
                fontWeight: filterMode === "no-photos" ? 700 : 500,
                boxShadow: filterMode === "no-photos" ? "0 0 0 1px var(--color-accent)" : undefined,
              }}
            >
              {noPhotoCount} no photos
            </button>
          </Tooltip>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip content="Lot price">
          <span
            style={{ fontSize: "0.875rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}
          >
            {lot.price} {currency}
          </span>
        </Tooltip>
        {open && (
          <Tooltip content="Identify stamps into this lot">
            <button
              type="button"
              onClick={() => setDialog("picker")}
              disabled={isPending}
              style={{
                ...INPUT_STYLE,
                width: "auto",
                cursor: "pointer",
                fontWeight: 600,
                color: "#fff",
                background: "var(--color-action-primary)",
                border: "none",
                padding: "0.3125rem 0.75rem",
                whiteSpace: "nowrap",
              }}
            >
              <Icon name="add" size="sm" /> Add stamps
            </button>
          </Tooltip>
        )}
        <RowActionsMenu actions={actions} ariaLabel={`Lot ${index + 1} actions`} />
      </div>

      {/* Pool line — part of the pinned header block */}
      <div style={{ padding: "0 1.25rem 0.625rem 2.35rem", display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
        <Tooltip content="Pool = price + share of shipping (transaction currency)">
          <span style={CHIP}>
            Pool {lot.poolTx} {currency}
          </span>
        </Tooltip>
        {currency !== baseCurrency && lot.poolBase != null && (
          <Tooltip content="Pool in base currency at the frozen rate">
            <span style={CHIP}>
              ≈ {lot.poolBase} {baseCurrency}
            </span>
          </Tooltip>
        )}
      </div>
      </div>

      {blockMessage && (
        <div
          style={{
            margin: "0 1.25rem 0.75rem 2.35rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            color: "var(--color-error)",
            background: "var(--color-error-soft, var(--color-bg-page))",
            border: "1px solid var(--color-error-border, var(--color-border))",
          }}
        >
          {blockMessage}
        </div>
      )}

      {/* Copies */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          {totalCount === 0 ? (
            <div style={COPIES_MUTED_STYLE}>No stamps identified into this lot yet.</div>
          ) : !hydrated ? (
            // Placeholder shown for the initial render (matching SSR) until the persisted
            // grouping/collapse prefs are read, so the list doesn't flash its defaults first.
            <div style={COPIES_MUTED_STYLE}>Loading copies…</div>
          ) : (
            <>
              {/* Catalog value vs. actual purchase cost for this lot (#179), and what selling its
                  copies has brought back (#559) — one bar, since both are about these copies */}
              <div style={{ padding: "0.75rem 1.25rem" }}>
                <HoldingsSummaryBar total={summary?.holdings} ret={lotReturn} />
              </div>

              {/* Active-filter toolbar (grouping is now controlled at the order level) */}
              {filterMode !== "none" && (open || filterMode === "no-photos") && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    padding: "0.5rem 1.25rem",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <Tooltip content="Clear filter">
                    <button
                      type="button"
                      onClick={() => changeFilter("none")}
                      style={{
                        ...tintChip(
                          filterMode === "unpriced"
                            ? "error"
                            : filterMode === "no-photos"
                              ? "accent"
                              : "warning",
                          ""
                        ).style,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {filterMode === "unpriced"
                        ? "Unpriced only"
                        : filterMode === "no-photos"
                          ? "No photos only"
                          : "To sort only"}{" "}
                      <Icon name="close" size="sm" />
                    </button>
                  </Tooltip>
                </div>
              )}

              {groupByIssue ? (
                issueGroups.map((group) => {
                  const collapsed = collapsedGroups.has(group.key);
                  const header = group.key === "__none__" ? null : issueHeaderById[group.key];
                  const areaId = header?.collectionAreaId ?? null;
                  return (
                    <IssueGroupSection
                      key={group.key}
                      group={group}
                      header={header ?? null}
                      areaName={areaId ? (areaNameById.get(areaId) ?? null) : null}
                      primaryVendorId={areaId ? (primaryVendorByArea.get(areaId) ?? null) : null}
                      vendorMap={
                        vendorMapFor(areaId, group.key === "__none__" ? null : group.key)
                      }
                      collapsed={collapsed}
                      countLabel={
                        filter !== "none" || dispositionFilter ? "shown" : undefined
                      }
                      stickyTop={stickyTop + headerHeight}
                      completeness={setCompleteness?.[group.key]}
                      onToggle={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      select={
                        open
                          ? {
                              state: containerBoxState(selection, {
                                ...lotContainer,
                                issueKey: group.key,
                              }),
                              onChange: () =>
                                setSelection((sel) =>
                                  toggleContainer(sel, { ...lotContainer, issueKey: group.key })
                                ),
                              label: "Select this issue's copies",
                            }
                          : undefined
                      }
                    >
                      <LotCopyFlatList
                        collectionId={collectionId}
                        lotId={lot.id}
                        params={{ ...listParams, issueKey: group.key }}
                        renderRow={renderRow}
                        emptyText="No copies."
                      />
                    </IssueGroupSection>
                  );
                })
              ) : (
                <LotCopyFlatList
                  collectionId={collectionId}
                  lotId={lot.id}
                  params={listParams}
                  renderRow={renderRow}
                  emptyText={
                    filterMode === "unpriced"
                      ? "No unpriced copies."
                      : filterMode === "to-sort"
                        ? "Nothing left to sort."
                        : filterMode === "no-photos"
                          ? "Every copy has a photo."
                          : // A lot with copies, none of them kept for what the order-level chip
                            // asks (#622) — which is not the same thing as an empty lot.
                            dispositionFilter && totalCount > 0
                            ? "No copies in this lot are kept for that."
                            : "No stamps identified into this lot yet."
                  }
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Intake: browse popup to pick a stamp or a whole issue */}
      {dialog === "picker" && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          onPick={(picked: PickedStamp) => {
            setPending({ kind: "stamp", stampId: picked.stampId, label: pickedStampText(picked) });
            setCopyError(undefined);
            setDialog("intake-condition");
          }}
          onPickIssue={(picked: PickedIssue) => {
            setPending({
              kind: "checklist",
              checklistId: picked.checklistId,
              label: picked.label,
              requiredCount: picked.requiredCount,
            });
            setCopyError(undefined);
            setDialog("intake-condition");
          }}
          onClose={() => setDialog("none")}
        />
      )}

      {/* Intake: condition + certificate before creating the copies */}
      {dialog === "intake-condition" && pending && (
        <IntakeConditionDialog
          selection={pending}
          collectionId={collectionId}
          scanDpi={scanDpi}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          locations={locations}
          isPending={isPending}
          error={copyError}
          onBack={() => {
            if (!isPending) {
              setCopyError(undefined);
              setDialog("picker");
            }
          }}
          onClose={closeDialog}
          onSubmit={(fd) => {
            setCopyError(undefined);
            if (pending.kind === "stamp") fd.set("stampId", pending.stampId);
            else fd.set("checklistId", pending.checklistId);
            onRun(
              async () => {
                const { intakeStampsAction } = await import("@/app/actions/purchases");
                const r = await intakeStampsAction(lot.id, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => {
                setDialog("none");
                setPending(null);
              }
            );
          }}
        />
      )}

      {/* Attach copies that already exist (#388) — the counterpart to intake above, which
          creates them. */}
      {dialog === "attach" && (
        <AttachCopiesDialog
          collectionId={collectionId}
          lotId={lot.id}
          lotLabel={lotName}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          onClose={closeDialog}
          onDone={() => {
            setDialog("none");
            // The dialog owns the mutation; this only refreshes the order and its copy pages.
            onRun(async () => ({ status: "success" }));
          }}
        />
      )}

      {/* Per-copy + bulk editing dialogs (shared with the order-level view) */}
      {copy.dialogs}

      {/* Edit lot (title + price) */}
      {dialog === "edit-price" && (
        <LotDialog
          title="Edit lot"
          actionLabel="Save"
          initialTitle={lot.title}
          initialPrice={lot.price}
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onSubmit={(fd) =>
            onRun(
              async () => {
                const { updateLotAction } = await import("@/app/actions/purchases");
                const r = await updateLotAction(lot.id, fd);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setDialog("none")
            )
          }
        />
      )}

      {/* Delete lot */}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Delete lot"
          message={
            lot.itemCount > 0
              ? `This removes this lot line and its ${lot.itemCount} cop${
                  lot.itemCount === 1 ? "y" : "ies"
                } from the purchase. This cannot be undone.`
              : "This removes this lot line from the purchase."
          }
          actionLabel="Delete lot"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onConfirm={() =>
            onRun(
              async () => {
                const { deleteLotAction } = await import("@/app/actions/purchases");
                const r = await deleteLotAction(lot.id);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setDialog("none")
            )
          }
        />
      )}

      {/* Close lot */}
      {dialog === "close" && (
        <ConfirmDialog
          title="Close lot"
          message={
            <>
              {unsortedCount > 0
                ? `${unsortedCount} cop${
                    unsortedCount === 1 ? "y is" : "ies are"
                  } still unsorted (ordered / to sort / in transit). You can still close — closing runs the cost allocation and freezes each copy's cost-basis — but sorting first is recommended. Closing is blocked only if a copy lacks a primary-catalog price for its condition.`
                : "Closing runs the cost allocation and freezes each copy's cost-basis. Closing is blocked if any copy lacks a primary-catalog price for its condition."}
              {/* A warning, never a block (#566) — the same call the unsorted count makes. A tile
                  has no stamp, so no catalogue price, so no weight in the split: closing without it
                  is arithmetically fine, and it is the collector's memory that needs the nudge.
                  Counted over the **order** since #586, because that is where a card lives now:
                  any of those tiles could still become a copy on this lot, which is exactly why
                  closing it while they wait is worth mentioning. */}
              {unidentifiedTileCount > 0 && (
                <>
                  {" "}
                  <strong>
                    {unidentifiedTileCount} scan tile
                    {unidentifiedTileCount === 1 ? " is" : "s are"} still unidentified
                  </strong>{" "}
                  on this order and {unidentifiedTileCount === 1 ? "takes" : "take"} no share of the
                  cost — they survive the close, but nothing will remind you of them afterwards.
                </>
              )}
              {/* The parked ones are named separately (#597): they are outstanding in the same way
                  and none of the arithmetic changes, but they have deliberately left the queue, so
                  the chip that would otherwise nag about them is silent — which makes this the one
                  place they are put back in front of the collector before the money is frozen. */}
              {parkedTileCount > 0 && (
                <>
                  {" "}
                  <strong>
                    {parkedTileCount} tile{parkedTileCount === 1 ? " is" : "s are"} parked to be
                    checked
                  </strong>{" "}
                  and could still become {parkedTileCount === 1 ? "a copy" : "copies"} on this lot.
                </>
              )}
            </>
          }
          actionLabel="Close lot"
          pendingLabel="Closing…"
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onConfirm={() => {
            setCopyError(undefined);
            setBlockMessage(undefined);
            startCloseTransition();
          }}
        />
      )}

      {/* Reopen lot */}
      {dialog === "reopen" && (
        <ConfirmDialog
          title="Reopen lot"
          message="Reopening returns every copy's cost-basis to pending so you can correct the lot, then close it again."
          actionLabel="Reopen lot"
          pendingLabel="Reopening…"
          isPending={isPending}
          error={copyError}
          onClose={closeDialog}
          onConfirm={() =>
            onRun(
              async () => {
                const { reopenLotAction } = await import("@/app/actions/purchases");
                const r = await reopenLotAction(lot.id);
                if (r.status === "error") setCopyError(r.message);
                return r;
              },
              () => setDialog("none")
            )
          }
        />
      )}
    </div>
  );

  // Close needs bespoke handling: a "blocked" result is neither success nor a plain error.
  function startCloseTransition() {
    onRun(
      async () => {
        const { closeLotAction } = await import("@/app/actions/purchases");
        const r = await closeLotAction(lot.id);
        if (r.status === "blocked") {
          setBlockMessage(r.message);
          setBlockedIds(new Set(r.itemIds));
          setDialog("none");
          // Report as a benign non-success so the shared runner does not also set a
          // generic error; the inline banner carries the detail.
          return { status: "handled" };
        }
        if (r.status === "error") setCopyError(r.message);
        if (r.status === "success") {
          setBlockMessage(undefined);
          setBlockedIds(new Set());
        }
        return r;
      },
      () => setDialog("none")
    );
  }
}

/** The order-level copies view (#121), shown when "By lot" grouping is off: every copy in the
 * purchase in one place — a single flat, globally-ordered list, or grouped by issue **across all
 * lots** — with the same inline delivery / disposition / location editing and per-copy menu as
 * the lot cards. Copies stream from one purchase-wide paginated endpoint (#172), so there are no
 * per-lot boundaries here. Lot-level management (add stamps, close, price…) has no home in this
 * view; switch to the by-lot view for that. Each copy stays editable only while its own lot is
 * open, and its estimate uses its own lot's pool + weight base. */
function OrderCopiesView({
  collectionId,
  purchaseId,
  lots,
  issueHeaderById,
  baseCurrency,
  areas,
  locations,
  conditions,
  certificateStatuses,
  byIssue,
  sortKey,
  sortDir,
  dispositionFilter,
  stickyTop,
  isPending,
  selection,
  setSelection,
  run,
}: {
  collectionId: string;
  purchaseId: string;
  lots: LotSummary[];
  issueHeaderById: Record<string, IssueHeader>;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  byIssue: boolean;
  sortKey: string;
  sortDir: string;
  /** The order-level *Kept for* filter (#622) — the only filter this view has, and the same value
   * the lot cards read, so switching the grouping does not change what is on screen. */
  dispositionFilter: CopyDispositionFilter | null;
  /** Where the pinned selection bar ends (#621), so the issue headers pin below it. */
  stickyTop: number;
  isPending: boolean;
  /** The order's one selection (#571), shared with the by-lot view — switching how the copies are
   *  grouped is a change of view, not of what was picked. */
  selection: CopySelection;
  setSelection: React.Dispatch<React.SetStateAction<CopySelection>>;
  run: RunFn;
}) {
  const copy = useCopyEditing({
    collectionId,
    areas,
    locations,
    conditions,
    certificateStatuses,
    isPending,
    run,
  });
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const hydrated = useHydrated();
  const [collapsedGroups, setCollapsedGroups] = usePurchaseCollapsedGroups(
    collectionId,
    purchaseId,
    ORDER_GROUP_SCOPE
  );

  // Each copy's lot drives its editability (its lot must be open) and its estimate (its lot's
  // pool + weight base). Pool + status come from the purchase's lots; the per-lot weight base
  // (Σ catalog weight) comes from the purchase summary.
  const poolBaseByLot = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const l of lots) m.set(l.id, l.poolBase != null ? Number(l.poolBase) : null);
    return m;
  }, [lots]);
  const lotStatusByLot = useMemo(() => new Map(lots.map((l) => [l.id, l.status])), [lots]);
  // The same filters the panel reads this summary with, so both share one cached answer — and the
  // issue groups come back over the copies those filters show (#623).
  const intakeFilters: IntakeFilterParams = dispositionFilter
    ? { disposition: dispositionFilter }
    : {};
  const summary = usePurchaseSummary(collectionId, purchaseId, intakeFilters).data;
  const issueGroups = summary?.issueGroups ?? [];
  // The same figure as the lot cards' (#563), but *from here* means "arrived in this parcel" —
  // these groups are merged across every lot of the order, which is what this view is for.
  const setCompleteness = usePurchaseSetCompleteness(collectionId, purchaseId, byIssue).data;

  const listParams: LotCopiesParams = {
    sort: sortKey as LotCopySort,
    sortDir: sortDir as "asc" | "desc",
    filter: "none",
    ...intakeFilters,
  };

  const renderRow = (it: ItemListItem) => {
    const lotId = it.lotId ?? "";
    const open = lotStatusByLot.get(lotId) === "open";
    const poolBase = poolBaseByLot.get(lotId) ?? null;
    const weightBase = summary?.lotWeightBase[lotId] ?? 0;
    const row = (
      <CopyRow
        collectionId={collectionId}
        item={it}
        open={open}
        estimate={estimateFor(it, poolBase, weightBase, open)}
        highlight={false}
        baseCurrency={baseCurrency}
        areas={areas}
        locations={locations}
        primaryVendorByArea={primaryVendorByArea}
        vendorMapFor={vendorMapFor}
        copy={copy}
      />
    );
    // A closed lot's copies are read-only here exactly as they are on their own lot card, so they
    // get no checkbox — which is also why the scope carries `onlyOpenLots` (#571).
    if (!open) return <div key={it.id}>{row}</div>;
    const ref: CopyRef = { id: it.id, lotId: it.lotId ?? null, issueKey: it.issueId ?? "__none__" };
    const checked = isRowSelected(selection, ref);
    return (
      <div
        key={it.id}
        style={{
          display: "flex",
          alignItems: "stretch",
          background: checked ? "var(--color-accent-soft)" : undefined,
        }}
      >
        <label style={SELECT_STRIP}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => setSelection((sel) => toggleRow(sel, ref))}
            aria-label="Select this copy"
            style={{ cursor: "pointer" }}
          />
        </label>
        <div style={{ flex: 1, minWidth: 0 }}>{row}</div>
      </div>
    );
  };

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
        overflow: "clip",
      }}
    >
      {!hydrated ? (
        <div style={COPIES_MUTED_STYLE}>Loading copies…</div>
      ) : lots.length === 0 ? (
        <div style={COPIES_MUTED_STYLE}>No copies identified into this order yet.</div>
      ) : byIssue ? (
        issueGroups.map((group) => {
          const collapsed = collapsedGroups.has(group.key);
          const header = group.key === "__none__" ? null : issueHeaderById[group.key];
          const areaId = header?.collectionAreaId ?? null;
          // Only groups with copies in a still-open lot can be selected — the rest are read-only.
          const canSelect = group.openCount > 0;
          return (
            <IssueGroupSection
              key={group.key}
              group={group}
              header={header ?? null}
              areaName={areaId ? (areaNameById.get(areaId) ?? null) : null}
              primaryVendorId={areaId ? (primaryVendorByArea.get(areaId) ?? null) : null}
              vendorMap={vendorMapFor(areaId, group.key === "__none__" ? null : group.key)}
              collapsed={collapsed}
              countLabel={dispositionFilter ? "shown" : undefined}
              stickyTop={stickyTop}
              completeness={setCompleteness?.[group.key]}
              onToggle={() =>
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
              select={
                canSelect
                  ? {
                      state: containerBoxState(selection, {
                        issueKey: group.key,
                        ...intakeFilters,
                      }),
                      onChange: () =>
                        setSelection((sel) =>
                          toggleContainer(sel, { issueKey: group.key, ...intakeFilters })
                        ),
                      label: "Select this issue's copies",
                    }
                  : undefined
              }
            >
              <PurchaseCopyFlatList
                collectionId={collectionId}
                purchaseId={purchaseId}
                params={{ ...listParams, issueKey: group.key }}
                renderRow={renderRow}
                emptyText="No copies."
              />
            </IssueGroupSection>
          );
        })
      ) : (
        <PurchaseCopyFlatList
          collectionId={collectionId}
          purchaseId={purchaseId}
          params={listParams}
          renderRow={renderRow}
          emptyText={
            dispositionFilter
              ? "No copies in this order are kept for that."
              : "No copies identified into this order yet."
          }
        />
      )}
      {copy.dialogs}
    </div>
  );
}

interface LotDialogProps {
  title: string;
  actionLabel: string;
  initialTitle?: string | null;
  initialPrice?: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** Dialog for a lot's title (optional) and price (add lot / edit lot). */
function LotDialog({
  title,
  actionLabel,
  initialTitle,
  initialPrice,
  isPending,
  error,
  onClose,
  onSubmit,
}: LotDialogProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }
  return (
    <DialogShell title={title} onClose={onClose} maxWidth="24rem">
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="lot-title">Title (optional)</LabelWithError>
            <input
              id="lot-title"
              name="title"
              type="text"
              placeholder="e.g. Album Polska 1950s"
              defaultValue={initialTitle ?? ""}
              autoFocus
              disabled={isPending}
              style={INPUT_STYLE}
            />
            <p style={{ margin: "0.375rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
              Leave blank to label the lot by the stamps you add to it.
            </p>
          </div>
          <LabelWithError htmlFor="lot-price">Lot price</LabelWithError>
          <NumericInput
            id="lot-price"
            name="price"
            required
            defaultValue={initialPrice ?? ""}
            disabled={isPending}
            style={INPUT_STYLE}
          />
        </DialogBody>
        <DialogActions actionLabel={isPending ? "Saving…" : actionLabel} onCancel={onClose} disabled={isPending} error={error} />
      </form>
    </DialogShell>
  );
}


/** A small dialog that picks one storage location (tree-select) and confirms — reused by the
 * arrival flow (optional "incoming box") and the bulk "move copies to location" actions
 * (#121). With `allowNone` the confirm is enabled with no location chosen (arrival / clearing);
 * otherwise a location must be selected. When `rememberForCollectionId` is set, the picker
 * pre-fills with the last location used in that collection and stores the chosen one on
 * confirm, so repeated filing defaults to where you just filed. */
function LocationPickerDialog({
  title,
  message,
  actionLabel,
  locations,
  initialLocationId,
  allowNone = false,
  rememberForCollectionId,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  message: React.ReactNode;
  actionLabel: string;
  locations: LocationData[];
  initialLocationId?: string;
  allowNone?: boolean;
  rememberForCollectionId?: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (locationId: string) => void;
}) {
  const [locationId, setLocationId] = useState(() => {
    if (initialLocationId) return initialLocationId;
    if (!rememberForCollectionId) return "";
    // Restore the last-used location, but only if it still exists and can hold copies.
    const last = readLast(LS_LAST_LOCATION, rememberForCollectionId);
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  const canConfirm = !isPending && (allowNone || locationId !== "");
  return (
    <DialogShell title={title} onClose={onClose} maxWidth="26rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (rememberForCollectionId && locationId) {
            writeLast(LS_LAST_LOCATION, rememberForCollectionId, locationId);
          }
          onConfirm(locationId);
        }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            {message}
          </p>
          <LabelWithError htmlFor="loc-picker-button">Location</LabelWithError>
          {locations.length === 0 ? (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              No locations defined yet. Add some on the Locations screen first.
            </p>
          ) : (
            <LocationTreeSelect
              locations={locations}
              locationTree={locationTree}
              name="locationId"
              selectedId={locationId}
              onSelectedIdChange={setLocationId}
              onlyAssignableSelectable
              disabled={isPending}
              noneOptionLabel="— None"
            />
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Working…" : actionLabel}
          onCancel={onClose}
          disabled={!canConfirm}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

/**
 * Record, in one act, that a batch of copies has been **put away** (#565/#571): where they now
 * live, the ref card they sit on, what they are being kept for, and `delivered`.
 *
 * **One dialog, because it was never two writes.** *Mark all copies sorted*, *File copies* and
 * *Move all copies* were three doors onto the same bulk update, and which one a collector opened
 * decided what they were allowed to say — file a whole issue group and there was nowhere to type
 * the ref. Store asks all of it at once; *Move to location* stays separate because it makes no
 * claim that anything was worked through (#571).
 *
 * **Every field may be left alone**, and that is what makes the merge a superset rather than a
 * trade. The location's *Leave as is* is today's mark-sorted with no location chosen — the
 * documented path for a batch whose copies were filed one at a time during the pass, where a
 * blanket address would overwrite exactly the decisions that took longest to make. The
 * disposition's own *Leave as is* (#274) is the same idea, and is deliberately distinct from
 * turning all three chips off, which *clears* the dispositions.
 *
 * Sorting a lot sends its copies two ways and it is one act either way — stock onto transport cards
 * carrying a running ref (`A147`), keepers into an album where the album itself is the address. So
 * the ref is what differs, not whether the copy gets put away, and it is optional for that reason.
 * A ref still needs a location to sit in (`assertRefHasLocation`), since it addresses a place
 * *inside* one — so *Leave as is* and a ref together is refused.
 *
 * Nothing is **allocated** here. The index cards are printed blank and ahead of time (the strip is
 * on the Locations screen), the stamps are packed onto a card, and only then is the filing
 * recorded — so the app offers the number the strip is up to and takes confirmation, rather than
 * handing out refs behind the collector's back.
 *
 * **The card offered is the one being packed, not the next blank one** (#629). A transport card
 * takes twenty stamps and is filled over several sittings, so *continuing* `A147` is the ordinary
 * act and *starting* `A148` is the exception — and an app that opened on the next free number made
 * the collector type the previous one back in, every time, which is precisely the ref most easily
 * mistyped. Starting a new card is therefore an explicit press (*Next ref*) rather than a default,
 * and it fills the box the same way typing does: it is a suggestion the collector can still edit.
 *
 * Both come from the **target location**, never the lot: the box is shared across every purchase,
 * and a per-lot counter would drop two `A147`s from two stockbooks into one box. A location nothing
 * has ever been ref'd in offers nothing and stays blank — the normal case for an album, and the
 * reason the ref is optional at all.
 */
function StoreCopiesDialog({
  count,
  locations,
  collectionId,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  count: number;
  locations: LocationData[];
  collectionId: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (result: {
    /** The disposition to write, or null for "leave each copy's own untouched" (#274). */
    disposition: { inCollection: boolean; forSale: boolean; forTrade: boolean } | null;
    /** Blank means "leave each copy where it sits" — no location is written at all (#571). */
    locationId: string;
    locationRef: string;
  }) => void;
}) {
  const params = useParams<{ collectionSlug: string }>();
  const [locationId, setLocationId] = useState(() => {
    const last = readLast(LS_LAST_LOCATION, collectionId);
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  const [flags, setFlags] = useState({ inCollection: true, forSale: false, forTrade: false });
  // "Leave as is" is a mode over the three chips, not a fourth flag: the chips keep whatever
  // they were set to, so stepping in and back out of it does not lose the choice made first.
  // It leads, because storing a batch is rarely the moment its destiny is decided.
  const [keepDisposition, setKeepDisposition] = useState(true);
  // Only the *typed* ref is state; until the collector types, the box simply shows the card this
  // location is up to. Derived rather than copied in, so switching location re-offers on its own —
  // and once they have typed, what they typed stands, because a typed ref is their answer to "where
  // is this strip actually up to". *Next ref* writes through the same field, so a generated number
  // is as editable as a typed one and reverting to the current card is a second press away.
  const [typedRef, setTypedRef] = useState<string | null>(null);
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  const usage = useLocationRefUsage(collectionId, locationId);
  /** The card being packed — the default (#629). */
  const highest = usage.data?.highest ?? null;
  /** The first blank one, offered only on request. */
  const suggestion = usage.data?.suggestion ?? null;
  const ref = typedRef ?? highest ?? "";

  const trimmedRef = ref.trim();
  // A ref already in use is a **confirmation, not an error**: a card holding twenty stamps is
  // rarely filled in one sitting, so topping one up is the normal path. It is still worth saying
  // out loud, because an unexpected collision (a typo) reads differently from an expected one.
  const collision = trimmedRef
    ? (usage.data?.refs.find((r) => r.ref.toLocaleLowerCase() === trimmedRef.toLocaleLowerCase())
        ?.count ?? 0)
    : 0;
  // Which of the two it is, now that the card being packed is what the dialog opens on (#629):
  // landing on the current card is the expected path and says so in the quiet voice, while any
  // other collision is the one that might be a typo and keeps the warning colour. Without the
  // split, the default state of the dialog would carry a warning — and a warning shown every time
  // is one nobody reads on the day it means something.
  const continuingCurrentCard =
    highest != null && trimmedRef.toLocaleLowerCase() === highest.toLocaleLowerCase();
  // Blank cards are printed for the cards *not yet packed*, so the strip starts one past the one
  // being filled — otherwise the default (#629) would print a fresh card carrying a ref that
  // already has stamps on it. A ref the collector typed themselves is taken at face value: they
  // are saying where their strip actually is.
  const printFrom = continuingCurrentCard ? (suggestion ?? "") : trimmedRef;

  const copies = `${count} cop${count === 1 ? "y" : "ies"}`;
  return (
    <DialogShell title="Store copies" onClose={onClose} maxWidth="26rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (locationId) writeLast(LS_LAST_LOCATION, collectionId, locationId);
          onConfirm({
            disposition: keepDisposition ? null : flags,
            locationId,
            locationRef: trimmedRef,
          });
        }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
            Puts {copies} away and marks {count === 1 ? "it" : "them"}{" "}
            <strong>delivered</strong>. Copies already sorted, damaged, or not delivered keep
            their delivery status — anything set below still applies to them.
          </p>

          <LabelWithError htmlFor="store-copies-location">Location</LabelWithError>
          {locations.length === 0 ? (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              No locations defined yet. Add some on the Locations screen first.
            </p>
          ) : (
            <LocationTreeSelect
              locations={locations}
              locationTree={locationTree}
              name="locationId"
              selectedId={locationId}
              onSelectedIdChange={(id) => {
                setLocationId(id);
                // The counter belongs to the location, so a ref typed for the last one means
                // nothing here — drop back to the new location's own suggestion.
                setTypedRef(null);
              }}
              onlyAssignableSelectable
              disabled={isPending}
              noneOptionLabel="— Leave as is"
            />
          )}

          <div style={{ marginTop: "1rem" }}>
            <LabelWithError htmlFor="store-copies-ref">Ref (optional)</LabelWithError>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                id="store-copies-ref"
                type="text"
                value={locationId ? ref : ""}
                onChange={(e) => setTypedRef(e.target.value)}
                disabled={isPending || !locationId}
                placeholder={locationId ? (highest ?? "No refs used here yet") : "Choose a location first"}
                style={{ ...INPUT_STYLE, fontVariantNumeric: "tabular-nums" }}
              />
              {/* Starting a new card, on request (#629). Shown only where there is a counter to
                  count on from: a location that has never been ref'd in has no next number to
                  offer, and inventing `1` for an album is exactly what the blank field prevents.
                  It writes into the field rather than committing anything — the collector still
                  sees the number they are about to file under, and can still change it. */}
              {locationId && suggestion != null && (
                <Tooltip
                  content={`Start a new card — fills in ${suggestion}, the first ref not yet used here`}
                  style={{ flexShrink: 0 }}
                >
                  <DialogSecondaryButton
                    disabled={isPending}
                    onClick={() => setTypedRef(suggestion)}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Next ref
                  </DialogSecondaryButton>
                </Tooltip>
              )}
            </div>
            <p style={{ margin: "0.375rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {!locationId
                ? "The ref numbers a card inside a location, so pick the location first."
                : usage.isLoading
                  ? "Reading this location’s refs…"
                  : highest == null
                    ? "Nothing has been ref’d in this location yet — leave it blank for an album, where the location is the address."
                    : `${highest} is the card this location is up to — keep filling it${
                        suggestion ? `, or start ${suggestion} with Next ref` : ""
                      }.`}{" "}
              {locationId && (
                <Link
                  href={`/c/${params.collectionSlug}/locations/ref-cards?locationId=${locationId}${
                    printFrom ? `&start=${encodeURIComponent(printFrom)}` : ""
                  }`}
                  target="_blank"
                  style={{ color: "var(--color-accent)" }}
                >
                  Print blank ref cards
                </Link>
              )}
            </p>
            {locationId && collision > 0 && (
              <p
                style={{
                  margin: "0.5rem 0 0",
                  fontSize: "0.75rem",
                  color: continuingCurrentCard
                    ? "var(--color-text-secondary)"
                    : "var(--color-warning)",
                }}
              >
                <Icon name={continuingCurrentCard ? "check" : "warning"} size="sm" /> {trimmedRef}{" "}
                already holds {collision} cop{collision === 1 ? "y" : "ies"} here. Adding {copies}{" "}
                to it.
              </p>
            )}
          </div>

          <div style={{ marginTop: "1rem" }}>
            <LabelWithError htmlFor="store-copies-disposition">Disposition</LabelWithError>
            <div id="store-copies-disposition" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <Tooltip content="Keep whatever disposition each copy already carries — only the delivery status (and anything set above) change">
                <button
                  type="button"
                  aria-pressed={keepDisposition}
                  disabled={isPending}
                  onClick={() => setKeepDisposition(true)}
                  style={{
                    ...CHIP,
                    cursor: isPending ? "not-allowed" : "pointer",
                    fontWeight: keepDisposition ? 600 : 500,
                    color: keepDisposition ? "var(--color-accent)" : "var(--color-text-secondary)",
                    borderColor: keepDisposition ? "var(--color-accent)" : "var(--color-border)",
                    background: keepDisposition ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                  }}
                >
                  {keepDisposition && <Icon name="check" size="xs" />} Leave as is
                </button>
              </Tooltip>
              {/* The three flags are one selection against "Leave as is": picking any of them
                  leaves that mode, and turning them all off *clears* the dispositions. */}
              {DISPOSITION_FLAGS.map((d) => {
                const on = !keepDisposition && flags[d.key];
                return (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={on}
                    disabled={isPending}
                    onClick={() => {
                      if (keepDisposition) {
                        setKeepDisposition(false);
                        setFlags((f) => (f[d.key] ? f : { ...f, [d.key]: true }));
                        return;
                      }
                      setFlags((f) => ({ ...f, [d.key]: !f[d.key] }));
                    }}
                    style={{
                      ...CHIP,
                      cursor: isPending ? "not-allowed" : "pointer",
                      fontWeight: on ? 600 : 500,
                      color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: on ? "var(--color-accent)" : "var(--color-border)",
                      background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                      opacity: keepDisposition ? 0.6 : 1,
                    }}
                  >
                    <Icon name={on ? "check" : "add"} size="xs" /> {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending
              ? "Storing…"
              : !locationId
                ? "Store copies"
                : collision > 0
                  ? `Add to ${trimmedRef}`
                  : trimmedRef
                    ? `Store as ${trimmedRef}`
                    : "Store copies"
          }
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

/** A collapsible issue header for the grouped-by-issue lot view, rendered to read like a
 * row on the issues list (area chip · title · catalog chips · required/total badge), plus a
 * count of how many of the lot's copies fall under it. Falls back to a plain label for
 * copies with no issue. */
/** Lot-specific chips appended to a copy's inventory row (#121), in lifecycle order:
 * **delivery status** → **disposition** → **cost-basis**. On an open lot the delivery chip is
 * an inline dropdown and the disposition chip expands to toggles (both edit the copy in place,
 * the fast path for sorting); moving delivery to `delivered` auto-expands the disposition
 * editor so the collector picks in-collection / for-sale / for-trade. Cost-basis is the frozen
 * snapshot once the lot is closed, otherwise a live estimate (never persisted). */
function LotCopyChips({
  item,
  baseCurrency,
  estimate,
  onSetDeliveryState,
  onSetDisposition,
}: {
  item: ItemListItem;
  baseCurrency: string;
  estimate: number | null;
  onSetDeliveryState?: (state: string) => void;
  onSetDisposition?: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
}) {
  const delivery = {
    label: deliveryStateLabel(item.deliveryState),
    token: deliveryStateToken(item.deliveryState),
  };
  const chipStyle = tintChip(delivery.token, delivery.label).style;

  // Next step along the happy-path progression, for the per-copy quick-advance button (#159).
  // Null at "delivered" and on the exception outcomes, where the button is hidden.
  const advIdx = DELIVERY_ADVANCE_ORDER.indexOf(item.deliveryState);
  const nextDelivery =
    advIdx >= 0 && advIdx < DELIVERY_ADVANCE_ORDER.length - 1
      ? DELIVERY_ADVANCE_ORDER[advIdx + 1]
      : null;

  return (
    <>
      {onSetDeliveryState ? (
        <Tooltip content="Set this copy's delivery status">
          <select
            aria-label="Delivery status"
            value={item.deliveryState}
            onChange={(e) => onSetDeliveryState(e.target.value)}
            style={{
              ...chipStyle,
              cursor: "pointer",
              paddingRight: "1.25rem",
              // A native select for keyboard/click reliability, tinted like the chip.
              appearance: "auto",
            }}
          >
            {DELIVERY_STATES.map((s) => (
              <option key={s} value={s}>
                {deliveryStateLabel(s)}
              </option>
            ))}
          </select>
        </Tooltip>
      ) : (
        <span style={chipStyle}>{delivery.label}</span>
      )}

      {/* One-click advance to the next step in the happy-path progression (#159). Only while
          the copy is editable (lot open) and not at a terminal/exception state. */}
      {onSetDeliveryState && nextDelivery && (
        <Tooltip content={`Advance to ${deliveryStateLabel(nextDelivery)}`}>
          <button
            type="button"
            aria-label={`Advance delivery status to ${deliveryStateLabel(nextDelivery)}`}
            onClick={() => onSetDeliveryState(nextDelivery)}
            style={{
              ...CHIP,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontWeight: 600,
              lineHeight: 1,
              padding: "0.125rem 0.375rem",
              color: "var(--color-text-secondary)",
            }}
          >
            →
          </button>
        </Tooltip>
      )}

      {onSetDisposition ? (
        <DispositionInline item={item} onSet={onSetDisposition} />
      ) : (
        DISPOSITION_FLAGS.filter((d) => item[d.key]).map((d) => (
          <span key={d.key} style={CHIP}>
            {d.label}
          </span>
        ))
      )}

      {item.costBasis != null ? (
        <Tooltip content="Frozen cost-basis (base currency)">
          <span style={{ ...CHIP, fontVariantNumeric: "tabular-nums" }}>
            cost {item.costBasis} {baseCurrency}
          </span>
        </Tooltip>
      ) : estimate != null ? (
        <Tooltip content="Estimated cost-basis if the lot closed now — computed live, frozen when you close the lot.">
          <span
            style={{
              ...CHIP,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-muted)",
              fontStyle: "italic",
            }}
          >
            ~{estimate.toFixed(2)} {baseCurrency}
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="Cost-basis can't be estimated yet — this copy has no catalog price for its condition (or the purchase has no base-currency rate).">
          <span style={{ ...CHIP, color: "var(--color-text-muted)" }}>cost —</span>
        </Tooltip>
      )}
    </>
  );
}

/** Inline disposition editor for a lot copy (#121, #160): always shows the three flags as
 * toggle chips that persist instantly on click — no expand or confirm step. */
function DispositionInline({
  item,
  onSet,
}: {
  item: ItemListItem;
  onSet: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
}) {
  return (
    <DispositionChips
      values={{
        inCollection: item.inCollection,
        forSale: item.forSale,
        forTrade: item.forTrade,
      }}
      onToggle={(flag, value) => onSet(flag, value)}
    />
  );
}

/** The three disposition flags rendered as instant-toggle chips (#160). Shared by the per-copy
 * inline editor and the intake dialog: `values` holds the current on/off of each flag and
 * `onToggle` flips one. Purely presentational — the caller decides whether a toggle persists
 * immediately (per-copy) or updates form state (intake). */
function DispositionChips({
  values,
  onToggle,
  disabled,
}: {
  values: { inCollection: boolean; forSale: boolean; forTrade: boolean };
  onToggle: (flag: "inCollection" | "forSale" | "forTrade", value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      {DISPOSITION_FLAGS.map((d) => {
        const on = values[d.key];
        return (
          <button
            key={d.key}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(d.key, !on)}
            style={{
              ...CHIP,
              cursor: disabled ? "default" : "pointer",
              fontWeight: on ? 600 : 500,
              color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
              borderColor: on ? "var(--color-accent)" : "var(--color-border)",
              background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
            }}
          >
            <Icon name={on ? "check" : "add"} size="xs" /> {d.label}
          </button>
        );
      })}
    </span>
  );
}

interface IntakeConditionDialogProps {
  selection: PendingSelection;
  collectionId: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  /** Overrides the confirm-button label. Used by the "add lot with stamps" flow where this
   * dialog only captures the choice and advances to the price step (so "Continue", not
   * "Add copy"). Defaults to the copy-count label. */
  submitLabel?: string;
  /** Identifying a **scan tile** (#567): the tile's own crops become this copy's front and back,
   * so the uploader is left out. Not cosmetic — front and back are singleton slots per copy, and
   * an upload arriving beside the tile's crop would be a second front for the same copy. */
  hidePhotos?: boolean;
  /**
   * The pieces this dialog is asking about, drawn beside the form (#592) — present only where there
   * is a picture of **this** piece, which today is the scan-tile flow alone.
   *
   * Condition is *read off the piece*: the cancel decides used against mint, the gum and the hinge
   * marks are on the back, the centring and the margins are on the front. Until #592 the picture
   * was on the tile dialog and nowhere after it, so the collector answered from memory or went back
   * — forty times per card.
   *
   * The stamp's **catalogue photo is deliberately not a fallback**. It is a picture of *a*
   * specimen; beside a condition field it would invite reading a condition off the wrong stamp, and
   * an intake with no scan behind it is better with nothing there.
   *
   * **Several** pieces (#596) are all drawn, small, rather than one of them standing for the rest —
   * ticking them was the collector asserting they are one stamp in one condition, and this is the
   * last place a mistake in that assertion costs a click instead of N copies.
   */
  pieces?: IdentifiedPiece[];
  /** The collection's stated scan resolution (#598), for the measuring tools inside that viewer. */
  scanDpi: number;
  /**
   * How many copies this submit is about to create (#596), when that is more than the selection
   * itself says — a run of tiles identified as one stamp. Stated in the summary box and on the
   * confirm button, before anything exists, as every other bulk action on this screen states it.
   */
  copyCount?: number;
  /**
   * The previous tile's answers, filled into every field this dialog holds (#595) — present only on
   * *Same as the last*, which is why the fields below still read the remembered collection-wide
   * defaults on every other route in.
   *
   * It leads those defaults wherever both have something to say, because the two differ exactly when
   * it matters: after the collector has changed something for this card. And it fills the three the
   * defaults have nothing to say about at all — the stamp (chosen one step back, so it arrives as
   * the `selection`), the format and the in-location ref.
   *
   * The **format** being among them is not a reversal of #573. That decision is about what happens
   * behind the collector's back: a value usually right may be remembered, one usually wrong must not
   * be, because a wrong value nobody chose is invisible. Here the collector pressed a button that
   * named the format it would apply, so nothing is inherited — it was asked for.
   */
  prefill?: {
    conditionId: string;
    certificateStatusId: string;
    formatId: string;
    locationId: string;
    locationRef: string;
    disposition: { inCollection: boolean; forSale: boolean; forTrade: boolean };
    lotId: string;
  };
  /**
   * Which lot the created copy belongs to (#586) — asked only when identifying a scan tile, since
   * every other entry into this dialog was reached *through* a lot and already knows.
   *
   * A copy takes its cost basis from a lot, and a card of a settled auction holds pieces belonging
   * to a dozen of them, so the answer cannot come from the scan. It is asked **here**, beside the
   * condition and the location, because this is the step that asks everything else about the copy —
   * and it is remembered here for the same reason those are: a card, or a run of them, is worked
   * through before the next is started, so the answer is stable across a long stretch of tiles.
   *
   * With **one** open lot nothing is asked: that is the stockbook case, which had no such question
   * before the re-parenting and must not gain one.
   */
  lotChoice?: {
    /** Scopes the remembered answer. A lot id means nothing on the next parcel, so remembering it
     * per collection — as the condition and location are — would restore an id that is refused. */
    purchaseId: string;
    /** The order's **open** lots, in the order the cards are drawn in. A closed lot takes no new
     * copy at all, so offering it would be offering a refusal. */
    lots: { id: string; label: string; status: string }[];
  };
  onBack: () => void;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

// The last condition/certificate/location/disposition chosen for an add-copy are remembered
// across every entry point (#121, #234) — see shared/add-copy-defaults (readLast/writeLast).
// Persisted order-level view preferences (#121): whether copies group by lot and/or by issue, and
// how the copies inside sort. Held **per collection** — they are a way of reading an order, not a
// fact about one, so a collector who works by issue works by issue everywhere. What belongs to one
// order (its expanded lots, collapsed groups and filters) lives in that order's own entry instead,
// under a cap — see shared/purchase-ui-state. Suffixed with the ids by the caller.
const LS_GROUP_BY_LOT = "stamporama:lot:groupByLot";
const LS_GROUP_BY_ISSUE = "stamporama:lot:groupByIssue";
const LS_SORT_KEY = "stamporama:lot:sortKey";
const LS_SORT_DIR = "stamporama:lot:sortDir";

/** After a stamp or whole issue is picked, capture the condition (required) and certificate
 * (optional) that every created copy will share, then confirm the intake (#121). The last
 * choice is remembered and preselected for the next stamp. */
function IntakeConditionDialog({
  selection,
  collectionId,
  conditions,
  certificateStatuses,
  locations,
  isPending,
  error,
  submitLabel,
  hidePhotos,
  pieces,
  scanDpi,
  copyCount,
  prefill,
  lotChoice,
  onBack,
  onClose,
  onSubmit,
}: IntakeConditionDialogProps) {
  // Preselect the last-used values, ignoring any that no longer exist in this collection. A repeat
  // (#595) leads them with the previous tile's own answers — validated the same way, since a
  // condition deleted mid-sitting is the same missing id whichever of the two named it.
  //
  // Each field asks whether there *is* a prefill, never whether it has something in it: a previous
  // tile with no certificate is an answer, and reading an empty one as "nothing to say" would let
  // the remembered default put a certificate on a copy the collector asked to be the same as one
  // without.
  const [conditionId, setConditionId] = useState(() => {
    const last = prefill ? prefill.conditionId : readLast(LS_LAST_CONDITION, collectionId);
    return conditions.some((c) => c.id === last) ? last : "";
  });
  const [certId, setCertId] = useState(() => {
    const last = prefill ? prefill.certificateStatusId : readLast(LS_LAST_CERT, collectionId);
    return certificateStatuses.some((c) => c.id === last) ? last : "";
  });
  // The physical format of the piece being identified (#573) — a pair, a block, a strip — blank
  // meaning *single*, which is a value and not a missing answer (`StampFormat`, ADR-0020).
  //
  // It is deliberately **not** remembered, unlike the condition, certificate, location and
  // disposition around it, and that asymmetry is the point rather than an oversight to tidy up.
  // Condition repeats down a stockbook page — a card is often all mint or all used — so restoring it
  // saves hundreds of clicks. Format does not repeat: single is the default state of the world and a
  // multiple is the exception, so a sticky format would mark every later single as a block of four
  // until the collector noticed. That is this field's own reason for existing, inverted — and worse
  // than what it replaces, because a format nobody chose is invisible where a missing one at least
  // reads as *single*. The cost is one extra pick on a run of multiples; the gain is that a
  // multiple is always something that was chosen.
  //
  // That guarantee is enforced **here**, and deliberately not left to the component tree. Both
  // callers render this dialog conditionally today, so it unmounts on every return to the picker
  // and `useState("")` would start fresh on its own — but that is a fact about how the dialog is
  // mounted, not about formats, and someone keeping it mounted across a transition months from now
  // would silently make the field sticky: the very behaviour this field rejected, reintroduced by a
  // change that has nothing to do with it, and invisible to any test, since it is client state.
  // So the reset rides on `selection`, which both callers rebuild at **every** pick — including a
  // second pick of the same stamp, the block-of-four-then-singles run a key derived from the stamp
  // id would sit right through.
  //
  // A repeat (#595) is the one thing that fills it, and it is not an exception to any of that: the
  // collector pressed a button naming the format, which is a format that was chosen. The reset below
  // still holds — a different pick clears it, including the pick that follows a repeat.
  const [formatId, setFormatId] = useState(prefill?.formatId ?? "");
  const [formatSelection, setFormatSelection] = useState(selection);
  if (formatSelection !== selection) {
    setFormatSelection(selection);
    setFormatId("");
  }
  // Fetched here rather than threaded through the purchase screen, the reason the copy dialog
  // fetches it: it is one more dictionary and the screens that need it are not the ones that have it.
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const [locationId, setLocationId] = useState(() => {
    const last = prefill ? prefill.locationId : readLast(LS_LAST_LOCATION, collectionId);
    // Only restore an assignable location that still exists (grouping-only nodes and
    // deleted ones fall back to none).
    return locations.some((l) => l.id === last && l.assignable) ? last : "";
  });
  // Disposition preset for the copies this intake creates (#160): toggled instantly as chips,
  // carried into the created copies on submit. Remembered per collection like the other
  // choices, to speed up bulk intake.
  const [disposition, setDisposition] = useState(() => {
    if (prefill) return prefill.disposition;
    const active = new Set(readLast(LS_LAST_DISPOSITION, collectionId).split(",").filter(Boolean));
    return {
      inCollection: active.has("inCollection"),
      forSale: active.has("forSale"),
      forTrade: active.has("forTrade"),
    };
  });
  // The lot a tile's copy goes onto (#586), pre-filled with the last one answered for this order.
  // A single open lot is used without being drawn at all — see `lotChoice`. A remembered lot that
  // has since been closed or deleted falls back to the first one offered, which is the same call
  // the condition and location above make about an id that no longer exists.
  const lotOptions = lotChoice?.lots ?? [];
  const [lotId, setLotId] = useState(() => {
    if (!lotChoice || lotOptions.length === 0) return "";
    const last = prefill
      ? prefill.lotId
      : readLast(LS_LAST_SCAN_LOT, `${collectionId}:${lotChoice.purchaseId}`);
    return lotOptions.some((l) => l.id === last) ? last : lotOptions[0].id;
  });
  const asksForLot = lotChoice != null && lotOptions.length > 1;

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  // Photos are captured only for a single-stamp intake (#148): a whole-issue intake fans out
  // into several distinct copies, so shared photos would be meaningless. The pending change-set
  // is held in a ref (the derive-on-change loop in PhotoEditor never depends on it) and written
  // onto the FormData on submit; Save waits while any staged upload is still in flight.
  const singleStamp = selection.kind === "stamp";
  // …and never when the images are already in hand (#567): a tile hands the copy its own crops.
  const photos = singleStamp && !hidePhotos;
  const photoValueRef = useRef<PhotoEditorValue>({
    changeSet: { add: [], update: [], remove: [] },
    uploading: false,
  });
  const [photosUploading, setPhotosUploading] = useState(false);
  const handlePhotoChange = useCallback((value: PhotoEditorValue) => {
    photoValueRef.current = value;
    setPhotosUploading(value.uploading);
  }, []);

  // The catalogue value typed while the paper catalogue is still open at this stamp (#593). Held in
  // a ref for the reason the photo change-set is: the field re-reads on every change of condition,
  // certificate or format, and nothing in this form depends on what is currently in it. Single-stamp
  // intake only — a whole-checklist intake fans out across many stamps, and one figure could not be
  // the catalogue value of all of them, which is the rule photos and the format field follow.
  const catalogValueRef = useRef<IntakeCatalogValue>(EMPTY_INTAKE_CATALOG_VALUE);
  const handleCatalogValueChange = useCallback((value: IntakeCatalogValue) => {
    catalogValueRef.current = value;
  }, []);
  /** A failed price write, reported in the dialog's own footer beside the caller's errors. */
  const [priceError, setPriceError] = useState<string | undefined>();
  const [savingPrice, setSavingPrice] = useState(false);

  // How the chosen condition × certificate reads, which is what the catalogue value is recorded
  // against. Built here because this is where the dictionaries are; worded like the quick-price
  // dialog's own badge, so the two surfaces name the same key the same way.
  //
  // The **format is not in it**, because the figure does not land on the chosen format: it is always
  // the single's price, the way the quick-CV dialog on a copy row records it, with a multiple's value
  // derived from it by the format's factor. Naming a format here would promise a row this never
  // writes.
  const subjectLabel = [
    conditions.find((c) => c.id === conditionId)?.abbreviation,
    certificateStatuses.find((c) => c.id === certId)?.abbreviation,
  ]
    .filter(Boolean)
    .join(" · ");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    writeLast(LS_LAST_CONDITION, collectionId, conditionId);
    writeLast(LS_LAST_CERT, collectionId, certId);
    writeLast(LS_LAST_LOCATION, collectionId, locationId);
    writeLast(
      LS_LAST_DISPOSITION,
      collectionId,
      DISPOSITION_FLAGS.filter((d) => disposition[d.key]).map((d) => d.key).join(",")
    );
    if (lotChoice && lotId) {
      writeLast(LS_LAST_SCAN_LOT, `${collectionId}:${lotChoice.purchaseId}`, lotId);
    }
    const fd = new FormData(e.currentTarget);
    if (lotChoice && lotId) fd.set("lotId", lotId);
    fd.set("inCollection", String(disposition.inCollection));
    fd.set("forSale", String(disposition.forSale));
    fd.set("forTrade", String(disposition.forTrade));
    if (photos) {
      fd.set("photoChangeSet", JSON.stringify(photoValueRef.current.changeSet));
    }

    // The catalogue value goes **before** the intake and on its own (#593). It is a fact about the
    // *stamp* — it needs no copy to exist — so it is written here rather than folded into each of
    // the three actions this dialog's submit reaches, two of which are server actions and the third
    // of which does not create anything until a later step.
    //
    // Before, and blocking on failure, because a figure the collector read off the paper catalogue
    // must not be dropped in silence; and safely retried, because the field prefills from what is
    // now recorded, so a second attempt at a failed intake writes nothing a second time.
    if (selection.kind === "stamp") {
      const entry = catalogValueEntry(catalogValueRef.current);
      if (entry) {
        setSavingPrice(true);
        setPriceError(undefined);
        const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
        // At the **single**, whatever the format field says — which is what the action does for
        // every quick price now, the intake field included: the figure comes off a paper catalogue,
        // which quotes singles, and a multiple's value is that figure times the format's factor.
        const r = await quickSetCatalogPricesAction(selection.stampId, conditionId, certId || null, [
          entry,
        ]);
        setSavingPrice(false);
        if (r.status === "error") {
          setPriceError(r.message);
          return;
        }
      }
    }
    onSubmit(fd);
  }
  const count = selection.kind === "checklist" ? selection.requiredCount : 1;
  const summary =
    selection.kind === "checklist"
      ? `Whole set: ${selection.label} — ${count} stamp${count === 1 ? "" : "s"}`
      : selection.label;
  const actionLabel = isPending
    ? submitLabel
      ? "Working…"
      : "Adding…"
    : savingPrice
      ? "Saving the catalog value…"
      : photosUploading
      ? "Uploading photos…"
      : (submitLabel ??
        (selection.kind === "checklist"
          ? `Add ${count} cop${count === 1 ? "y" : "ies"}`
          : "Add copy"));

  // The picture beside the form rather than above it (#592): a thumbnail over a form this long
  // pushes the fields it exists to serve off the screen. The form column keeps the width it was
  // designed at, so the dialog reads identically with and without a piece — the picture is added
  // beside it, and nothing about the questions moves.
  const pieceAside =
    pieces && pieces.some((p) => p.sides.length > 0) ? (
      <IdentifiedPieceAside collectionId={collectionId} pieces={pieces} scanDpi={scanDpi} />
    ) : undefined;

  return (
    <DialogShell
      title="Set condition"
      onClose={onClose}
      // The same shape as the tile dialog one step back, which is where this picture was last seen:
      // two surfaces showing the same scan at the same size is one habit rather than two.
      maxWidth={pieceAside ? "min(96vw, 78rem)" : "36rem"}
      height={pieceAside ? "min(90vh, 54rem)" : undefined}
      aside={pieceAside}
      asideWidth="min(46vw, 38rem)"
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.625rem 0.75rem",
              borderRadius: "0.5rem",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            {summary}
            {/* What is about to exist, before anything is created (#596). It sits inside the box
                that names the pick because it is a fact about *this* answer — one stamp, one
                condition, one certificate, one format, one lot, and this many pieces of paper.
                Silent for the ordinary single tile, which needs no count to read as one copy. */}
            {copyCount != null && copyCount > 1 && (
              <div style={{ marginTop: "0.25rem", color: "var(--color-text-primary)" }}>
                <strong>{copyCount} copies</strong> will be created — one per tile, each keeping its
                own pictures.
              </div>
            )}
            {/* What the collection already holds of this stamp, and what it is still after (#562)
                — inside the box that already names the pick, so the line reads as a fact about it
                rather than as a second heading. Single-stamp intake only: a whole-checklist intake
                fans out across many stamps and has no one stamp to report on, exactly as photos
                below are single-stamp only (#148). */}
            {selection.kind === "stamp" && (
              <IntakeHoldingsLine
                collectionId={collectionId}
                stampId={selection.stampId}
                conditions={conditions}
                conditionId={conditionId}
                certificateStatusId={certId}
                formatId={formatId}
              />
            )}
          </div>

          {/* Which lot the copy belongs to (#586) — drawn only when the order has more than one
              open, and **above** the condition because it is the question about *this* order that
              the rest of the form is answered under. It is not a `name`d field: the submit writes
              it explicitly alongside remembering it, so the two cannot fall out of step. */}
          {asksForLot && (
            <div style={{ marginBottom: "0.75rem" }}>
              <LabelWithError htmlFor="intake-lot">Lot</LabelWithError>
              <select
                id="intake-lot"
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                {lotOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p
                style={{
                  margin: "0.25rem 0 0",
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                }}
              >
                One card can hold pieces from several lots, so this is asked per copy — and the last
                answer leads, since a card is usually worked through before the next is started.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="intake-condition">Condition</LabelWithError>
              <select
                id="intake-condition"
                name="conditionId"
                value={conditionId}
                onChange={(e) => setConditionId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">— Select —</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="intake-cert">Certificate</LabelWithError>
              <select
                id="intake-cert"
                name="certificateStatusId"
                value={certId}
                onChange={(e) => setCertId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">— None —</option>
                {certificateStatuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.abbreviation})
                  </option>
                ))}
              </select>
            </div>
            {/* Format (#573): the piece in the tweezers is a pair or a block as often as it is a
                single, and this is the moment that is known — afterwards it is one copy edit per
                piece, from memory, after the sorting pass. Single-stamp intake only, the rule
                photos follow and for a stronger reason: a whole-checklist intake fans out across
                many stamps and "block of four" could not be true of all of them. Absent entirely
                until the collection defines formats, as the inventory list's own format controls
                are — most collections never define any. */}
            {singleStamp && formats.length > 0 && (
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="intake-format">Format</LabelWithError>
                <select
                  id="intake-format"
                  name="formatId"
                  value={formatId}
                  onChange={(e) => setFormatId(e.target.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  {/* No "single" row exists in the dictionary — a copy with no format *is* the
                      single, exactly as no certificate means none. */}
                  <option value="">— Single —</option>
                  {formats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.abbreviation})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* The catalogue value, while the paper catalogue is still open at this stamp (#593).
              Directly under the row it is keyed on — a catalogue price belongs to a condition ×
              certificate, and putting it anywhere else would leave the collector to work out which
              of the answers above it follows. The format picked beside it is *not* one of those
              answers: the figure always lands on the single, with a multiple's value derived from it.
              One field, the primary catalogue only: the full quick-price dialog stays for the
              multi-vendor case, and a row of vendor inputs here would bury the step. Single-stamp
              intake only, the rule photos and the format field follow — one figure cannot be the
              catalogue value of a whole set's stamps. */}
          {selection.kind === "stamp" && (
            <IntakeCatalogValueField
              stampId={selection.stampId}
              conditionId={conditionId}
              certificateStatusId={certId}
              subjectLabel={subjectLabel}
              // The condition row above is two controls, or three once the collection defines
              // formats — the same count the row itself is built from, so the two cannot drift.
              columns={singleStamp && formats.length > 0 ? 3 : 2}
              disabled={isPending || savingPrice}
              onChange={handleCatalogValueChange}
            />
          )}

          {/* Storage location (#56/#121): optional at intake, shared by every created copy.
              An in-location ref (#148) sits beside it, disabled until a location is chosen. */}
          <div style={{ marginTop: "0.75rem" }}>
            <LabelWithError htmlFor="intake-locationId-button">Location (optional)</LabelWithError>
            {locations.length === 0 ? (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                No locations defined yet. Add some on the Locations screen to file copies away.
              </p>
            ) : (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <div style={{ flex: 3 }}>
                  <LocationTreeSelect
                    locations={locations}
                    locationTree={locationTree}
                    name="locationId"
                    selectedId={locationId}
                    onSelectedIdChange={setLocationId}
                    onlyAssignableSelectable
                    disabled={isPending}
                    noneOptionLabel="— None"
                    buttonClassName={LOCATION_SELECT_BUTTON_CLASS}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    id="intake-locationRef"
                    name="locationRef"
                    type="text"
                    placeholder="Ref, e.g. A234"
                    // The one field here that is never remembered between intakes, and is filled by
                    // a repeat all the same (#595): two duplicates worked through in a run go into
                    // the same place in the same box, and the collector asked for the same again.
                    // Uncontrolled, so this is the value the field opens with and nothing more.
                    defaultValue={prefill?.locationRef}
                    disabled={isPending || !locationId}
                    {...NO_AUTOFILL}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Disposition (#160): preset where the copies land once sorted. Instant-toggle chips
              — no separate save; the choice rides along on the intake submit. */}
          <div style={{ marginTop: "0.75rem" }}>
            <LabelWithError htmlFor="">Disposition (optional)</LabelWithError>
            <div style={{ marginTop: "0.25rem" }}>
              <DispositionChips
                values={disposition}
                disabled={isPending}
                onToggle={(flag, value) => setDisposition((d) => ({ ...d, [flag]: value }))}
              />
            </div>
          </div>

          {/* Photos (#148): only for a single-stamp intake — a whole-issue intake creates several
              distinct copies, so shared photos would be ambiguous. Eager staged uploads; the
              pending change-set applies to the created copy on submit. Absent entirely when the
              copy is being identified from a scan tile (#567), whose crops it already gets. */}
          {photos && (
            <div style={{ marginTop: "0.75rem" }}>
              <LabelWithError htmlFor="">Photos (optional)</LabelWithError>
              <PhotoEditor
                collectionId={collectionId}
                initialPhotos={[]}
                disabled={isPending}
                onChange={handlePhotoChange}
              />
            </div>
          )}

          <p style={{ margin: "0.75rem 0 0", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            Copies are added <strong>not yet in your collection</strong> (
            <strong>to sort</strong> once the order has arrived, otherwise <strong>ordered</strong>).
            Cost-basis stays pending until the lot is closed.
          </p>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          cancelLabel="Back"
          onCancel={onBack}
          disabled={isPending || !conditionId || photosUploading || savingPrice}
          // The caller's error and this dialog's own read the same way, and only one can be
          // standing: a failed catalogue write returns before the intake is attempted at all.
          error={priceError ?? error}
        />
      </form>
    </DialogShell>
  );
}
