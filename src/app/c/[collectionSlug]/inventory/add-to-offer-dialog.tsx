"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import { InventoryItemRow } from "./inventory-item-row";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { OfferFormDialog } from "@/app/c/[collectionSlug]/offers/offer-form-dialog";
import {
  useComposeTargets,
  useInvalidateOffers,
} from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { useInvalidateInventory } from "./use-inventory-query";

const EMPTY_VENDOR_MAP: Map<string, AreaCatalogEntry> = new Map();
const MUTED = "var(--color-text-muted)";

/** The composable states, in the order the facet panel lists them. Terminal offers can't be added to. */
const FACET_STATES: readonly OfferState[] = ["preparing", "active", "paused"];

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

const CREATE_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.375rem 0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
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
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
}

/** The chosen destination for the copy: a brand-new set on an offer, or an existing set. */
type Target = { kind: "new"; offerId: string } | { kind: "set"; offerId: string; offerSetId: string };

function targetKey(t: Target): string {
  return t.kind === "new" ? `new:${t.offerId}` : `set:${t.offerSetId}`;
}

/** Does a set match the search? Its label, its copies' stamp/issue names, and — crucially — their
 * normalized catalog keys (vendor + area prefix + number), so "Mi PL 200", "PL200", or bare "200"
 * all hit (mirrors the offer compose + add-sold-sets pickers). */
function setMatches(s: ComposeTargetSet, raw: string, q: string, ctx: RowCtx): boolean {
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.itemLabels.join(" ").toLowerCase().includes(q)) return true;
  for (const id of s.itemIds) {
    const c = ctx.byId.get(id);
    if (!c) continue;
    if ((c.stampName ?? "").toLowerCase().includes(q)) return true;
    if ((c.issueName ?? "").toLowerCase().includes(q)) return true;
    const vm = c.areaId ? ctx.vendorMapByArea.get(c.areaId) : undefined;
    const keys = c.catalogNumbers.map((cn) => {
      const v = vm?.get(cn.catalogVendorId);
      return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
    });
    if (catalogKeyMatches(raw, keys)) return true;
  }
  return false;
}

