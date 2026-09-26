"use client";

import type { CSSProperties } from "react";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { StampSubtypeData } from "@/lib/subtypes";
import type { LocationData } from "@/lib/locations";
import { DELIVERY_STATES, DELIVERY_STATE_META } from "@/lib/delivery-state";
import type { MultiStampFilter } from "@/lib/multi-stamp";
import type { TagFilterMode } from "@/lib/tag-filter";
import { NO_LOCATION } from "@/lib/location-groups";
import { LocationTreeSelect, type LocationTreeItem } from "@/app/location-tree-select";
import { SubtreeScopeToggle } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { FilterSlot } from "@/app/c/[collectionSlug]/shared/filter-popover";
import { TagFilterControl } from "@/app/c/[collectionSlug]/shared/tag-filter-control";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { DISPOSITION_FILTERS } from "./copies-list-filters";

/**
 * The Copies list's filter controls — delivery state, disposition, condition, certificate, format,
 * subtype, the several-stamp pieces, tags, storage location and the spare switches — drawn by the
 * Copies list and by the collection structure screen (#1401).
 *
 * One component for the two because *the same filter bar* is the structure screen's rule: a
 * drill-down step there is simply another filter on this bar, and a count there links to the Copies
 * list under exactly the filters that produce it. Two bars drawn apart would come to offer different
 * choices, and a count narrowed by a choice the list cannot make is a count the list cannot show.
 *
 * What stays on the Copies list alone is what is not a narrowing of *which copies*: the platform
 * worklist (a work queue), the grouping (what a row is) and the sort. Every control writes through
 * the caller's one `updateParams` funnel, keyed by the Copies list's own URL names, so a screen that
 * keeps them in its address keeps them under the same spelling.
 */

/**
 * The four switches that share one control (#846). They were four chips and between them the width
 * of a third of the filter bar, for questions asked once in a while: *has this copy a photo yet*,
 * *does its condition have a catalog price*, and the two that reach for copies the list hides.
 *
 * They are grouped rather than merely gathered, because **two of them pull the other way**. The
 * `Show only` pair narrows — each ticked one is a further `AND` a copy must satisfy — while the
 * `Also include` pair widens the set those narrowings are applied to. One list of four labels
 * would have made that unguessable; the headings are the whole reason the control is legible with
 * two ticked. The labels keep the word *Include* so a single tick still reads correctly on the
 * trigger, where the heading is not on screen.
 */
export const SPARE_FILTERS = [
  { key: "noPhotos", label: "No photos", group: "Show only" },
  { key: "missingCatalogValue", label: "Missing catalog value", group: "Show only" },
  { key: "includeGone", label: "Include sold & traded", group: "Also include" },
  { key: "includeDisposed", label: "Include no longer held", group: "Also include" },
] as const;

/**
 * The fixed widths this bar's dropdowns are drawn in (#868).
 *
 * **A control sized to its own label is a control that moves the bar when it is used.** Every one
 * of these reads differently once something is picked — `All conditions` becomes `Mint` becomes
 * `3 conditions` — and each of those is a different width, so a tick shifts everything to its
 * right at the moment the collector is working the row. Counting several values instead of listing
 * them (#425) bounds that growth; it does not stop it.
 *
 * Each is sized for the widest thing the control normally shows — the `All …` label it wears by
 * default is usually it — and anything longer (a collection's own condition or format names are
 * the collector's text, and unbounded) is ellipsised inside the box rather than allowed to stretch
 * it. The bar is therefore a little wider at rest than it was and **exactly as wide whatever is
 * picked**, which is the trade #868 asks for: the third cost it names is a bar whose width cannot
 * be predicted from what is on it.
 *
 * The location dropdown was already spelled this way by #846; the rest followed here.
 */
export const FILTER_WIDTH = {
  deliveryStates: "10.5rem",
  dispositions: "9.5rem",
  conditions: "10rem",
  certificates: "10.5rem",
  formats: "9rem",
  /** Sized for `All subtypes` and `3 subtypes`; a single subtype's own name is the collector's
   *  dictionary text (*Perforation variety*) and ellipsises. */
  subtypes: "9.5rem",
  /** The widest of the six, and not because its default label is: its options are whole sentences
   *  (*Include no longer held*, *Include sold & traded*) that differ only at the end, so a trigger
   *  that ellipsised one would read the same as the other. */
  spareFilters: "12.5rem",
  location: "12rem",
  /** Wider than the rest: it holds `Group by location ref` and the summary of the two splits it
   *  carries inside (`COPY_GROUPING_LABEL_BUDGET`, pinned by a unit test). */
  grouping: "14rem",
  /** Sized for `Any of 2 tags` and `All of 2 tags` — the two readings the trigger names (#1182) —
   *  rather than for its `All tags` default, which is much the shorter of the three. A single tag's
   *  own name is the collector's text and ellipsises. */
  tags: "10.5rem",
  /** Sized for `Only several-stamp pieces`, the longest of its three options — a native `<select>`
   *  takes its widest option's width anyway (#868), so this pins what it would have been. */
  multiStamp: "12.5rem",
} as const;

