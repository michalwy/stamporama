"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { ItemListItem } from "@/lib/items";
import type { ComposeTargetOffer, ComposeTargetSet } from "@/lib/offers";
import type { OfferState } from "@/lib/offer-rules";
import { OFFER_STATE_LABEL, isOfferState } from "@/lib/offer-rules";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import { formatEntityNo } from "@/lib/quick-jump";
import { InventoryItemRow } from "./inventory-item-row";
import { useAreaVendorMaps, type AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { OfferFormDialog } from "@/app/c/[collectionSlug]/offers/offer-form-dialog";
import {
  useComposeTargets,
  useInvalidateOffers,
  useStampConditionCollisions,
} from "@/app/c/[collectionSlug]/offers/use-offers-query";
import type { StampConditionCollision } from "@/lib/offers";
import {
  useLastOfferDefaults,
  offerDefaultsFromForm,
} from "@/app/c/[collectionSlug]/offers/use-last-offer-defaults";
import { useInvalidateInventory } from "./use-inventory-query";
import { useInvalidatePurchases } from "@/app/c/[collectionSlug]/purchases/use-purchases-query";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Segmented } from "@/app/c/[collectionSlug]/shared/segmented";
import { Icon } from "@/app/icons";

const MUTED = "var(--color-text-muted)";

/** The composable states, in the order the facet panel lists them. Terminal offers can't be added to. */
const FACET_STATES: readonly OfferState[] = ["preparing", "ready", "active", "paused"];

const SEARCH_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: MUTED,
};

const FACET_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "0 0.25rem 0.375rem",
  margin: "0.75rem 0 0",
};

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

/** Maps + lookups the expandable copy rows need, bundled so they pass through one prop. */
interface RowCtx {
  collectionId: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  byId: Map<string, ItemListItem>;
  primaryVendorByArea: Map<string, string | null>;
  /** Catalog-entry lookup resolved from the copy's area *and* issue, so a per-issue prefix override
   * (#377) reaches the rows and the search keys alike. */
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
}

/** The chosen destination for the copy: a brand-new set on an offer, or an existing set. */
type Target = { kind: "new"; offerId: string } | { kind: "set"; offerId: string; offerSetId: string };

function targetKey(t: Target): string {
  return t.kind === "new" ? `new:${t.offerId}` : `set:${t.offerSetId}`;
}

/** Does a set match the search? Its label, its copies' stamp/issue names, their location refs
 * (#303), and — crucially — their normalized catalog keys (vendor + area prefix + number), so
 * "Mi PL 200", "PL200", or bare "200" all hit (mirrors the offer compose + add-sold-sets
 * pickers). */
function setMatches(s: ComposeTargetSet, raw: string, q: string, ctx: RowCtx): boolean {
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.itemLabels.join(" ").toLowerCase().includes(q)) return true;
  for (const id of s.itemIds) {
    const c = ctx.byId.get(id);
    if (!c) continue;
    if ((c.stampName ?? "").toLowerCase().includes(q)) return true;
    if ((c.issueName ?? "").toLowerCase().includes(q)) return true;
    if ((c.locationRef ?? "").toLowerCase().includes(q)) return true;
    const vm = ctx.vendorMapFor(c.areaId, c.issueId);
    const keys = c.catalogNumbers.map((cn) => {
      const v = vm.get(cn.catalogVendorId);
      return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
    });
    if (catalogKeyMatches(raw, keys)) return true;
  }
  return false;
}

