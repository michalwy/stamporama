"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CollectionAreaData } from "@/lib/areas";
import type { StampConditionData } from "@/lib/conditions";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { LotPoolSummary } from "@/lib/lot-builder";
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
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Segmented } from "@/app/c/[collectionSlug]/shared/segmented";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
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

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
  padding: "0.875rem 1rem",
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  fontWeight: 500,
};

const NOTE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const NUMBER_STYLE: React.CSSProperties = {
  ...FILTER_CONTROL_STYLE,
  width: "5.5rem",
};

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

/** One figure of the pool readout, drawn **against the target it was asked for** where there is one
 *  (#378's grammar): a pool of 80 under a target of 100 is the fact the criteria panel exists to
 *  surface, and 80 on its own does not say it. */
function PoolFigure({
  label,
  value,
  note,
  alarm,
  hint,
}: {
  label: string;
  value: string;
  note?: string;
  alarm?: boolean;
  hint?: string;
}) {
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: "8rem" }}>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "1.0625rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: alarm ? "var(--color-warning)" : "var(--color-text-primary)",
        }}
      >
        {value}
      </span>
      {note ? <span style={NOTE}>{note}</span> : null}
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

function poolNote(value: number, min: number | null, max: number | null): string | undefined {
  if (min === null && max === null) return undefined;
  const target = min !== null && max !== null ? `${min}–${max}` : min !== null ? `${min}+` : `≤ ${max}`;
  if (min !== null && value < min) return `short of ${target}`;
  return `against ${target}`;
}

