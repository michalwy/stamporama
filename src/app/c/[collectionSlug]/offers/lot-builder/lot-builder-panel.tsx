"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CollectionAreaData } from "@/lib/areas";
import type { StampConditionData } from "@/lib/conditions";
import type { LocationData } from "@/lib/locations";
import type { StampFormatData } from "@/lib/stamp-formats";
import {
  lotBuilderSearchParams,
  parseLotBuilderRequest,
  type LotBuilderCriteria,
  type LotBuilderRequest,
} from "@/lib/lot-builder-criteria";
import type { DuplicatePolicy, SeriesPreference } from "@/lib/lot-builder-rules";
import { Icon } from "@/app/icons";
import { DialogPrimaryButton, DialogSecondaryButton, ErrorBubble } from "@/app/dialog-shell";
import { AreaFilterSidebar } from "@/app/c/[collectionSlug]/shared/area-filter-sidebar";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Segmented } from "@/app/c/[collectionSlug]/shared/segmented";
import {
  TemplateBuilder,
  type TemplateSamples,
} from "@/app/c/[collectionSlug]/shared/template-builder";
import {
  AVAILABLE_LISTING_TOKENS,
  AVAILABLE_TITLE_TOKENS,
} from "@/lib/offer-title-template";
import { BAND, Empty, NOTE, SectionHeading } from "./lot-builder-chrome";
import { LotFigures } from "./lot-figures";
import { LotPresetBar, applyLotRecipe } from "./lot-preset-bar";
import { useLotPoolSummary, useLotProposal } from "../use-offers-query";
import { LotProposalView } from "./lot-proposal-view";

// The bulk-lot builder's screen (#760), over #758's rules and #759's two reads.
//
// **Why a screen and not a dialog.** Half the value is showing *why these copies and not others* —
// which series went in whole, which one was refused and by what, how far each target is from its
// range, how many candidates carry no catalogue value at all. That is a panel of counters beside a
// list, not a hint on a bar. (The copies list could not have carried it either: its selection is a
// `Map` of loaded rows reset on every filter change, while the list itself streams pages, so an
// answer of a hundred ids has nowhere to land.)
//
// **Everything is in the URL** — criteria, seed, pinned, rejected — and nothing else is stored
// anywhere. That is the navigation-state invariant, and here it is also the whole architecture: the
// proposal is recomputed server-side from exactly those five inputs and the commit re-plans from
// them again (#717), so a refresh rebuilds this screen and the link keeps until tomorrow.
//
// **The seed doubles as "a lot has been proposed".** Stating criteria answers the pool readout and
// nothing more; pressing *Propose a lot* writes a seed, and from then on the proposal follows every
// change. A re-roll is a new seed and nothing else, which is what makes the pick worth looking at
// several times.
//
// **The screen is one card, and the area rail is inside it.** Every screen in this app that picks an
// area — the copies list, the stamps list, the bulk listing workspace — draws the rail and the work
// beside it inside a *single* rounded, clipped, elevated container joined by one divider. This one
// used to float the rail beside page-coloured boxes on a page-coloured background, so the boxes
// showed as a hairline and nothing else, and the whole screen read as a different application. The
// container is that shared shape; what is stacked inside it are **bands** divided by a rule, the way
// a list screen stacks its toolbar, its selection bar and its rows — a card inside a card would only
// say "two boxes", never "these controls belong together".

const FIELD_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  fontWeight: 500,
};

/** The row a section's controls sit in. `flex-end` puts every control on one line whatever its
 *  label did above it, which is what makes a wrapped row read as a grid rather than as a drift. */
const CONTROL_ROW: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: "0.875rem 1.25rem",
};

const NUMBER_STYLE: React.CSSProperties = {
  ...FILTER_CONTROL_STYLE,
  width: "5.5rem",
};

/** A labelled control. Sentence-case and small, deliberately not the uppercase micro-label the
 *  figures carry: one names a thing to fill in, the other names a number to read, and drawing them
 *  alike made the criteria bands look like readouts nobody could edit. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={FIELD_LABEL}>{label}</span>
      {children}
    </div>
  );
}

/**
 * A number that reaches the criteria **when it is finished being typed** — on blur, or on Enter.
 *
 * Deliberately not written through on every keystroke. Every criteria change rewrites the address
 * and re-reads the candidate pool, which is a scan of every listable copy in the area; typing `1950`
 * a digit at a time would ask that question four times, three of them about a year nobody meant. The
 * draft is local and the committed value is the prop, so a re-read that answers late still finds the
 * field saying what the collector typed.
 */