export interface AddToOfferDialogProps {
  collectionId: string;
  /** The copies being added (#373) — they go in as one new set, as one set each, or appended to an
   * existing set. One copy is the original single-copy flow (#188) and skips the packaging choice. */
  items: ItemListItem[];
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  /** Pre-fills the platform in the "create new offer" sub-flow (#241) — the list filter's platform,
   * falling back to the last one used. */
  initialPlatform?: { id: string; name: string; platformCurrency?: string | null };
  /** Fires with the platform id when a brand-new offer is created here, so callers can remember it
   * as the last-used platform (#241). */
  onPlatformUsed?: (platformId: string) => void;
  /** Open straight into the "create new offer" sub-flow, skipping the picker (#277): the dedicated
   * "Add to new offer" row action. Cancelling the create form then closes the whole dialog rather
   * than dropping back to the picker the collector never asked for. */
  startInCreate?: boolean;
  /** Opens with this offer already picked as the destination — a brand-new set on it (#513): the
   * selection bar's "add to the conflicting offer instead" shortcut, where the offer is the whole
   * point of opening the picker. */
  initialTargetOfferId?: string;
  /** How several copies start out packaged. One set each by default — the Copies list's own
   * multi-select is most often a stock of duplicates, and it is what the duplicate-group flow
   * (#372) needs, which reaches this dialog through `startInCreate` and so never sees the footer
   * control that would otherwise let the choice be changed. */
  initialPackaging?: "per-copy" | "one-set";
  onClose: () => void;
  onDone: () => void;
}

/**
 * Rich offer picker for listing inventory copies from the Copies list (#188, #373) — the inverse of
 * the offer-side compose picker. A wide portal with a left **state facet** panel (Preparing /
 * Active / Paused, with live counts) and a right column: a search box (catalog-aware) over the
 * collection's non-terminal offers, each a **collapsible group** over its existing sets. Pick a
 * destination — a brand-new set on an offer, or an existing set (turning it into a series) — then
 * confirm. Adding to a `preparing` offer is the common path; the states are orientational, so
 * active/paused work too.
 *
 * With **several copies** picked (#373) the footer carries the packaging choice `ComposeSetDialog`
 * offers: one set holding all (a series sold together) or one set each (a quantity of singles). It
 * is a single control rather than two submit buttons because it governs the create path below too,
 * which has a submit button of its own inside the offer form.
 *
 * A destination already listing **some** of the copies keeps them out of the add and says so; only
 * one holding **every** copy is disabled, since there is then nothing left to gain. An offer never
 * lists the same copy twice.
 *
 * The picker doubles as the quick-start create path (#189): "Create new offer" opens the offer
 * header form, then seeds the fresh offer with the copies — so listing on a brand-new offer lives
 * in the same flow as adding to an existing one, and leaves the collector on the inventory list
 * either way.
 */