/** What a `Tooltip` around a bar control needs to stop being the loose link: it renders an
 *  `inline-flex` span, and **that span** is the row's flex child rather than the fixed-width slot
 *  inside it, so without this the width holds only until the row runs out of room. */
export const NO_SHRINK: CSSProperties = { flexShrink: 0 };

export interface CopiesFilterControlsProps {
  collectionId: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  formats: StampFormatData[];
  subtypes: StampSubtypeData[];
  locations: LocationData[];
  locationTree: LocationTreeItem[];
  deliveryStates: string[];
  activeDispositions: ReadonlySet<string>;
  conditionIds: string[];
  certificateStatusIds: string[];
  formatIds: string[];
  subtypeIds: string[];
  multiStamp: MultiStampFilter | undefined;
  tagIds: string[];
  tagMode: TagFilterMode;
  /** A location id, {@link NO_LOCATION} for the copies filed nowhere, or `""` for every location. */
  locationId: string;
  includeSubLocations: boolean;
  setIncludeSubLocations: (next: boolean) => void;
  spareFilters: ReadonlySet<string>;
  /** The caller's one write funnel, keyed by the Copies list's URL names; `""` clears a key. */
  updateParams: (updates: Record<string, string>) => void;
}

export function CopiesFilterControls({
  collectionId,
  conditions,
  certificateStatuses,
  formats,
  subtypes,
  locations,
  locationTree,
  deliveryStates,
  activeDispositions,
  conditionIds,
  certificateStatusIds,
  formatIds,
  subtypeIds,
  multiStamp,
  tagIds,
  tagMode,
  locationId,
  includeSubLocations,
  setIncludeSubLocations,
  spareFilters,
  updateParams,
}: CopiesFilterControlsProps) {
  return (
    <>
      {/* Delivery state filter (#272): the axis the row chip shows, so "what is still in
          transit?" is one click from seeing it flagged. A multi-select (#427) because the
          states worth asking about come in groups — *Ordered*, *In transit* and *To sort*
          together are "what is still on its way". */}
      <FilterSlot width={FILTER_WIDTH.deliveryStates}>
        <MultiSelectFilter
          fullWidth
          options={DELIVERY_STATES.map((state) => ({
            id: state,
            label: DELIVERY_STATE_META[state].label,
          }))}
          selected={deliveryStates}
          onChange={(ids) => updateParams({ deliveryStates: ids.join(",") })}
          allLabel="All delivery states"
          itemNoun="delivery states"
          ariaLabel="Filter by delivery state"
        />
      </FilterSlot>

      {/* Disposition (#846), one control where there were three chips. The three flags are
          **independent booleans on a copy**, not values of one axis, so ticking two asks for
          copies carrying **both** — the same predicate the three chips had, since each was
          its own `AND`ed term (`buildItemWhere`). That is the one place this control could
          mislead, a multi-select usually reading as *any of these*, so the hint says it. */}
      <Tooltip
        style={NO_SHRINK}
        content="For sale, For trade and In collection are three marks a copy can carry at once, not three kinds of copy. Tick two and you get the copies carrying both."
      >
        <FilterSlot width={FILTER_WIDTH.dispositions}>
          <MultiSelectFilter
            fullWidth
            options={DISPOSITION_FILTERS.map((f) => ({ id: f.key, label: f.label }))}
            selected={DISPOSITION_FILTERS.map((f) => f.key).filter((key) =>
              activeDispositions.has(key)
            )}
            onChange={(ids) =>
              updateParams(
                Object.fromEntries(
                  DISPOSITION_FILTERS.map((f) => [f.key, ids.includes(f.key) ? "true" : ""])
                )
              )
            }
            allLabel="Any disposition"
            itemNoun="dispositions"
            ariaLabel="Filter by disposition"
          />
        </FilterSlot>
      </Tooltip>

      {/* Several conditions at once (#425): a copy is in exactly one condition, but the
          question asked of the list is routinely a group of them ("the mint grades"). */}
      <FilterSlot width={FILTER_WIDTH.conditions}>
        <MultiSelectFilter
          fullWidth
          options={conditions.map((c) => ({ id: c.id, label: c.name }))}
          selected={conditionIds}
          onChange={(ids) => updateParams({ conditionIds: ids.join(",") })}
          allLabel="All conditions"
          itemNoun="conditions"
          ariaLabel="Filter by condition"
        />
      </FilterSlot>

      {/* Certificate filter (#428), built like the format one: absent when the collection
          defines no statuses, and "No certificate" is a tickable value rather than the
          absence of the filter — null *is* a value on this axis (ADR-0006 §2), so the
          server ORs the two branches exactly as it does for Single. */}
      {certificateStatuses.length > 0 && (
        <FilterSlot width={FILTER_WIDTH.certificates}>
          <MultiSelectFilter
            fullWidth
            options={[
              { id: "none", label: "No certificate" },
              ...certificateStatuses.map((c) => ({ id: c.id, label: c.name })),
            ]}
            selected={certificateStatusIds}
            onChange={(ids) => updateParams({ certificateStatusIds: ids.join(",") })}
            allLabel="All certificates"
            itemNoun="certificates"
            ariaLabel="Filter by certificate status"
          />
        </FilterSlot>
      )}

      {/* Format filter (#343), a multi-select like the condition one (#427). Absent
          entirely when the collection defines no formats — most never do. "Single" is a
          tickable choice because it is a real answer (no format set), not the absence of a
          filter, and it can be ticked *alongside* a format: null is never a member of an
          `in`, so the server ORs the two branches. */}
      {formats.length > 0 && (
        <FilterSlot width={FILTER_WIDTH.formats}>
          <MultiSelectFilter
            fullWidth
            options={[
              { id: "single", label: "Single" },
              ...formats.map((f) => ({ id: f.id, label: f.name })),
            ]}
            selected={formatIds}
            onChange={(ids) => updateParams({ formatIds: ids.join(",") })}
            allLabel="All formats"
            itemNoun="formats"
            ariaLabel="Filter by format"
          />
        </FilterSlot>
      )}

      {/* Subtype filter (#1002; ADR-0049 §7), a multi-select like the format one. Not a
          forgery feature: it is the dictionary this bar was missing, and it answers *only
          the printing errors* as readily as *everything but the forgeries*. "No subtype" is
          the base stamps — a top-level stamp carries none (ADR-0010 §2) — and has to be
          tickable for that second question to keep them. */}
      {subtypes.length > 0 && (
        <FilterSlot width={FILTER_WIDTH.subtypes}>
          <MultiSelectFilter
            fullWidth
            options={[
              { id: "none", label: "No subtype" },
              ...subtypes.map((s) => ({ id: s.id, label: s.name })),
            ]}
            selected={subtypeIds}
            onChange={(ids) => updateParams({ subtypeIds: ids.join(",") })}
            allLabel="All subtypes"
            itemNoun="subtypes"
            ariaLabel="Filter by stamp subtype"
          />
        </FilterSlot>
      )}

      {/* Pieces carrying several stamps (#748; ADR-0044 §7) — covers, fragments, FDCs. They
          have no screen of their own, so this is how the list is narrowed to them or rid of
          them. **A one-of choice**, so a native `<select>` on the bar rather than two ticks
          in *More filters*, which could be ticked together into a list that matches nothing.
          Beside the format filter because a carrier's type *is* a format (ADR-0044 §5), and
          always drawn: every collection can have a cover, whether or not it has one yet. */}
      <Tooltip
        style={NO_SHRINK}
        content="A cover or piece carrying several stamps is a copy of none of them. Show both kinds of copy, only those pieces, or everything else."
      >
        <select
          value={multiStamp ?? ""}
          onChange={(e) => updateParams({ multiStamp: e.target.value })}
          /* Colour and border say the filter is on, never the weight (#868): a native select
             is measured in its widest option, and bold text would re-measure it on a pick. */
          style={{
            ...FILTER_CONTROL_STYLE,
            width: FILTER_WIDTH.multiStamp,
            ...(multiStamp
              ? {
                  color: "var(--color-accent)",
                  border: "1px solid var(--color-accent)",
                  background: "var(--color-accent-soft)",
                }
              : null),
          }}
          aria-label="Filter pieces carrying several stamps"
        >
          <option value="">Any number of stamps</option>
          <option value="only">Only several-stamp pieces</option>
          <option value="exclude">No several-stamp pieces</option>
        </select>
      </Tooltip>

      {/* The collector's own labels (#1182). The **copy's** tags — nothing is inherited
          (#1181), so this never reaches the tags on the stamp a copy is linked to, which is
          the one thing a reader will look for given that every other stamp-facing axis on
          this bar does read through `Item.stamp`. The any/all switch is inside the panel, not
          beside it, for #846's and #868's reason: a control that only ever qualifies the
          picks above it costs the bar nothing in there and cannot be found out here. */}
      <TagFilterControl
        collectionId={collectionId}
        tagIds={tagIds}
        mode={tagMode}
        width={FILTER_WIDTH.tags}
        noTagsOption
        onChange={({ tagIds: ids, mode }) =>
          updateParams({
            tagIds: ids.join(","),
            // One write through the one funnel (#693), naming both keys with `""` where they
            // are off so clearing the filter sticks instead of being read back from the
            // remembered set on the next render.
            tagMode: ids.length > 0 && mode === "all" ? "all" : "",
          })
        }
      />

      {locations.length > 0 && (
        <FilterSlot width={FILTER_WIDTH.location}>
          <LocationTreeSelect
            locations={locations}
            locationTree={locationTree}
            name="location-filter"
            selectedId={locationId}
            onSelectedIdChange={(id) => updateParams({ locationId: id })}
            noneOptionLabel="All locations"
            /* The copies filed nowhere (#1401) — a value on this axis, as *No certificate* is on
               that one, so the structure screen's *Not filed* segment opens a list that says so. */
            extraOption={{ id: NO_LOCATION, label: "Not filed" }}
            /* A filter's dropdown stays open on a pick (#846): the list behind it is what
               says what the pick did, so there is nothing to go back to, and the switch
               below has to survive the pick it qualifies. Escape and a click outside still
               close it — and the other filters on this bar already work this way, a
               `MultiSelectFilter` applying each tick and staying open. */
            closeOnSelect={false}
            /* Scope of the location filter (#385), inside the dropdown rather than beside
               it (#846): it says nothing on its own and only ever qualifies the node just
               picked, so as a sibling control it was a second thing to find and a second
               thing to read past on every visit.

               **Always drawn, even with nothing picked or a leaf picked**, which is the
               opposite of what this control's own rule says elsewhere — and deliberately.
               Hiding it until a branch node is chosen made it appear only *after* the
               interaction that used to dismiss the panel, so it could not be discovered at
               all: you had to already know it was there to go looking. Its own rule is
               about a control competing for room on the filter bar; in here it competes
               with nothing, and it is a *reading of the tree* rather than a narrowing, so
               it is legible before a pick and applies to the next one. */
            panelFooter={
              <SubtreeScopeToggle
                axis="location"
                includeDescendants={includeSubLocations}
                onChange={setIncludeSubLocations}
              />
            }
          />
        </FilterSlot>
      )}

      {/* The four switches that were four chips (#846) — between them the width of a third
          of this bar, for questions asked occasionally. They are **not one axis**, and the
          menu says so with two headings rather than by stacking four labels: the *Show
          only* pair narrows the list and every one ticked must hold, the *Also include*
          pair widens the pool those narrowings are applied to. The option labels keep
          saying "Include", so the trigger still reads unambiguously with one ticked, where
          the heading is not on screen. */}
      <Tooltip
        style={NO_SHRINK}
        content="Two kinds of switch in one control. Show only narrows the list — tick both and a copy must satisfy both. Also include widens what is being narrowed, adding copies the list hides by default."
      >
        <FilterSlot width={FILTER_WIDTH.spareFilters}>
        <MultiSelectFilter
          fullWidth
          options={SPARE_FILTERS.map((f) => ({
            id: f.key,
            label: f.label,
            group: f.group,
          }))}
          selected={SPARE_FILTERS.map((f) => f.key).filter((key) => spareFilters.has(key))}
          onChange={(ids) =>
            updateParams(
              Object.fromEntries(
                SPARE_FILTERS.map((f) => [f.key, ids.includes(f.key) ? "true" : ""])
              )
            )
          }
          allLabel="More filters"
          clearLabel="No extra filters"
          itemNoun="extra filters"
          ariaLabel="Photo, catalog-value and departed-copy filters"
        />
        </FilterSlot>
      </Tooltip>
    </>
  );
}