function NumberField({
  ariaLabel,
  value,
  onCommit,
  placeholder,
}: {
  ariaLabel: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  placeholder?: string;
}) {
  const text = value === null ? "" : String(value);
  const [draft, setDraft] = useState(text);
  // The committed value can change from outside the field — a link opened, a criterion cleared — and
  // the draft has to follow it. Adjusted during render rather than in an effect, which is React's
  // own shape for "this state derives from a prop that just changed".
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setDraft(text);
  }

  // Read off the element rather than off `draft`: `NumericInput` evaluates an arithmetic entry
  // (`50+50`, #580) into the field on blur and only *then* calls this, so the state from this render
  // still holds the expression — committing it would parse to nothing and clear the criterion.
  const commit = (raw: string) => {
    const parsed = numberOrNull(raw);
    // Re-render the field from the parsed value, so an unparseable entry visibly falls back to what
    // is actually in force rather than sitting there looking like a criterion.
    setDraft(parsed === null ? "" : String(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <NumericInput
      aria-label={ariaLabel}
      style={NUMBER_STYLE}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A `min`–`max` pair. Both bounds are optional and either stands alone, which is what makes a
 *  target a *range* rather than a number to hit exactly (#758). */
function RangeField({
  label,
  min,
  max,
  onChange,
  placeholderMin = "min",
  placeholderMax = "max",
}: {
  label: string;
  min: number | null;
  max: number | null;
  onChange: (patch: { min?: number | null; max?: number | null }) => void;
  placeholderMin?: string;
  placeholderMax?: string;
}) {
  return (
    <Field label={label}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
        <NumberField
          ariaLabel={`${label} minimum`}
          placeholder={placeholderMin}
          value={min}
          onCommit={(value) => onChange({ min: value })}
        />
        <span style={{ color: "var(--color-text-muted)" }}>–</span>
        <NumberField
          ariaLabel={`${label} maximum`}
          placeholder={placeholderMax}
          value={max}
          onCommit={(value) => onChange({ max: value })}
        />
      </span>
    </Field>
  );
}

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function LotBuilderPanel({
  collectionId,
  collectionSlug,
  areas,
  locations,
  conditions,
  formats,
  platforms,
  baseCurrency,
}: {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  /** Read on the server beside the areas: the proposal draws its copies with the app's own copy
   *  row, which names each copy's storage location. */
  locations: LocationData[];
  conditions: StampConditionData[];
  formats: StampFormatData[];
  platforms: { id: string; name: string; platformCurrency: string | null }[];
  baseCurrency: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  // The texts the commit sends. Held here rather than in the URL: they are a draft being typed, not
  // navigation state, and a title in the address bar would be re-pushed on every keystroke. They
  // start `null` — "still following the suggestion" — and a keystroke is what takes them off it, so
  // a re-roll that changes the piece count keeps updating the field until the collector touches it.
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  // Which of the two template editors is expanded — one at a time, the rule the shared builder is
  // written for: several stacked, and the one being worked on needs the room.
  const [openTemplate, setOpenTemplate] = useState<"name" | "description" | null>("name");

  const parsed = useMemo(
    () => parseLotBuilderRequest(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  // Whether the picked area brings its sub-areas with it (#385). The toggle lives inside the area
  // rail and its state is a **global client preference**, not URL state — so on this screen, where
  // the address is the proposal and the commit re-plans from it (#717), the flag has to be written
  // *into* the criteria on the way past. The flag is the source and the address is the record: a
  // link opened under the opposite preference re-resolves under the reader's own, which is what the
  // same toggle does on every other screen. With no area picked the scope is about nothing, so it is
  // pinned true — that is also what keeps the address's round trip exact.
  const [includeSubAreas] = useSubtreeScope("area");
  const request = useMemo<LotBuilderRequest>(
    () => ({
      ...parsed,
      criteria: {
        ...parsed.criteria,
        areaSubtree: parsed.criteria.areaId ? includeSubAreas : true,
        // The wording is a criterion — the preset keeps it and the commit renders it — but a draft
        // being *typed* is not navigation, so it is overlaid from local state rather than pushed to
        // the address on every keystroke. Null there means "whatever the address says", which is
        // what a just-applied preset put in it. The two reads drop these before keying, so a title
        // gaining a character never re-asks for the pick.
        nameTemplate: name ?? parsed.criteria.nameTemplate,
        descriptionTemplate: description ?? parsed.criteria.descriptionTemplate,
      },
    }),
    [parsed, includeSubAreas, name, description]
  );
  const { criteria } = request;

  const write = useCallback(
    (next: LotBuilderRequest) => {
      setError(undefined);
      const qs = lotBuilderSearchParams(next).toString();
      router.replace(`/c/${collectionSlug}/offers/lot-builder${qs ? `?${qs}` : ""}`, {
        scroll: false,
      });
    },
    [router, collectionSlug]
  );

  const patchCriteria = useCallback(
    (patch: Partial<LotBuilderCriteria>) =>
      write({ ...request, criteria: { ...criteria, ...patch } }),
    [write, request, criteria]
  );

  const { data: summary, isLoading: summaryLoading } = useLotPoolSummary(collectionId, request);
  const {
    data: proposal,
    isLoading: proposalLoading,
    isFetching: proposalFetching,
  } = useLotProposal(collectionId, request);

  // The suggestion follows the proposal until the collector types over it. Reading it here rather
  // than seeding state on arrival keeps one source: a re-roll that lands on 103 pieces instead of
  // 100 re-words the untouched field, and leaves a written one alone.
  const suggestedName = proposal?.suggested.name ?? "";
  const suggestedDescription = proposal?.suggested.description ?? "";
  const effectiveName = criteria.nameTemplate ?? suggestedName;
  const effectiveDescription = criteria.descriptionTemplate ?? suggestedDescription;

  const roll = () => write({ ...request, seed: Math.random().toString(36).slice(2, 10) });

  const pin = (itemId: string) =>
    write({
      ...request,
      pinnedItemIds: [...new Set([...request.pinnedItemIds, itemId])],
      rejectedItemIds: request.rejectedItemIds.filter((id) => id !== itemId),
    });
  const unpin = (itemId: string) =>
    write({
      ...request,
      pinnedItemIds: request.pinnedItemIds.filter((id) => id !== itemId),
    });
  // A rejection also lifts a pin: between two contradictory instructions the recoverable one wins,
  // which is the rule the pure pass already keeps about a copy that is both (#758).
  const reject = (itemId: string) =>
    write({
      ...request,
      pinnedItemIds: request.pinnedItemIds.filter((id) => id !== itemId),
      rejectedItemIds: [...new Set([...request.rejectedItemIds, itemId])],
    });

  function commit() {
    setError(undefined);
    startTransition(async () => {
      const { commitLotBuilderAction } = await import("@/app/actions/offers");
      const result = await commitLotBuilderAction(
        collectionId,
        lotBuilderSearchParams(request).toString(),
        effectiveName,
        effectiveDescription
      );
      if (result.status === "success") {
        router.push(`/c/${collectionSlug}/offers/${result.id}`);
      } else setError(result.message);
    });
  }

  // The shared builder's sample shape, over the lot itself. Its picker half is inert here on
  // purpose: there is nothing to search for or shuffle to, because the copies the text will be
  // rendered over are the copies in front of the collector.
  const templateSamples: TemplateSamples = useMemo(
    () => ({
      copies: proposal?.templateSamples ?? [],
      loading: proposalLoading,
      shuffle: () => {},
      search: "",
      setSearch: () => {},
      picking: false,
      setPicking: () => {},
      candidates: [],
      pick: () => {},
    }),
    [proposal?.templateSamples, proposalLoading]
  );

  const platformChosen = !!criteria.platformId;
  const busy = proposalFetching || isPending;
  const platformName = platforms.find((p) => p.id === criteria.platformId)?.name;
  const marked = request.pinnedItemIds.length + request.rejectedItemIds.length;

  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        overflow: "clip",
        flex: 1,
        minHeight: "24rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      {/* The area is the rail every list screen picks an area on, and this is the same question:
          which part of the collection the lot is drawn from. One area, resolved to its subtree
          server-side — the lot is named after it (#759). */}
      <AreaFilterSidebar
        areas={areas}
        filterAreaId={criteria.areaId}
        onNavigate={(areaId) => patchCriteria({ areaId })}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        <section style={BAND}>
          <SectionHeading title="The pool" note="Which copies this lot may be drawn from at all" />
          <div style={CONTROL_ROW}>
            {/* The platform comes first because everything else is judged against it: the pool is
                that platform's own *not offered there yet* reading, and the offer takes its
                templates. */}
            <Field label="Platform">
              <select
                aria-label="Platform to build the lot for"
                style={{
                  ...FILTER_CONTROL_STYLE,
                  minWidth: "10rem",
                  cursor: "pointer",
                }}
                value={criteria.platformId}
                onChange={(e) => patchCriteria({ platformId: e.currentTarget.value })}
              >
                <option value="">Choose a platform…</option>
                {platforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <RangeField
              label="Issued years"
              min={criteria.yearFrom}
              max={criteria.yearTo}
              onChange={(patch) =>
                patchCriteria({
                  ...(patch.min !== undefined ? { yearFrom: patch.min } : {}),
                  ...(patch.max !== undefined ? { yearTo: patch.max } : {}),
                })
              }
              placeholderMin="from"
              placeholderMax="to"
            />

            <Field label="Conditions">
              <MultiSelectFilter
                options={conditions.map((c) => ({ id: c.id, label: c.name }))}
                selected={criteria.conditionIds}
                onChange={(ids) => patchCriteria({ conditionIds: ids })}
                allLabel="All conditions"
                itemNoun="conditions"
                ariaLabel="Allowed conditions"
              />
            </Field>

            {formats.length > 0 && (
              <Field label="Formats">
                <MultiSelectFilter
                  options={[
                    { id: "single", label: "Single" },
                    ...formats.map((f) => ({ id: f.id, label: f.name })),
                  ]}
                  selected={criteria.formatIds}
                  onChange={(ids) => patchCriteria({ formatIds: ids })}
                  allLabel="All formats"
                  itemNoun="formats"
                  ariaLabel="Allowed formats"
                />
              </Field>
            )}

            {/* The one criterion that cannot be SQL: a catalogue value is computed and never stored,
                so it is applied after the valuation pass. An **unpriced copy passes it** and is
                counted — a missing value may be read neither as cheap enough nor as too dear (#378),
                and the readout below says how many there are. */}
            <Field label="Max value per copy">
              <NumberField
                ariaLabel="Per-copy catalogue-value ceiling"
                placeholder="any"
                value={criteria.maxCatalogValue}
                onCommit={(maxCatalogValue) => patchCriteria({ maxCatalogValue })}
              />
            </Field>
          </div>
        </section>

        <section style={BAND}>
          {/* Saved criteria live on this heading (#773). A preset holds the recipe and not the
              platform or the area, and this is the band the recipe is mostly stated in — putting the
              control over the whole screen would have promised it reached the two things it
              deliberately leaves alone. */}
          <SectionHeading
            title="The pick"
            note="What the lot should come to, and how the copies are chosen to get there"
            actions={
              <LotPresetBar
                collectionId={collectionId}
                request={request}
                onApply={(recipe) => {
                  // The drafts are dropped, not merged: a preset carries the wording too, and a
                  // half-typed title left overlaying it would make the applied preset say something
                  // it does not say. Applying is whole on this axis exactly as on every other.
                  setName(null);
                  setDescription(null);
                  write({ ...request, criteria: applyLotRecipe(criteria, recipe) });
                }}
                disabled={busy}
              />
            }
          />
          <div style={CONTROL_ROW}>
            <RangeField
              label="Pieces"
              min={criteria.countMin}
              max={criteria.countMax}
              onChange={(patch) =>
                patchCriteria({
                  ...(patch.min !== undefined ? { countMin: patch.min } : {}),
                  ...(patch.max !== undefined ? { countMax: patch.max } : {}),
                })
              }
            />
            <RangeField
              label="Catalogue value"
              min={criteria.valueMin}
              max={criteria.valueMax}
              onChange={(patch) =>
                patchCriteria({
                  ...(patch.min !== undefined ? { valueMin: patch.min } : {}),
                  ...(patch.max !== undefined ? { valueMax: patch.max } : {}),
                })
              }
            />
            <Field label="Max copies per stamp">
              <NumberField
                ariaLabel="How many copies of one stamp the lot may hold"
                placeholder="no cap"
                value={criteria.maxPerStamp}
                onCommit={(maxPerStamp) => patchCriteria({ maxPerStamp })}
              />
            </Field>
            <Segmented<SeriesPreference>
              label="Complete sets"
              value={criteria.series}
              onChange={(series) => patchCriteria({ series })}
              options={[
                {
                  value: "preferComplete",
                  label: "Take whole",
                  title: "Every set the pool can assemble is offered the chance to go in whole",
                },
                {
                  value: "neutral",
                  label: "Neutral",
                  title: "Sets play no part in the pick",
                },
                {
                  value: "preferSingles",
                  label: "Keep back",
                  title:
                    "Copies covering a set the pool could assemble are picked last, so the set survives the lot",
                },
              ]}
            />
            <Segmented<DuplicatePolicy>
              label="Duplicates"
              value={criteria.duplicates}
              onChange={(duplicates) => patchCriteria({ duplicates })}
              options={[
                {
                  value: "preferDuplicates",
                  label: "Deep piles first",
                  title:
                    "The stamps you hold five over go before the ones you hold once, so your only copy is the last thing to fall into a job lot",
                },
                {
                  value: "neutral",
                  label: "Neutral",
                  title: "Pile depth plays no part",
                },
              ]}
            />
          </div>
        </section>

        {/* The figures and the button that changes them, in **one** band (#760's second pass). They
            were three: a bank of pool tiles, a strip holding Re-roll, and a second bank of tiles at
            the top of the proposal — most of a screen spent asking the same five questions twice and
            keeping the answers a scroll apart. The act belongs on the heading row, which is where a
            card's own control goes everywhere else in this app, and it is the act these very figures
            are the result of.

            It **pins** while the proposal scrolls under it (`STICKY_TOOLBAR_STYLE`, #358 — the page
            itself scrolls, so `top: 0` is the app's own top edge and the z-index stays under the
            portalled row menus and dialogs). That is the whole reason the figures had to come down
            to three lines: a lot is read a hundred rows at a time, every row of it a decision to pin
            or reject, and the two things a collector reaches for while reading — what the pick came
            to, and *Re-roll* — were both off the top of the screen the moment they started. The
            background is opaque for the same reason a list's toolbar is: rows pass beneath it.

            The band is drawn even with no platform chosen, carrying the disabled button and the
            reason: an action a precondition blocks is disabled with its reason, never hidden (#273).
            Only the figures wait — there is no pool to read yet. */}
        <section
          style={{
            ...BAND,
            ...STICKY_TOOLBAR_STYLE,
            background: "var(--color-bg-subtle)",
          }}
        >
          <SectionHeading
            title={proposal ? "Pool and lot" : "What the pool holds"}
            note={
              !platformChosen
                ? "Choose a platform first — the pool is that platform's own reading"
                : proposal
                  ? "What the lot took, of what the pool holds"
                  : "Before anything is picked — read over exactly the criteria above"
            }
            actions={
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                {proposalFetching && <span style={NOTE}>Working the pool…</span>}
                {marked > 0 && (
                  <>
                    <span style={NOTE}>
                      {request.pinnedItemIds.length} pinned · {request.rejectedItemIds.length}{" "}
                      rejected
                    </span>
                    <DialogSecondaryButton
                      onClick={() =>
                        write({
                          ...request,
                          pinnedItemIds: [],
                          rejectedItemIds: [],
                        })
                      }
                      disabled={busy}
                    >
                      <Icon name="clear" /> Clear both
                    </DialogSecondaryButton>
                  </>
                )}
                {request.seed ? (
                  <DialogSecondaryButton onClick={roll} disabled={!platformChosen || busy}>
                    <Icon name="random" /> Re-roll
                  </DialogSecondaryButton>
                ) : (
                  <DialogPrimaryButton type="button" onClick={roll} disabled={!platformChosen}>
                    Propose a lot
                  </DialogPrimaryButton>
                )}
              </span>
            }
          />
          {platformChosen && (
            <LotFigures
              criteria={criteria}
              summary={summary}
              proposal={proposal}
              loading={summaryLoading}
            />
          )}
        </section>

        {/* **Name the listing before reading the lot, not after** (#773's pass). The block used to
            sit under the proposal, which put the button that finishes the job a hundred rows down
            and asked the collector to scroll back up to the figures to word a title against them.
            Here it is under the band those figures are in, so the piece count, the value and the
            wording are read in one glance, and the list below is what you check *after* deciding
            what you are selling. It appears with the lot, since there is nothing to name before. */}
        {proposal && proposal.plan.itemIds.length > 0 && (
          <section style={BAND}>
            <SectionHeading
              title="Create the offer"
              note={`A draft on ${platformName ?? "this platform"}, one set of ${proposal.plan.itemIds.length}`}
            />
            {/* **Templates, not finished text** (#774). The lot writes its own template onto the
                offer, so the wording follows the composition the way every other listing's does —
                strike a copy that sold elsewhere and `{count}` re-reads by itself. What it may not
                be is the *platform's* template: over a hundred unrelated stamps that renders a dozen
                catalogue ranges, past most platforms' limit, and an over-long text blocks the way to
                Ready (#636).

                They preview against **this lot's own copies** rather than random samples of the
                collection, which is the one thing the shared builder cannot do for a platform
                template written before there is anything to write it about — and the only way
                `{count}` can preview the figure the listing will actually carry. */}
            <TemplateBuilder
              label="Listing title"
              open={openTemplate === "name"}
              onToggle={() => setOpenTemplate(openTemplate === "name" ? null : "name")}
              value={effectiveName}
              onChange={setName}
              tokens={AVAILABLE_TITLE_TOKENS}
              samples={templateSamples}
              placeholder="Leave blank to use this platform's template"
              description="Rendered over the lot's copies, and re-rendered whenever the offer's composition changes."
              emptyPreview="This platform's own title template renders instead."
            />
            <TemplateBuilder
              label="Description"
              open={openTemplate === "description"}
              onToggle={() =>
                setOpenTemplate(openTemplate === "description" ? null : "description")
              }
              value={effectiveDescription}
              onChange={setDescription}
              tokens={AVAILABLE_LISTING_TOKENS}
              multiline
              rows={5}
              samples={templateSamples}
              placeholder="Leave blank to use this platform's template"
              description="Same engine as a platform's description template, over this lot's copies."
              emptyPreview="This platform's own description template renders instead."
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <DialogPrimaryButton type="button" onClick={commit} disabled={busy}>
                <Icon name="newOffer" /> Create the offer
              </DialogPrimaryButton>
              <span style={NOTE}>
                The lot is picked again as it is created, so anything listed elsewhere since
                is left out and named.
              </span>
            </div>
          </section>
        )}

        {/* The work itself. Each state below carries its own padding rather than the column carrying
            one for all of them: an empty note is set in from the edge further than a list of rows
            is, which is the difference between a sentence to read and a table to scan. */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {error && (
            <div style={{ padding: "1rem 1.25rem 0" }}>
              <ErrorBubble>{error}</ErrorBubble>
            </div>
          )}

          {!platformChosen && (
            <Empty>
              Choose a platform to start. Everything else is judged against it: the lot is drawn
              from the copies that are for sale and not yet offered there, and the offer it builds
              takes that platform&apos;s own templates and defaults.
            </Empty>
          )}

          {platformChosen && !request.seed && (
            <Empty>
              Set the pool and the pick above, then propose a lot. Nothing is written until you
              create the offer — a proposal is a re-roll away from a different hundred copies.
            </Empty>
          )}

          {request.seed && proposalLoading && <Empty>Picking…</Empty>}

          {proposal && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                padding: "1rem 1.25rem 1.25rem",
              }}
            >
              <LotProposalView
                collectionId={collectionId}
                proposal={proposal}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                pinnedItemIds={request.pinnedItemIds}
                onPin={pin}
                onUnpin={unpin}
                onReject={reject}
                busy={busy}
              />

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