export interface AddToOfferDialogProps {
  collectionId: string;
  /** The copy being added — goes in as a new single-item set, or appended to an existing set. */
  item: ItemListItem;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Rich offer picker for listing one inventory copy from the Copies list (#188) — the inverse of the
 * offer-side compose picker. A wide portal with a left **state facet** panel (Preparing / Active /
 * Paused, with live counts) and a right column: a search box (catalog-aware) over the collection's
 * non-terminal offers, each a **collapsible group** over its existing sets. Pick a destination — a
 * brand-new single-item set on an offer, or an existing set (turning it into a series) — then
 * confirm. Offers already listing this copy are shown but disabled (no double-listing). Adding to a
 * `preparing` offer is the common path; the states are orientational, so active/paused work too.
 *
 * The picker doubles as the quick-start create path (#189): "Create new offer" opens the offer
 * header form, then seeds the fresh offer with this copy as a single-item set — so listing a copy
 * on a brand-new offer lives in the same flow as adding it to an existing one, and leaves the
 * collector on the inventory list either way.
 */
export function AddToOfferDialog({
  collectionId,
  item,
  areas,
  locations,
  baseCurrency,
  onClose,
  onDone,
}: AddToOfferDialogProps) {
  const [search, setSearch] = useState("");
  // The "create new offer" sub-flow: opens OfferFormDialog on top of the picker.
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  // Persisted per collection so the picker reopens on the state facet it was left on (mirrors the
  // search box's own persistence). "" (or any non-composable value) means "All offers".
  const [storedFacet, setStoredFacet] = usePersistedSearch(`${collectionId}:add-to-offer-state`);
  const stateFacet: OfferState | null =
    isOfferState(storedFacet) && (FACET_STATES as readonly string[]).includes(storedFacet)
      ? storedFacet
      : null;
  const setStateFacet = (s: OfferState | null) => setStoredFacet(s ?? "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Target | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateOffers();
  const { invalidateList } = useInvalidateInventory();

  const { data, isLoading } = useComposeTargets(collectionId, item.id, true);
  const offers = useMemo(() => data?.offers ?? [], [data]);
  const copies = useMemo(() => data?.copies ?? [], [data]);

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const ctx: RowCtx = useMemo(
    () => ({
      collectionId,
      baseCurrency,
      areas,
      locations,
      byId: new Map(copies.map((c) => [c.id, c])),
      primaryVendorByArea,
      vendorMapByArea,
    }),
    [collectionId, baseCurrency, areas, locations, copies, primaryVendorByArea, vendorMapByArea]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

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
    const counts: Record<string, number> = { preparing: 0, active: 0, paused: 0 };
    for (const { offer } of byText) counts[offer.state] = (counts[offer.state] ?? 0) + 1;
    return counts;
  }, [byText]);

  const visible = useMemo(
    () => byText.filter(({ offer }) => !stateFacet || offer.state === stateFacet),
    [byText, stateFacet]
  );

  function submit() {
    if (!selected) {
      setError("Pick where this copy should go.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const actions = await import("@/app/actions/offers");
      const result =
        selected.kind === "new"
          ? await actions.addOfferSetAction(selected.offerId, [item.id], { perCopy: false })
          : await actions.addItemToOfferSetAction(selected.offerSetId, item.id);
      if (result.status === "success") {
        invalidateAll(collectionId);
        invalidateList(collectionId);
        onDone();
      } else {
        setError(result.message);
      }
    });
  }

  // Create a brand-new offer from its header and seed it with this copy as a single-item set (#189).
  // Stays on the inventory list — same as adding to an existing offer — rather than navigating to
  // the new offer, so the collector keeps their place in the list.
  function createOffer(formData: FormData) {
    setCreateError(undefined);
    startTransition(async () => {
      const actions = await import("@/app/actions/offers");
      const created = await actions.createOfferAction(collectionId, formData);
      if (created.status !== "success") {
        setCreateError(created.message);
        return;
      }
      const seeded = await actions.addOfferSetAction(created.id, [item.id], { perCopy: false });
      invalidateAll(collectionId);
      invalidateList(collectionId);
      if (seeded.status !== "success") {
        // The offer exists but the copy didn't land — surface it and keep the picker open. The new
        // (empty) offer now shows in the list, so the collector can retry via "New set" on it.
        setCreateError(seeded.message);
        return;
      }
      onDone();
    });
  }

  if (typeof document === "undefined") return null;

  const copyName = item.stampName ?? "this copy";
  const selectedKey = selected ? targetKey(selected) : null;

  return createPortal(
    <>
    <DialogShell
      title="Add to offer"
      onClose={onClose}
      maxWidth="min(94vw, 62rem)"
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
          <FacetRow label="All offers" active={stateFacet === null} onClick={() => setStateFacet(null)} count={byText.length} />
          {FACET_STATES.map((s) => (
            <FacetRow
              key={s}
              label={OFFER_STATE_LABEL[s]}
              active={stateFacet === s}
              onClick={() => setStateFacet(stateFacet === s ? null : s)}
              count={stateCounts[s] ?? 0}
            />
          ))}
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
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <p style={{ margin: 0, flex: 1, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                Add <strong>{copyName}</strong> to an offer — as a new set, or into an existing one.
              </p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={isPending}
                style={CREATE_BUTTON_STYLE}
              >
                ＋ Create new offer
              </button>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by offer, platform, set, or catalog number…"
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
                  ? "No offers yet. Use “Create new offer” above to start one from this copy."
                  : "No offers match these filters."}
              </p>
            ) : (
              visible.map(({ offer, sets }, i) => (
                <OfferGroup
                  key={offer.offerId}
                  offer={offer}
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
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ position: "relative", display: "flex", gap: "0.5rem" }}>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogPrimaryButton type="button" onClick={submit} disabled={isPending || !selected}>
            {isPending ? "Adding…" : "Add to offer"}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </DialogShell>

    {/* Quick-start create (#189): the offer header form stacked above the picker. On success it
        seeds this copy and navigates, so there is no return-to-picker step. */}
    {creating && (
      <OfferFormDialog
        collectionId={collectionId}
        baseCurrency={baseCurrency}
        isPending={isPending}
        error={createError}
        zIndexBase={110}
        onClose={() => {
          if (!isPending) {
            setCreating(false);
            setCreateError(undefined);
          }
        }}
        onSubmit={createOffer}
      />
    )}
    </>,
    document.body
  );
}

function FacetRow({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
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
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        fontWeight: active ? 600 : 400,
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
 * existing sets, each a selectable destination. Disabled wholesale when it already lists the copy. */
function OfferGroup({
  offer,
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
  const disabled = offer.containsItem;
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
            ▶
          </button>
        ) : (
          <span style={{ width: "1.1rem", flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {offer.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
            <span style={CHIP} title="Platform">{offer.platformName}</span>
            <OfferStateChip state={offer.state} />
            <span style={{ fontSize: "0.75rem", color: MUTED }}>
              {offer.sets.length} set{offer.sets.length === 1 ? "" : "s"}
            </span>
            {disabled && (
              <span style={{ fontSize: "0.75rem", color: MUTED, fontStyle: "italic" }}>
                — already listed here
              </span>
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
          ＋ New set
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
  const disabled = offerDisabled || set.containsItem;
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
                {detailsShown ? "▾ Hide contents" : "▸ Show contents"}
              </button>
            )}
            {set.containsItem && (
              <span style={{ fontSize: "0.75rem", color: MUTED, fontStyle: "italic" }}>— copy already here</span>
            )}
          </div>
        </div>
      </label>

      {/* Expandable contents: the exact copies in this set, as full inventory rows. */}
      {detailsShown && detailCopies.length > 0 && (
        <div style={{ background: "var(--color-bg-page)", paddingLeft: "2.5rem" }}>
          {detailCopies.map((copy, i) => {
            const primaryVendorId = copy.areaId ? (ctx.primaryVendorByArea.get(copy.areaId) ?? null) : null;
            const vendorMap = (copy.areaId ? ctx.vendorMapByArea.get(copy.areaId) : undefined) ?? EMPTY_VENDOR_MAP;
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
