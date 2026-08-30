"use client";

import { useMemo, useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { DELIVERY_STATES, DELIVERY_STATE_META } from "@/lib/delivery-state";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import {
  useInventoryItemsInfinite,
  useCollectionCertificateStatuses,
  useCollectionFormats,
  useCollectionLocations,
  type InventoryItemFilters,
} from "./use-inventory-query";
import { InventoryCopyList } from "./inventory-copy-list";

/** What the popup is scoped to: a single stamp's copies, or every copy of any stamp
 * in an issue (#110). The label is shown in the dialog title. */
export type InventoryPopupTarget =
  | { kind: "stamp"; stampId: string; label: string }
  | { kind: "issue"; issueId: string; label: string };

/** The **null** value on the two axes that have one — *Single* (ADR-0020) and *No certificate*
 * (ADR-0006 §2). A tickable value like any other, since a null is a real answer here and an absent
 * filter cannot express it; the query layer takes the same two sentinels. */
const SINGLE = "single";
const NO_CERTIFICATE = "none";

/** The disposition axis, as the Copies screen's own toolbar states it (#682): three independent
 * chips rather than one multi-select, because they are ANDed — *for sale* **and** *for trade* is
 * the copies carrying both flags, not the union. */
const DISPOSITION_FILTERS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

type DispositionKey = (typeof DISPOSITION_FILTERS)[number]["key"];

interface InventoryPopupDialogProps {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  target: InventoryPopupTarget;
  onClose: () => void;
}

/**
 * Read-focused popup listing the owned copies for a stamp or issue, opened from the
 * stamp/issue list rows and from the copy-count chip itself (#110/#721). Reuses
 * {@link InventoryCopyList} in read-only mode so the copy presentation matches the Inventory
 * screen. Closing returns to the list — no navigation.
 *
 * It **filters** (#724), on the five axes the Copies screen's own toolbar carries — condition,
 * disposition, format, delivery state, certificate. A well-held stamp runs to dozens of copies, and
 * the question asked of this popup is almost never "show me all of them" but "which of these is
 * mint", "which are still in the post", "which could I trade": without the controls the only way
 * through was the scrollbar. Same controls, same sentinels and the same server-side filters as the
 * Copies list, so an answer here and an answer there cannot differ.
 *
 * The state is the dialog's own and is **not** remembered — neither in the URL nor per collection.
 * The popup is opened at a stamp, read and closed; a narrowing carried into the next stamp's popup
 * would hide copies nobody asked to hide, and the URL rule (#325/#693) is about screens one
 * navigates to and shares, which this is not.
 */
export function InventoryPopupDialog({
  collectionId,
  areas,
  baseCurrency,
  target,
  onClose,
}: InventoryPopupDialogProps) {
  const [conditionIds, setConditionIds] = useState<string[]>([]);
  const [formatIds, setFormatIds] = useState<string[]>([]);
  const [certificateStatusIds, setCertificateStatusIds] = useState<string[]>([]);
  const [deliveryStates, setDeliveryStates] = useState<string[]>([]);
  const [dispositions, setDispositions] = useState<DispositionKey[]>([]);
  // A `MultiSelectFilter` owns its own Escape (#361) and is not a layer, so while one is open the
  // dialog must stop taking the key — otherwise one press closes the menu *and* the popup under it.
  // One boolean for all of them, the call `want-acceptance-fields` makes: the dialog only cares
  // whether something is stacked above it, and opening one menu closes the last on its own
  // outside-click listener, so two are never open at once.
  const [menuOpen, setMenuOpen] = useState(false);

  // Fetched client-side and shared with every other surface asking for them, so the row this popup
  // was opened from does not have to thread three dictionaries down to it.
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);

  const filters: InventoryItemFilters = useMemo(
    () => ({
      ...(target.kind === "stamp" ? { stampId: target.stampId } : { issueId: target.issueId }),
      conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
      formatIds: formatIds.length > 0 ? formatIds : undefined,
      certificateStatusIds:
        certificateStatusIds.length > 0 ? certificateStatusIds : undefined,
      deliveryStates: deliveryStates.length > 0 ? deliveryStates : undefined,
      inCollection: dispositions.includes("inCollection") || undefined,
      forSale: dispositions.includes("forSale") || undefined,
      forTrade: dispositions.includes("forTrade") || undefined,
    }),
    [target, conditionIds, formatIds, certificateStatusIds, deliveryStates, dispositions]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, filters);
  const { data: locations = [] } = useCollectionLocations(collectionId);

  const copies = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  const filtering =
    conditionIds.length > 0 ||
    formatIds.length > 0 ||
    certificateStatusIds.length > 0 ||
    deliveryStates.length > 0 ||
    dispositions.length > 0;

  function toggleDisposition(key: DispositionKey) {
    setDispositions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  return (
    <DialogShell
      title={`Copies · ${target.label}`}
      onClose={onClose}
      dismissable={!menuOpen}
      maxWidth="min(95vw, 90rem)"
      height="min(85vh, 46rem)"
    >
      <DialogBody>
        {/* The filters (#724). Always on screen once anything has been narrowed, so a filter that
            empties the list can be taken off again from where it was put on. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.75rem",
          }}
        >
          {DISPOSITION_FILTERS.map(({ key, label }) => (
            <FilterChip
              key={key}
              label={label}
              active={dispositions.includes(key)}
              onClick={() => toggleDisposition(key)}
            />
          ))}
          {conditions.length > 0 && (
            <MultiSelectFilter
              options={conditions.map((c) => ({ id: c.id, label: c.name }))}
              selected={conditionIds}
              onChange={setConditionIds}
              allLabel="All conditions"
              itemNoun="conditions"
              ariaLabel="Filter by condition"
              onOpenChange={setMenuOpen}
            />
          )}
          <MultiSelectFilter
            options={DELIVERY_STATES.map((state) => ({
              id: state,
              label: DELIVERY_STATE_META[state].label,
            }))}
            selected={deliveryStates}
            onChange={setDeliveryStates}
            allLabel="All delivery states"
            itemNoun="delivery states"
            ariaLabel="Filter by delivery state"
            onOpenChange={setMenuOpen}
          />
          {/* Absent where the collection defines none, exactly as the Copies toolbar's are: most
              collections never define a format, and a control whose only option is the null value
              asks a question with one answer. */}
          {formats.length > 0 && (
            <MultiSelectFilter
              options={[
                { id: SINGLE, label: "Single" },
                ...formats.map((f) => ({ id: f.id, label: f.name })),
              ]}
              selected={formatIds}
              onChange={setFormatIds}
              allLabel="All formats"
              itemNoun="formats"
              ariaLabel="Filter by format"
              onOpenChange={setMenuOpen}
            />
          )}
          {certificateStatuses.length > 0 && (
            <MultiSelectFilter
              options={[
                { id: NO_CERTIFICATE, label: "No certificate" },
                ...certificateStatuses.map((c) => ({ id: c.id, label: c.name })),
              ]}
              selected={certificateStatusIds}
              onChange={setCertificateStatusIds}
              allLabel="All certificates"
              itemNoun="certificates"
              ariaLabel="Filter by certificate status"
              onOpenChange={setMenuOpen}
            />
          )}
        </div>

        {isLoading && (
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading copies…
          </div>
        )}

        {!isLoading && copies.length === 0 && (
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {filtering
              ? "No copies match these filters."
              : `No copies recorded ${
                  target.kind === "stamp" ? "for this stamp" : "in this issue"
                } yet.`}
          </div>
        )}

        {copies.length > 0 && (
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              overflow: "clip",
              background: "var(--color-bg-elevated)",
            }}
          >
            <InventoryCopyList
              collectionId={collectionId}
              copies={copies}
              areas={areas}
              locations={locations}
              baseCurrency={baseCurrency}
              hasNextPage={!!hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={fetchNextPage}
              readOnly
            />
          </div>
        )}
      </DialogBody>
    </DialogShell>
  );
}
