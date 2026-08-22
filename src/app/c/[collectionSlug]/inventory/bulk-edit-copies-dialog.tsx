"use client";

import { useMemo, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import type { BulkCopyChanges } from "@/app/c/[collectionSlug]/shared/bulk-copy-changes";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const HINT_STYLE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/** What the location half of the dialog is doing. Three states, not two: *leave as is* is what
 * makes the two halves independent, and clearing a location is a different act from choosing none
 * of them. */
type LocationMode = "keep" | "move" | "clear";

const LOCATION_MODES: { value: LocationMode; label: string }[] = [
  { value: "keep", label: "Leave as is" },
  { value: "move", label: "Move to…" },
  { value: "clear", label: "Clear" },
];

type DispositionFlag = "inCollection" | "forSale" | "forTrade";

/**
 * The disposition change: **each flag answered on its own**, and *leave as is* is one of its
 * answers (#682).
 *
 * Not one flag per pass, and not a whole combination either. The three are independent and overlap
 * by design (a copy is in the collection *and* for sale), so writing all three would flatten every
 * copy in a mixed selection onto whatever the dialog happened to be showing — while a single
 * either-or would have split the act a re-flag actually is: a drawer moving from stock to swaps is
 * *for trade on* **and** *for sale off*, one decision, and making the collector apply it twice is
 * two passes over the same copies with the list re-fetching in between.
 */
const DISPOSITION_FLAGS: { flag: DispositionFlag; label: string }[] = [
  { flag: "inCollection", label: "In collection" },
  { flag: "forSale", label: "For sale" },
  { flag: "forTrade", label: "For trade" },
];

/** What one flag is being told to do. `keep` writes nothing at all for it. */
type FlagOp = "keep" | "on" | "off";

const FLAG_OPS: { value: FlagOp; label: string }[] = [
  { value: "keep", label: "Leave as is" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const NO_FLAG_CHANGES: Record<DispositionFlag, FlagOp> = {
  inCollection: "keep",
  forSale: "keep",
  forTrade: "keep",
};

/**
 * Change **where a batch of copies is kept, and what it is kept for** (#682), from the Copies
 * list's own selection (#373).
 *
 * One dialog rather than two bar buttons, because the bar already carries four controls and these
 * two changes are routinely the same act — a drawer of duplicates is filed away *and* flagged for
 * trade in one pass. Each half may be left alone, so the dialog is equally the *move* action and
 * the *re-flag* action; it refuses to submit only when neither half says anything.
 *
 * The **ref rides with the location**, exactly as it does when a purchase is stored (#565): it
 * names a card *inside* a location, so it is offered only while one is being chosen, and a move
 * with the box left blank clears the refs the copies carried — a slot name from the old album
 * addresses nothing in the new one.
 *
 * The write is the intake screen's own (`bulkUpdateLotItemsAction`, #121/#565): the same fields
 * over the same rows, so a copy filed from the Copies list and one filed while its purchase was
 * being sorted cannot end up written two different ways.
 */
export function BulkEditCopiesDialog({
  copies,
  locations,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  copies: ItemListItem[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (changes: BulkCopyChanges) => void;
}) {
  const [locationMode, setLocationMode] = useState<LocationMode>("keep");
  const [locationId, setLocationId] = useState("");
  const [locationRef, setLocationRef] = useState("");
  const [flagOps, setFlagOps] = useState<Record<DispositionFlag, FlagOp>>(NO_FLAG_CHANGES);
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  const count = copies.length;
  const copiesLabel = `${count} cop${count === 1 ? "y" : "ies"}`;
  // What the selection carries **today**, so the change is made against a known starting point
  // rather than blind: this list groups and filters in a dozen ways, and a selection routinely
  // spans copies the collector last looked at on different screens.
  const unfiled = copies.filter((c) => !c.locationId).length;
  const distinctLocations = new Set(copies.map((c) => c.locationId).filter(Boolean)).size;
  const changedFlags = DISPOSITION_FLAGS.filter(({ flag }) => flagOps[flag] !== "keep");

  const changesLocation = locationMode !== "keep";
  const locationAnswered = locationMode === "clear" || (locationMode === "move" && !!locationId);
  const canApply = !isPending && (locationAnswered || changedFlags.length > 0);

  return (
    <DialogShell title={`Bulk edit — ${copiesLabel}`} onClose={onClose} maxWidth="30rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canApply) return;
          const changes: BulkCopyChanges = {};
          if (locationMode === "clear") changes.locationId = null;
          if (locationMode === "move" && locationId) {
            changes.locationId = locationId;
            // Always sent alongside a location, so a blank box clears the refs the copies carried
            // rather than leaving them pointing at a slot in the location they have just left.
            changes.locationRef = locationRef.trim();
          }
          // One write per flag the collector answered, and nothing at all for the ones left alone —
          // which is what lets "for trade on, for sale off" be the single act it reads as.
          for (const { flag } of changedFlags) changes[flag] = flagOps[flag] === "on";
          onSubmit(changes);
        }}
      >
        <DialogBody>
          <p
            style={{
              margin: "0 0 1rem",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            Applies to the {copiesLabel} picked in the list. Anything left as <em>Leave as is</em>{" "}
            is not written at all, so each copy keeps everything this dialog does not name.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <LabelWithError htmlFor="bulk-edit-location-button">Storage location</LabelWithError>
              <Segmented
                options={LOCATION_MODES}
                value={locationMode}
                onChange={setLocationMode}
                disabled={isPending}
                ariaLabel="Storage location"
              />
              {locationMode === "move" &&
                (locations.length === 0 ? (
                  <p style={{ ...HINT_STYLE, marginTop: "0.625rem" }}>
                    No locations defined yet. Add some on the Locations screen first.
                  </p>
                ) : (
                  <div style={{ marginTop: "0.625rem" }}>
                    <LocationTreeSelect
                      locations={locations}
                      locationTree={locationTree}
                      name="bulk-edit-location"
                      selectedId={locationId}
                      onSelectedIdChange={setLocationId}
                      onlyAssignableSelectable
                      disabled={isPending}
                      noneOptionLabel="— Choose a location"
                    />
                    <div style={{ marginTop: "0.625rem" }}>
                      <LabelWithError htmlFor="bulk-edit-ref">Ref (optional)</LabelWithError>
                      <input
                        id="bulk-edit-ref"
                        type="text"
                        value={locationRef}
                        onChange={(e) => setLocationRef(e.target.value)}
                        disabled={isPending || !locationId}
                        placeholder="e.g. A234"
                        style={{ ...INPUT_STYLE, fontVariantNumeric: "tabular-nums" }}
                      />
                      <p style={HINT_STYLE}>
                        The card these copies sit on inside the location. Left blank, the refs they
                        carry now are cleared — a ref addresses a place inside the location they are
                        leaving.
                      </p>
                    </div>
                  </div>
                ))}
              {locationMode === "clear" && (
                <p style={HINT_STYLE}>
                  Takes {count === 1 ? "it" : "them"} out of storage entirely: location and ref both
                  cleared. Nothing else about the {count === 1 ? "copy" : "copies"} changes.
                </p>
              )}
              {!changesLocation && (
                <p style={HINT_STYLE}>
                  {distinctLocations === 0
                    ? `${count === 1 ? "It is" : "None of them are"} filed anywhere yet.`
                    : `Filed across ${distinctLocations} location${distinctLocations === 1 ? "" : "s"}${
                        unfiled > 0 ? `, and ${unfiled} not filed at all` : ""
                      }.`}
                </p>
              )}
            </div>

            <div>
              <LabelWithError>Disposition</LabelWithError>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {DISPOSITION_FLAGS.map(({ flag, label }) => {
                  const op = flagOps[flag];
                  // How much of the selection the answer would leave untouched — the number that
                  // says whether this is a re-flag or a no-op.
                  const already =
                    op === "keep" ? 0 : copies.filter((c) => c[flag] === (op === "on")).length;
                  return (
                    <div
                      key={flag}
                      style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}
                    >
                      <span
                        style={{
                          width: "7.5rem",
                          flexShrink: 0,
                          fontSize: "0.8125rem",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {label}
                      </span>
                      <Segmented
                        options={FLAG_OPS}
                        value={op}
                        onChange={(next) => setFlagOps((prev) => ({ ...prev, [flag]: next }))}
                        disabled={isPending}
                        ariaLabel={label}
                        compact
                      />
                      {op !== "keep" && (
                        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                          {already === count
                            ? `all ${already === 1 ? "of it" : "of them"} already`
                            : `${already} of ${count} already`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p style={HINT_STYLE}>
                The three are independent — a copy can be in the collection, for sale and for trade
                at once — so answer as many as the change needs and leave the rest alone. Turning
                one on while turning another off is one act, applied together.
              </p>
            </div>
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Applying…" : `Apply to ${copiesLabel}`}
          disabled={!canApply}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}

/** The joined segmented picker this app writes a small either/or with — the copy form's
 * disposition control at one value per button. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
  compact = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
  ariaLabel: string;
  /** Shorter, for the three that sit stacked in a row each (the disposition flags). */
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "0.375rem",
        overflow: "hidden",
      }}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{
              padding: compact ? "0.3rem 0.7rem" : "0.5rem 0.85rem",
              border: "none",
              borderLeft: i === 0 ? undefined : "1px solid var(--color-border-strong)",
              background: active ? "var(--color-accent-soft)" : "var(--color-bg-page)",
              color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
              fontSize: "0.8125rem",
              fontWeight: active ? 600 : 500,
              cursor: disabled ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.1s ease, color 0.1s ease",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