export function AddToOfferDialog({
  collectionId,
  items,
  areas,
  locations,
  baseCurrency,
  initialPlatform,
  onPlatformUsed,
  startInCreate = false,
  initialTargetOfferId,
  initialPackaging = "per-copy",
  onClose,
  onDone,
}: AddToOfferDialogProps) {
  const [search, setSearch] = useState("");
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const multi = items.length > 1;
  // How several copies are packaged (#373), mirroring `ComposeSetDialog`'s two buttons.
  const [packaging, setPackaging] = useState<"per-copy" | "one-set">(initialPackaging);
  // The "create new offer" sub-flow: opens OfferFormDialog on top of the picker. Starts open when
  // launched from the "Add to new offer" action (#277), which skips the picker entirely.
  const [creating, setCreating] = useState(startInCreate);
  const [createError, setCreateError] = useState<string | undefined>();
  // Which platform the create form is currently on (#513). It is what decides whether a new offer
  // would be the platform's *second* listing of a stamp in one condition, so it is asked about
  // again whenever the collector switches house mid-form.
  const [createPlatformId, setCreatePlatformId] = useState(initialPlatform?.id ?? "");
  const { data: createCollisions = [] } = useStampConditionCollisions(
    collectionId,
    itemIds,
    creating ? createPlatformId || null : null,
    creating
  );

  // Suggested asking price for the quick-start create path (#230): the copies' catalog value in the
  // collection base currency. Blank when a copy is unpriced, when its value can't be expressed in
  // the base currency (no rate), or when the copies **disagree** — an offer carries one asking
  // price, so a suggestion only exists where the copies share one figure (which a duplicate group
  // does by construction). Then no suggestion is shown and the field starts empty.
  const catalogBase = useMemo(() => {
    const first = items[0]?.value;
    if (!first || first.unpriced || first.baseAmountDisplay == null) return "";
    return items.every((i) => i.value.baseAmountDisplay === first.baseAmountDisplay)
      ? first.baseAmountDisplay
      : "";
  }, [items]);
  const [suggestedPrice, setSuggestedPrice] = useState(catalogBase);
  // Only apply the latest conversion — quick currency switches can resolve out of order.
  const convertToken = useRef(0);

  // Re-express the catalog-value suggestion in the new offer's currency when it changes (mirrors the
  // #200 duplicate flow). The base is always `catalogBase` in `baseCurrency`, so switching currencies
  // never compounds; a missing rate leaves the current value for the collector to adjust.
  function handlePriceCurrencyChange(currency: string | null) {
    if (!currency || !catalogBase) return;
    if (currency === baseCurrency) {
      setSuggestedPrice(catalogBase);
      return;
    }
    const token = ++convertToken.current;
    void (async () => {
      const { convertPriceAction } = await import("@/app/actions/exchange-rates");
      const result = await convertPriceAction(collectionId, catalogBase, baseCurrency, currency);
      if (token === convertToken.current && result.status === "success") setSuggestedPrice(result.value);
    })();
  }
  // Persisted per collection so the picker reopens on the state facet it was left on (mirrors the
  // search box's own persistence). "" (or any non-composable value) means "All offers".
  const [storedFacet, setStoredFacet] = usePersistedSearch(`${collectionId}:add-to-offer-state`);
  // Opened on a destination that was chosen for us (#513) the remembered facet may hide the very
  // offer the picker is here to confirm — so it starts on *All offers* until the collector picks a
  // facet themselves, and the persisted choice is left untouched for the next ordinary open.
  const [facetTouched, setFacetTouched] = useState(false);
  const stateFacet: OfferState | null =
    !facetTouched && initialTargetOfferId
      ? null
      : isOfferState(storedFacet) && (FACET_STATES as readonly string[]).includes(storedFacet)
        ? storedFacet
        : null;
  // The conflict facet (#513): narrow to the offers that already list one of these stamps in this
  // condition. Not persisted — it is a question about *this* selection, not a way the collector
  // likes the picker to open, and the count it carries is meaningless without one. It starts **on**
  // when the picker was opened from the selection bar's conflict shortcut, which is a request to
  // look at exactly those offers; picking a state facet is the collector saying otherwise.
  const [conflictsOnly, setConflictsOnly] = useState(!!initialTargetOfferId);
  const setStateFacet = (s: OfferState | null) => {
    setFacetTouched(true);
    setConflictsOnly(false);
    setStoredFacet(s ?? "");
  };
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Target | null>(
    initialTargetOfferId ? { kind: "new", offerId: initialTargetOfferId } : null
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateOffers();
  const { invalidateList } = useInvalidateInventory();
  // Creating the first offer for a platform sets its currency (#196); the platform picker reads the
  // currency from the cached contact search, so it must be invalidated too (#212).
  const { invalidateContacts } = useInvalidatePurchases();
  const [, rememberOfferDefaults] = useLastOfferDefaults(collectionId);

  // In the direct "create new offer" flow (#277) the picker never shows, so don't fetch its targets.
  const { data, isLoading } = useComposeTargets(collectionId, itemIds, !startInCreate);
  const offers = useMemo(() => data?.offers ?? [], [data]);
  const copies = useMemo(() => data?.copies ?? [], [data]);

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const ctx: RowCtx = useMemo(
    () => ({
      collectionId,
      baseCurrency,
      areas,
      locations,
      byId: new Map(copies.map((c) => [c.id, c])),
      primaryVendorByArea,
      vendorMapFor,
    }),
    [collectionId, baseCurrency, areas, locations, copies, primaryVendorByArea, vendorMapFor]
  );

  const raw = search.trim();
  const q = raw.toLowerCase();

  // Text filter: an offer survives if its label / platform matches (keep all its sets) or any set
  // matches (keep just those). Each surviving offer carries its visible sets.
  const byText = useMemo(() => {
    if (!q) return offers.map((o) => ({ offer: o, sets: o.sets }));
    const out: { offer: ComposeTargetOffer; sets: ComposeTargetSet[] }[] = [];
    for (const o of offers) {
      if (o.label.toLowerCase().includes(q) || o.platformName.toLowerCase().includes(q)) {
        out.push({ offer: o, sets: o.sets });
        continue;
      }
      const matching = o.sets.filter((s) => setMatches(s, raw, q, ctx));
      if (matching.length > 0) out.push({ offer: o, sets: matching });
    }
    return out;
  }, [offers, raw, q, ctx]);

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = { preparing: 0, ready: 0, active: 0, paused: 0 };
    for (const { offer } of byText) counts[offer.state] = (counts[offer.state] ?? 0) + 1;
    return counts;
  }, [byText]);

  const conflictCount = useMemo(
    () => byText.filter(({ offer }) => offer.collidingItemIds.length > 0).length,
    [byText]
  );
  // A filter with nothing behind it is released rather than shown as an empty list: the picker may
  // open on it (the conflict shortcut) before the targets have loaded, and a selection whose
  // conflict was resolved elsewhere would otherwise leave the collector staring at nothing.
  const conflictsActive = conflictsOnly && conflictCount > 0;

  const visible = useMemo(
    () =>
      conflictsActive
        ? byText.filter(({ offer }) => offer.collidingItemIds.length > 0)
        : byText.filter(({ offer }) => !stateFacet || offer.state === stateFacet),
    [byText, stateFacet, conflictsActive]
  );

  /** The copies still addable to a destination: an offer never lists the same copy twice, so any it
   * already holds are dropped rather than failing the whole add. */
  function addableTo(offerId: string): string[] {
    const already = new Set(
      offers.find((o) => o.offerId === offerId)?.containsItemIds ?? []
    );
    return itemIds.filter((id) => !already.has(id));
  }

  function submit() {
    if (!selected) {
      setError(multi ? "Pick where these copies should go." : "Pick where this copy should go.");
      return;
    }
    const ids = addableTo(selected.offerId);
    if (ids.length === 0) {
      setError("That offer already lists every one of these copies.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const actions = await import("@/app/actions/offers");
      const result =
        selected.kind === "new"
          ? await actions.addOfferSetAction(selected.offerId, ids, {
              perCopy: multi && packaging === "per-copy",
            })
          : await actions.addItemsToOfferSetAction(selected.offerSetId, ids);
      if (result.status === "success") {
        invalidateAll(collectionId);
        invalidateList(collectionId);
        onDone();
      } else {
        setError(result.message);
      }
    });
  }

  // Create a brand-new offer from its header, seeding it with the copies as its first set(s) in one
  // atomic step (#189) — so a chosen live status (#257) is honoured (Ready / Active need the offer
  // to list something). The footer's packaging choice governs here too. Stays on the inventory list
  // — same as adding to an existing offer — rather than navigating to the new offer, so the
  // collector keeps their place in the list.
  function createOffer(formData: FormData) {
    setCreateError(undefined);
    const usedPlatformId = (formData.get("platformId") as string | null) ?? "";
    startTransition(async () => {
      const actions = await import("@/app/actions/offers");
      const created = await actions.createOfferAction(
        collectionId,
        formData,
        itemIds,
        multi && packaging === "per-copy"
      );
      if (created.status !== "success") {
        // Nothing was created (the create + seed commit together), so the picker stays open to retry.
        setCreateError(created.message);
        return;
      }
      if (usedPlatformId) onPlatformUsed?.(usedPlatformId);
      rememberOfferDefaults(offerDefaultsFromForm(formData));
      invalidateAll(collectionId);
      invalidateList(collectionId);
      invalidateContacts(collectionId);
      onDone();
    });
  }

  if (typeof document === "undefined") return null;

  const copyName = multi
    ? `${items.length} copies`
    : (items[0]?.stampName ?? "this copy");
  const selectedKey = selected ? targetKey(selected) : null;

  return createPortal(
    <>
    {/* The picker is skipped entirely in the direct "create new offer" flow (#277) — only the
        create form below shows. */}
    {!startInCreate && (
    <DialogShell
      title="Add to offer"
      onClose={onClose}
      // The quick-create offer form stacks above this picker (#189); while it is up this dialog
      // must stop dismissing itself, or one Esc would close both.
      dismissable={!creating}
      maxWidth="min(94vw, 78rem)"
      height="min(90vh, 48rem)"
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Facet panel */}
        <div
          style={{
            width: "12rem",
            flexShrink: 0,
            padding: "0.75rem",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.125rem",
          }}
        >
          <p style={{ ...FACET_LABEL, marginTop: 0 }}>State</p>
          <FacetRow
            label="All offers"
            active={!conflictsActive && stateFacet === null}
            onClick={() => setStateFacet(null)}
            count={byText.length}
          />
          {FACET_STATES.map((s) => (
            <FacetRow
              key={s}
              label={OFFER_STATE_LABEL[s]}
              active={!conflictsActive && stateFacet === s}
              onClick={() => setStateFacet(stateFacet === s && !conflictsActive ? null : s)}
              count={stateCounts[s] ?? 0}
            />
          ))}

          {/* The conflict facet (#513) — a group of its own, since it cuts across the states: it
              asks what these copies collide with, not what an offer's lifecycle is. Shown only when
              something does collide, so an ordinary add never grows a facet reading zero. */}
          {conflictCount > 0 && (
            <>
              <p style={FACET_LABEL}>Conflicts</p>
              {/* The wrapper is inline-flex, so it must be told to span the panel or this one row
                  would sit narrower than the state facets above it. */}
              <Tooltip
                style={{ width: "100%" }}
                content="Offers that already list one of these stamps in this condition, through a different copy. Colnect allows only one offer per stamp per condition."
              >
                <FacetRow
                  label="Same stamp + condition"
                  active={conflictsActive}
                  onClick={() => setConflictsOnly(!conflictsActive)}
                  count={conflictCount}
                  tone="warning"
                />
              </Tooltip>
            </>
          )}
        </div>

        {/* List column */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          <div
            style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
              Add <strong>{copyName}</strong> to an offer — as {multi ? "new sets" : "a new set"}, or
              into an existing one.
            </p>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by offer, platform, set, catalog number, or location ref…"
              style={SEARCH_STYLE}
              aria-label="Filter offers"
              autoFocus
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading ? (
              <p style={HINT_STYLE}>Loading offers…</p>
            ) : visible.length === 0 ? (
              <p style={HINT_STYLE}>
                {offers.length === 0
                  ? "No offers yet. Use “Create new offer” below to start one from this copy."
                  : "No offers match these filters."}
              </p>
            ) : (
              visible.map(({ offer, sets }, i) => (
                <OfferGroup
                  key={offer.offerId}
                  offer={offer}
                  totalCopies={items.length}
                  visibleSets={sets}
                  open={q ? true : (expanded[offer.offerId] ?? false)}
                  isLast={i === visible.length - 1}
                  selectedKey={selectedKey}
                  onSelect={setSelected}
                  onToggleExpand={() =>
                    setExpanded((prev) => ({ ...prev, [offer.offerId]: !(prev[offer.offerId] ?? false) }))
                  }
                  detailsOpen={detailsOpen}
                  onToggleDetails={(setId) =>
                    setDetailsOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(setId)) next.delete(setId);
                      else next.add(setId);
                      return next;
                    })
                  }
                  ctx={ctx}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        {/* How several copies are packaged (#373). One control rather than two submit buttons: it
            governs the create path below as well, whose own submit lives inside the offer form.
            Appending into an existing set has no packaging to choose — the copies go into that
            one set — so the control is disabled with the reason rather than disappearing. */}
        {multi && (
          <div style={{ marginRight: "auto" }}>
            <Tooltip
              content={
                selected?.kind === "set"
                  ? "Adding into an existing set always puts the copies in that one set."
                  : ""
              }
            >
              <Segmented
                label="Add as"
                value={packaging}
                onChange={setPackaging}
                disabled={isPending || selected?.kind === "set"}
                options={[
                  {
                    value: "per-copy",
                    label: `${items.length} sets`,
                    title: "One single-copy set each — a quantity of interchangeable singles.",
                  },
                  {
                    value: "one-set",
                    label: "One set",
                    title: "One set holding all of them — a series sold together.",
                  },
                ]}
              />
            </Tooltip>
          </div>
        )}
        {/* Standard bottom-right cluster, Cancel first: Cancel, then the branch-off "Create new
            offer", then the completing primary — so both positive actions sit by the primary rather
            than flying up to the top-right. */}
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <DialogSecondaryButton onClick={() => setCreating(true)} disabled={isPending}>
          <Icon name="add" size="sm" /> Create new offer
        </DialogSecondaryButton>
        <div style={{ position: "relative", display: "flex", gap: "0.5rem" }}>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogPrimaryButton type="button" onClick={submit} disabled={isPending || !selected}>
            {isPending ? "Adding…" : "Add to offer"}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </DialogShell>
    )}

    {/* Quick-start create (#189): the offer header form stacked above the picker. On success it
        seeds this copy and navigates, so there is no return-to-picker step. */}
    {creating && (
      <OfferFormDialog
        collectionId={collectionId}
        baseCurrency={baseCurrency}
        initialPlatform={initialPlatform}
        isPending={isPending}
        error={createError}
        zIndexBase={110}
        onPlatformChange={setCreatePlatformId}
        // The stamp × condition conflict, asked *before* the offer exists (#513): a new listing of
        // a stamp the platform already has an offer for in that condition is one Colnect refuses.
        // Advisory only — the collector may have a reason, and the submit is never blocked.
        notice={
          createCollisions.length > 0 ? (
            <CollisionNotice collisions={createCollisions} totalCopies={items.length} />
          ) : undefined
        }
        // Always ask for the asking price here (#257): this is a one-pass "list it now" flow, so the
        // price is set up front rather than deferred to the detail screen. When the copy has a catalog
        // value it pre-fills (#230), converted to the offer's currency and still fully editable;
        // otherwise the field starts blank for the collector to fill in.
        showPrice
        // The price is the one thing this flow still asks for — the platform comes in pre-filled and
        // the rest pre-fills from the last offer — so the cursor starts there, with any suggested
        // figure selected so typing over it needs no clearing first.
        autoFocusPrice
        priceValue={catalogBase ? suggestedPrice : undefined}
        onPriceValueChange={setSuggestedPrice}
        onCurrencyChange={handlePriceCurrencyChange}
        sourceNote={
          catalogBase
            ? multi
              ? "The asking price is pre-filled from the copies' shared catalog value — adjust it as needed, then add the listing URL once you have it."
              : "The asking price is pre-filled from this copy's catalog value — adjust it as needed, then add the listing URL once you have it."
            : "Set the asking price, and add the listing URL once you have it."
        }
        onClose={() => {
          if (isPending) return;
          setCreateError(undefined);
          // The "Add to new offer" flow (#277) has no picker to fall back to — cancelling the
          // create form dismisses the whole dialog.
          if (startInCreate) onClose();
          else setCreating(false);
        }}
        onSubmit={createOffer}
      />
    )}
    </>,
    document.body
  );
}