export function LotBuilderPanel({
  collectionId,
  collectionSlug,
  areas,
  conditions,
  formats,
  platforms,
}: {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  conditions: StampConditionData[];
  formats: StampFormatData[];
  platforms: { id: string; name: string; platformCurrency: string | null }[];
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

  const request = useMemo(
    () => parseLotBuilderRequest(new URLSearchParams(searchParams.toString())),
    [searchParams]
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
  const effectiveName = name ?? suggestedName;
  const effectiveDescription = description ?? suggestedDescription;

  const roll = () =>
    write({ ...request, seed: Math.random().toString(36).slice(2, 10) });

  const pin = (itemId: string) =>
    write({
      ...request,
      pinnedItemIds: [...new Set([...request.pinnedItemIds, itemId])],
      rejectedItemIds: request.rejectedItemIds.filter((id) => id !== itemId),
    });
  const unpin = (itemId: string) =>
    write({ ...request, pinnedItemIds: request.pinnedItemIds.filter((id) => id !== itemId) });
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

  const platformChosen = !!criteria.platformId;
  const busy = proposalFetching || isPending;

  return (
    <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", minHeight: 0 }}>
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
          gap: "1rem",
        }}
      >
        <div style={{ ...CARD, display: "flex", flexWrap: "wrap", gap: "1rem 1.25rem" }}>
          {/* The platform comes first because everything else is judged against it: the pool is that
              platform's own *not offered there yet* reading, and the offer takes its templates. */}
          <Field label="Platform">
            <select
              aria-label="Platform to build the lot for"
              style={{ ...FILTER_CONTROL_STYLE, minWidth: "10rem" }}
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

        <div style={{ ...CARD, display: "flex", flexWrap: "wrap", gap: "1rem 1.25rem" }}>
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
              { value: "neutral", label: "Neutral", title: "Sets play no part in the pick" },
              {
                value: "preferSingles",
                label: "Keep back",
                title:
                  "Copies covering a set the pool could assemble are picked last, so the set survives the lot",
              },
            ]}
          />
          <Field label="Max copies per stamp">
            <NumberField
              ariaLabel="How many copies of one stamp the lot may hold"
              placeholder="no cap"
              value={criteria.maxPerStamp}
              onCommit={(maxPerStamp) => patchCriteria({ maxPerStamp })}
            />
          </Field>
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
              { value: "neutral", label: "Neutral", title: "Pile depth plays no part" },
            ]}
          />
        </div>

        <PoolReadout
          criteria={criteria}
          summary={summary}
          loading={summaryLoading}
          platformChosen={platformChosen}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {request.seed ? (
            <DialogSecondaryButton onClick={roll} disabled={!platformChosen || busy}>
              <Icon name="random" /> Re-roll
            </DialogSecondaryButton>
          ) : (
            <DialogPrimaryButton type="button" onClick={roll} disabled={!platformChosen}>
              Propose a lot
            </DialogPrimaryButton>
          )}
          {request.pinnedItemIds.length > 0 || request.rejectedItemIds.length > 0 ? (
            <>
              <span style={NOTE}>
                {request.pinnedItemIds.length} pinned · {request.rejectedItemIds.length} rejected
              </span>
              <DialogSecondaryButton
                onClick={() => write({ ...request, pinnedItemIds: [], rejectedItemIds: [] })}
                disabled={busy}
              >
                <Icon name="clear" /> Clear both
              </DialogSecondaryButton>
            </>
          ) : null}
          {proposalFetching && <span style={NOTE}>Working the pool…</span>}
        </div>

        {error && <ErrorBubble>{error}</ErrorBubble>}

        {!platformChosen && (
          <div style={{ ...CARD, ...NOTE }}>
            Choose a platform to start. Everything else is judged against it: the lot is drawn from
            the copies that are for sale and not yet offered there, and the offer it builds takes
            that platform&apos;s own templates and defaults.
          </div>
        )}

        {request.seed && proposalLoading && <div style={{ ...CARD, ...NOTE }}>Picking…</div>}

        {proposal && (
          <>
            <LotProposalView
              collectionId={collectionId}
              proposal={proposal}
              areas={areas}
              pinnedItemIds={request.pinnedItemIds}
              onPin={pin}
              onUnpin={unpin}
              onReject={reject}
              busy={busy}
            />

            {proposal.plan.itemIds.length > 0 && (
              <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {/* The texts are written here rather than left to the platform's template. Over a
                    hundred unrelated stamps the generated title is a dozen catalogue ranges, which
                    is past most platforms' limit — and an over-long text blocks the way to Ready
                    (#636). What is typed here is stored as yours and stops following the
                    composition, which the offer's `edited` chip then says. */}
                <Field label="Listing title">
                  <input
                    style={{ ...FILTER_CONTROL_STYLE, width: "100%" }}
                    value={effectiveName}
                    onChange={(e) => setName(e.currentTarget.value)}
                    placeholder="Leave blank to use this platform's template"
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    style={{ ...FILTER_CONTROL_STYLE, width: "100%", minHeight: "5rem" }}
                    value={effectiveDescription}
                    onChange={(e) => setDescription(e.currentTarget.value)}
                    placeholder="Leave blank to use this platform's template"
                  />
                </Field>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <DialogPrimaryButton type="button" onClick={commit} disabled={busy}>
                    <Icon name="newOffer" /> Create the offer
                  </DialogPrimaryButton>
                  <span style={NOTE}>
                    A draft on {platforms.find((p) => p.id === criteria.platformId)?.name ?? "this platform"},
                    one set of {proposal.plan.itemIds.length}. The lot is picked again as it is
                    created, so anything listed elsewhere since is left out and named.
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the pool holds, answered live from the criteria and **before** anything is picked.
 *
 * There is deliberately no "≈ N lots" figure. Dividing the pool by the target answers a different
 * question than it appears to — the cap and the atomic series leave remainders no later lot can pick
 * up — and division is the one thing the collector can do unaided. The cap bound they cannot, so the
 * readout shows that instead: `Σ min(copies of that stamp, cap)` is an exact ceiling, and it is what
 * catches a target of 100 against a pool that can physically yield 80.
 */
function PoolReadout({
  criteria,
  summary,
  loading,
  platformChosen,
}: {
  criteria: LotBuilderCriteria;
  summary: LotPoolSummary | undefined;
  loading: boolean;
  platformChosen: boolean;
}) {
  if (!platformChosen) return null;
  if (loading || !summary) {
    return <div style={{ ...CARD, ...NOTE }}>Reading the pool…</div>;
  }
  const capBound = criteria.maxPerStamp !== null;
  return (
    <div style={{ ...CARD, display: "flex", flexWrap: "wrap", gap: "1.25rem" }}>
      <PoolFigure
        label="Copies in the pool"
        value={String(summary.copies)}
        note={poolNote(summary.copies, criteria.countMin, criteria.countMax)}
        alarm={criteria.countMin !== null && summary.copies < criteria.countMin}
        hint="For sale, in hand, and not already offered on this platform"
      />
      <PoolFigure
        label="Different stamps"
        value={String(summary.stamps)}
        hint="Rolled up through variants — two copies of 226 and one of 226y are one stamp here"
      />
      <PoolFigure
        label="Catalogue value"
        value={`${summary.catalogValue.toFixed(2)} ${summary.baseCurrency}`}
        note={poolNote(summary.catalogValue, criteria.valueMin, criteria.valueMax)}
        alarm={criteria.valueMin !== null && summary.catalogValue < criteria.valueMin}
      />
      <PoolFigure
        label="No catalogue value"
        value={String(summary.unpricedCopies)}
        note={summary.unpricedCopies > 0 ? "pass the ceiling, add nothing to the sum" : undefined}
        alarm={summary.unpricedCopies > 0}
      />
      <PoolFigure
        label="Complete sets available"
        value={String(summary.completeChecklists)}
        hint="Checklists every slot of which a copy in this pool covers"
      />
      {capBound && (
        <PoolFigure
          label="Cap allows at most"
          value={String(summary.capBoundedCapacity)}
          note={poolNote(summary.capBoundedCapacity, criteria.countMin, criteria.countMax)}
          alarm={criteria.countMin !== null && summary.capBoundedCapacity < criteria.countMin}
          hint="The largest lot your per-stamp cap permits out of this pool — an exact ceiling, not an estimate"
        />
      )}
    </div>
  );
}
