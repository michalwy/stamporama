"use client";

import { FilterFooterToggle, FILTER_MENU_HEADING_STYLE, FilterSlot } from "./filter-popover";
import { MultiSelectFilter } from "./multi-select-filter";
import { Tooltip } from "./tooltip";
import { useCollectionTags } from "./use-tags";
import {
  DEFAULT_TAG_FILTER_MODE,
  tagFilterTriggerLabel,
  type TagFilterMode,
} from "@/lib/tag-filter";

/**
 * The tag filter the Issues list, the Stamps list and the Copies list share (#1182).
 *
 * One component for the three because the *control* is the whole of what they have in common: each
 * list's ids and mode live in its own URL state and reach its own server filter, but the panel, the
 * mode switch, the trigger's wording and the rule about an empty dictionary are one thing said once —
 * and the mode is precisely the thing that must not come to mean two things on two screens.
 *
 * **The mode is a switch inside the panel, not a second control on the bar.** It says nothing on its
 * own, only ever qualifies the ticks above it, and a filter bar is the surface this app has most
 * often got wrong by putting a qualifier beside the thing it qualifies (#846's location scope, #868's
 * split switches). Its own rules follow from that precedent: it is **always drawn** so it can be
 * found before it is needed, and **disabled rather than hidden** below two ticked tags — with one
 * tag *any* and *all* pick out the same rows, so there is no honest reading to offer, and a disabled
 * switch still shows its stored state rather than leaving a collector to wonder which reading is in
 * force.
 *
 * **A collection with no tags gets no control at all** — the rule the four catalogue-attribute
 * filters follow (#737): nothing is seeded, most collections will define a handful and many none, and
 * a filter over a vocabulary that does not exist narrows nothing. It renders `null`, its slot
 * included, so the bar does not keep a gap for it.
 *
 * The dictionary comes from `useCollectionTags` rather than from a prop, which is `use-tags.ts`'s own
 * call and the reason the Stamps list's four attribute filters are built the same way. It does mean
 * the control **arrives with its query** rather than with the first paint, which on the Copies bar is
 * one reflow where the neighbouring format and certificate filters (server props there) have none.
 * That is accepted rather than overlooked: #868's rule is about the bar moving **under a pick**, and
 * this settles during the same mount that is still fetching the rows. The alternative is a `tags`
 * prop threaded from three pages beside a hook that already answers, which is two sources for one
 * dictionary — and the thing that then goes stale after a rename in Settings.
 */
export function TagFilterControl({
  collectionId,
  tagIds,
  mode,
  onChange,
  width,
}: {
  collectionId: string;
  /** The ticked tags. Empty is *every tag* — the absence of the filter. */
  tagIds: string[];
  mode: TagFilterMode;
  /** Both halves in **one call**, so a screen writes one URL update rather than two: the ids and the
   *  mode are one filter and a link carrying half of it would show something nobody asked for. */
  onChange: (next: { tagIds: string[]; mode: TagFilterMode }) => void;
  /** A fixed slot width, for a bar that must not move when a filter is used (#868). Left off, the
   *  control sizes to its own label — which is what the Issues and Stamps toolbars do with every
   *  control on them. */
  width?: string;
}) {
  const { data: tags } = useCollectionTags(collectionId);
  // Nothing to offer until the dictionary has arrived, and nothing to offer at all in a collection
  // that defines no tags. The two look the same here on purpose: a control that flickers into
  // existence is worse on a filter bar than one that appears with the rest of the screen.
  if (!tags || tags.length === 0) return null;

  const ticked = new Set(tagIds);
  const selectedNames = tags.filter((t) => ticked.has(t.id)).map((t) => t.name);
  // The mode has a say only once a second tag is ticked.
  const modeApplies = ticked.size > 1;

  const control = (
    <MultiSelectFilter
      fullWidth={!!width}
      options={tags.map((t) => ({ id: t.id, label: t.name }))}
      selected={tagIds}
      onChange={(ids) => onChange({ tagIds: ids, mode })}
      allLabel="All tags"
      // The trigger names the mode, because the list cannot: two tags ticked looks identical under
      // either reading unless you already know which one is in force.
      triggerLabel={tagFilterTriggerLabel(selectedNames, mode)}
      itemNoun="tags"
      ariaLabel="Filter by tag"
      footer={
        <>
          <span style={FILTER_MENU_HEADING_STYLE}>When several are ticked</span>
          <FilterFooterToggle
            label="Must carry every ticked tag"
            hint="Off: anything carrying at least one of the ticked tags. On: only the ones carrying all of them."
            disabledHint="Applies once two or more tags are ticked."
            checked={mode === "all"}
            onChange={(next) => onChange({ tagIds, mode: next ? "all" : DEFAULT_TAG_FILTER_MODE })}
            disabled={!modeApplies}
          />
        </>
      }
    />
  );

  return (
    /* `flexShrink: 0` on the tooltip as well as on the slot: `Tooltip` renders an `inline-flex` span,
       and **that span** is the bar's flex child rather than the fixed-width box inside it, so without
       it the width holds only until the row runs out of room. */
    <Tooltip
      style={width ? { flexShrink: 0 } : undefined}
      content="Your own labels. Ticking several asks for anything carrying one of them; the switch in the panel asks for only the ones carrying all of them."
    >
      {width ? <FilterSlot width={width}>{control}</FilterSlot> : control}
    </Tooltip>
  );
}