/**
 * The stamp × condition warning as a banner (#513): the offers on the platform being listed on
 * that already hold one of these stamps in this condition, and how many copies each accounts for.
 *
 * It names the offers rather than merely counting them — the collector's next move is to look at
 * the listing that already exists, and an offer number is what finds it. Advisory throughout:
 * nothing here disables a submit.
 */
function CollisionNotice({
  collisions,
  totalCopies,
}: {
  collisions: StampConditionCollision[];
  totalCopies: number;
}) {
  const affected = new Set(collisions.flatMap((c) => c.itemIds)).size;
  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        padding: "0.625rem 0.75rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
        color: "var(--color-warning)",
        fontSize: "0.8125rem",
      }}
    >
      <Icon name="warning" size="sm" />
      <div style={{ minWidth: 0 }}>
        <strong>
          {affected === totalCopies && totalCopies > 1
            ? "These copies are"
            : affected === 1
              ? "One of these copies is"
              : `${affected} of these copies are`}{" "}
          already offered on {collisions[0].platformName}
        </strong>{" "}
        — the same stamp in the same condition. Colnect allows one offer per stamp per condition, so
        a second listing cannot be posted.
        <ul style={{ margin: "0.375rem 0 0", paddingLeft: "1.1rem" }}>
          {collisions.map((c) => (
            <li key={c.offerId}>
              {formatEntityNo(c.offerNo)} {c.offerLabel} ({OFFER_STATE_LABEL[c.state].toLowerCase()})
              {c.itemIds.length > 1 ? ` — ${c.itemIds.length} copies` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FacetRow({
  label,
  active,
  count,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
  /** `warning` marks the conflict facet (#513) — the one facet that reports a problem rather than
   * a way of looking, so it keeps the amber the chips on the rows use. */
  tone?: "warning";
}) {
  const accent = tone === "warning" ? "var(--color-warning)" : "var(--color-accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.375rem 0.5rem",
        borderRadius: "0.375rem",
        border: "none",
        background: active ? "var(--color-bg-muted)" : "transparent",
        color: active ? accent : tone === "warning" ? "var(--color-warning)" : "var(--color-text-secondary)",
        fontWeight: active || tone === "warning" ? 600 : 400,
        fontSize: "0.8125rem",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "0.75rem", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </button>
  );
}

/** One offer as a collapsible group: its header carries a "New set" target; expanding reveals its
 * existing sets, each a selectable destination. Disabled wholesale only when it already lists
 * *every* copy being added — holding some just keeps those out of the add. */
function OfferGroup({
  offer,
  totalCopies,
  visibleSets,
  open,
  isLast,
  selectedKey,
  onSelect,
  onToggleExpand,
  detailsOpen,
  onToggleDetails,
  ctx,
}: {
  offer: ComposeTargetOffer;
  totalCopies: number;
  visibleSets: ComposeTargetSet[];
  open: boolean;
  isLast: boolean;
  selectedKey: string | null;
  onSelect: (t: Target) => void;
  onToggleExpand: () => void;
  detailsOpen: Set<string>;
  onToggleDetails: (setId: string) => void;
  ctx: RowCtx;
}) {
  const alreadyHere = offer.containsItemIds.length;
  const colliding = offer.collidingItemIds.length;
  const disabled = alreadyHere >= totalCopies;
  const hasSets = offer.sets.length > 0;
  const newKey = `new:${offer.offerId}`;

  return (
    <div style={{ borderBottom: isLast && !open ? undefined : "1px solid var(--color-border)", opacity: disabled ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1rem" }}>
        {hasSets ? (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={open ? "Collapse" : "Expand"}
            style={{
              width: "1.1rem",
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: MUTED,
              fontSize: "0.75rem",
              transform: open ? "rotate(90deg)" : undefined,
              transition: "transform 0.12s ease",
            }}
          >
            <Icon name="expand" size="sm" />
          </button>
        ) : (
          <span style={{ width: "1.1rem", flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {offer.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
            <Tooltip content="Platform">
              <span style={CHIP}>{offer.platformName}</span>
            </Tooltip>
            <OfferStateChip state={offer.state} />
            <span style={{ fontSize: "0.75rem", color: MUTED }}>
              {offer.sets.length} set{offer.sets.length === 1 ? "" : "s"}
            </span>
            {alreadyHere > 0 && (
              <span style={{ fontSize: "0.75rem", color: MUTED, fontStyle: "italic" }}>
                {disabled
                  ? "— already listed here"
                  : `— ${alreadyHere} of ${totalCopies} already listed here, and left out`}
              </span>
            )}
            {/* The stamp × condition conflict (#513) — a different copy of the same stamp in the
                same condition is already on this listing, which Colnect refuses. A warning, not a
                gate: the destination stays pickable and nothing is left out of the add. */}
            {colliding > 0 && (
              <Tooltip
                content={
                  `${colliding === 1 ? "One of these copies is" : `${colliding} of these copies are`} the same stamp in the same condition as ` +
                  "a copy already listed here. Colnect allows only one offer per stamp per condition, so adding " +
                  `${colliding === 1 ? "it" : "them"} would make a listing that cannot be posted.`
                }
              >
                <span
                  style={{
                    ...CHIP,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    color: "var(--color-warning)",
                    borderColor: "var(--color-warning-border)",
                    background: "var(--color-warning-soft)",
                  }}
                >
                  <Icon name="warning" size="xs" />{" "}
                  {colliding === 1
                    ? "same stamp + condition already here"
                    : `${colliding} same stamp + condition already here`}
                </span>
              </Tooltip>
            )}
          </div>
        </div>

        {/* New-set target for this offer */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            flexShrink: 0,
            fontSize: "0.8125rem",
            color: disabled ? MUTED : "var(--color-text-secondary)",
            cursor: disabled ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="radio"
            name="add-to-offer-target"
            checked={selectedKey === newKey}
            disabled={disabled}
            onChange={() => onSelect({ kind: "new", offerId: offer.offerId })}
          />
          <Icon name="add" size="sm" /> New set
        </label>
      </div>

      {open && hasSets && (
        <div style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-bg-page)" }}>
          {visibleSets.map((s, i) => (
            <SetPickRow
              key={s.offerSetId}
              set={s}
              offerId={offer.offerId}
              offerDisabled={disabled}
              checked={selectedKey === `set:${s.offerSetId}`}
              isLast={i === visibleSets.length - 1}
              detailsShown={detailsOpen.has(s.offerSetId)}
              onToggleDetails={() => onToggleDetails(s.offerSetId)}
              onSelect={onSelect}
              ctx={ctx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One existing set inside an offer, as a selectable destination (append the copy → a series). */
function SetPickRow({
  set,
  offerId,
  offerDisabled,
  checked,
  isLast,
  detailsShown,
  onToggleDetails,
  onSelect,
  ctx,
}: {
  set: ComposeTargetSet;
  offerId: string;
  offerDisabled: boolean;
  checked: boolean;
  isLast: boolean;
  detailsShown: boolean;
  onToggleDetails: () => void;
  onSelect: (t: Target) => void;
  ctx: RowCtx;
}) {
  // Only the *offer* disables a set: an offer never lists a copy twice, so a set already holding
  // one of the picked copies can still take the others.
  const disabled = offerDisabled;
  const detailCopies = set.itemIds.map((id) => ctx.byId.get(id)).filter((c): c is ItemListItem => !!c);
  return (
    <div style={{ borderBottom: isLast && !detailsShown ? undefined : "1px solid var(--color-border)" }}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          padding: "0.5rem 1rem 0.5rem 2.5rem",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <input
          type="radio"
          name="add-to-offer-target"
          checked={checked}
          disabled={disabled}
          onChange={() => onSelect({ kind: "set", offerId, offerSetId: set.offerSetId })}
          style={{ flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {set.label}
          </div>
          <div style={{ marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: MUTED }}>
              {set.itemIds.length} cop{set.itemIds.length === 1 ? "y" : "ies"}
            </span>
            {detailCopies.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleDetails();
                }}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-accent)", fontSize: "0.75rem", fontWeight: 600 }}
              >
                <>
                  <Icon name={detailsShown ? "collapse" : "expand"} size="xs" />{" "}
                  {detailsShown ? "Hide contents" : "Show contents"}
                </>
              </button>
            )}
            {set.containsItemIds.length > 0 && (
              <span style={{ fontSize: "0.75rem", color: MUTED, fontStyle: "italic" }}>
                {set.containsItemIds.length === 1
                  ? "— copy already here"
                  : `— ${set.containsItemIds.length} of them already here`}
              </span>
            )}
          </div>
        </div>
      </label>

      {/* Expandable contents: the exact copies in this set, as full inventory rows. */}
      {detailsShown && detailCopies.length > 0 && (
        <div style={{ background: "var(--color-bg-page)", paddingLeft: "2.5rem" }}>
          {detailCopies.map((copy, i) => {
            const primaryVendorId = copy.areaId ? (ctx.primaryVendorByArea.get(copy.areaId) ?? null) : null;
            const vendorMap = ctx.vendorMapFor(copy.areaId, copy.issueId);
            return (
              <InventoryItemRow
                key={copy.id}
                collectionId={ctx.collectionId}
                item={copy}
                areas={ctx.areas}
                locations={ctx.locations}
                baseCurrency={ctx.baseCurrency}
                primaryVendorId={primaryVendorId}
                vendorMap={vendorMap}
                isLast={i === detailCopies.length - 1}
                readOnly
                showCostBasis
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
