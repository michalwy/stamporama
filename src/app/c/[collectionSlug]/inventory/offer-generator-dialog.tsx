"use client";

import { useMemo, useState, useTransition } from "react";
import type { GeneratorCombinationPart, GeneratorLineView, GeneratorOfferRef } from "@/lib/offer-generator";
import {
  canGenerateIntoPost,
  generatorPostRefusal,
  generatorRequestParams,
  generatorSelection,
  keptResultingSetCount,
  type GeneratorMode,
  type GeneratorPackaging,
  type GeneratorSelection,
  type MixPriority,
} from "@/lib/offer-generator-rules";
import { NO_MIXING, type SeriesMixing } from "@/lib/series-recombination-rules";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { OFFER_STATE_LABEL, type OfferState } from "@/lib/offer-rules";
import type { FacebookCreateChoice } from "@/lib/facebook-post-rules";
import { formatEntityNo } from "@/lib/quick-jump";
import { DIALOG_MAX_HEIGHT, DIALOG_MAX_WIDTH, DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { Icon } from "@/app/icons";
import { ROW_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CertificateStatusChip, ConditionChip } from "@/app/c/[collectionSlug]/shared/dictionary-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { Callout, Empty, SkeletonBlock } from "@/app/c/[collectionSlug]/offers/lot-builder/lot-builder-chrome";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { useOfferGeneratorPreview } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { SpecialisedChecklistsToggle } from "@/app/c/[collectionSlug]/shared/specialised-checklists";
import { InventoryItemRow } from "./inventory-item-row";
import { useCollectionFormats } from "./use-inventory-query";
import { SELECT_STRIP } from "./inventory-copy-list";

// Generating offers in bulk (#1287): quick offer mode's platform and status (#537), applied to every
// copy the collector can see in one pass instead of one click per offer. The dialog asks the two
// questions the pass needs — complete series or singles, one multi-quantity offer or an offer per set —
// and shows the whole plan before anything is written: every offer on one line, new or added to an
// existing one (#1368), its copies a click away, and the copies left out and why. Confirming sends the plan
// back only to be compared with a fresh one (#717).
//
// Every proposed offer is ticked to begin with and can be left out (#1887). A tick asks for no fresh
// plan — an unticked offer's copies go to no other offer, they stay where they are — so the ticks are
// this dialog's own state, the counts follow them through `generatorSelection`, and only the commit
// carries them (`skip`). An expanded offer draws its copies with the app's own copy row.
//
// A complete set may mix conditions, certificates or formats (#2102), with Series from Singles' own
// switches (#1265), and with one on, the collector says which sets come first. The switches belong to
// Complete sets: Singles is sent no mixing, so it lists what it always listed.
//
// On Facebook, a pass whose offers are not yet up can put the offers it creates into one new post
// (#2030), as its lots in the preview's order — the batch gathered from the start, with no *Post
// together…* afterwards. Like the ticks, the post's title is carried by the commit alone.

/** Which copies the pass is over: the ticked ones in view, or everything the list's filters show. */
export type OfferGeneratorInput =
  | { kind: "ticked"; itemIds: string[] }
  | { kind: "filtered"; filters: string };

export interface OfferGeneratorOutcome {
  createdOffers: number;
  changedOffers: number;
  /** The new post the created offers are the lots of (#2030), when one was asked for. */
  post: { postNo: number } | null;
}

const MODES: { value: GeneratorMode; label: string; hint: string }[] = [
  {
    value: "checklists",
    label: "Complete sets",
    hint: "Every complete checklist becomes one set — in one condition, certificate and format, unless it may mix them.",
  },
  {
    value: "singles",
    label: "Singles",
    hint: "Every copy left once the complete sets are taken out becomes a set of its own.",
  },
];

const PACKAGINGS: { value: GeneratorPackaging; label: string; hint: string }[] = [
  {
    value: "multi",
    label: "Multi-quantity",
    hint: "Identical sets share one offer — added to an existing offer where one already lists them.",
  },
  {
    value: "separate",
    label: "Separate offers",
    hint: "Every set gets a new offer of its own, even where a similar offer already exists.",
  },
];

const PRIORITIES: { value: MixPriority; label: string; hint: string }[] = [
  {
    value: "same-first",
    label: "Same value first",
    hint: "Sets in one value are formed first; only the copies left over are mixed.",
  },
  {
    value: "free",
    label: "Mix freely",
    hint: "Sets are formed in the usual order, pure or mixed.",
  },
];

const FIELDSET: React.CSSProperties = {
  border: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  minWidth: 0,
};

const LEGEND: React.CSSProperties = {
  padding: 0,
  marginBottom: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const OPTION: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const HINT: React.CSSProperties = { fontSize: "0.75rem", color: "var(--color-text-secondary)" };

const TITLE_INPUT: React.CSSProperties = {
  ...formControl,
  width: "24rem",
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

// Fixed columns, so fifty lines read as a table: tick, toggle, name, combination, catalogue, quantity,
// outcome (#1368, the tick #1887). The tick is the copy list's own strip, so it runs from the row's
// left edge and the row pads only on the right.
const LINE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2.5rem 1.25rem minmax(0, 1fr) 8rem minmax(0, 1fr) 2.5rem 16rem",
  alignItems: "center",
  columnGap: "0.75rem",
  padding: "0.375rem 0.75rem 0.375rem 0",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const CELL: React.CSSProperties = {
  display: "block",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const TOGGLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.25rem",
  height: "1.25rem",
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const SELECT: React.CSSProperties = {
  maxWidth: "100%",
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function OfferGeneratorDialog({
  collectionId,
  areas,
  locations,
  baseCurrency,
  platformId,
  platformName,
  state,
  facebook,
  input,
  onClose,
  onDone,
}: {
  collectionId: string;
  /** What an expanded offer's copy rows are drawn with (#1887). */
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  platformId: string;
  platformName: string;
  state: OfferState;
  /** On Facebook, the group every new offer is in and when an auction there closes (#1663). */
  facebook: FacebookCreateChoice;
  input: OfferGeneratorInput;
  onClose: () => void;
  onDone: (outcome: OfferGeneratorOutcome) => void;
}) {
  const [mode, setMode] = useState<GeneratorMode>("checklists");
  const [packaging, setPackaging] = useState<GeneratorPackaging>("multi");
  const [mixing, setMixing] = useState<SeriesMixing>(NO_MIXING);
  const [priority, setPriority] = useState<MixPriority>("same-first");
  // An axis the collection defines nothing on has one value, so its switch is not drawn (#1265's rule).
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);
  const mixesAny = mixing.condition || mixing.certificate || mixing.format;
  const [targets, setTargets] = useState<Record<string, string>>({});
  // The lines left out, by id — kept rather than the ticked ones, so every offer starts ticked and a
  // line the plan newly proposes after a change of mode or packaging is ticked too (#1887).
  const [skip, setSkip] = useState<ReadonlySet<string>>(() => new Set());
  // In a new post (#2030): offered on Facebook only, and only while the bar's status is not yet up.
  const offerPost = !!facebook.facebookGroupId && canGenerateIntoPost(state);
  const [inPost, setInPost] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const vendorMaps = useAreaVendorMaps(areas, collectionId);

  const request = useMemo(
    () => ({
      platformId,
      state,
      mode,
      packaging,
      mixing: mode === "checklists" ? mixing : NO_MIXING,
      priority,
      itemIds: input.kind === "ticked" ? input.itemIds : null,
      filters: input.kind === "filtered" ? input.filters : "",
      targets,
      skip: [] as string[],
      facebook,
    }),
    [platformId, state, mode, packaging, mixing, priority, input, targets, facebook]
  );
  // The preview's query never carries the ticks: a tick changes what is written, not the plan.
  const query = useMemo(() => generatorRequestParams(request).toString(), [request]);
  const { data: preview, isLoading, isError } = useOfferGeneratorPreview(collectionId, query);

  const lines = useMemo(() => preview?.lines ?? [], [preview]);
  const selection = useMemo(() => generatorSelection(lines, skip), [lines, skip]);
  const { newOffers, changedOffers } = selection;
  const intoPost = offerPost && inPost;
  const postRefusal = intoPost
    ? generatorPostRefusal({ state, facebookGroupId: facebook.facebookGroupId, newOffers, title: postTitle })
    : null;
  const canConfirm =
    !!preview && newOffers + changedOffers > 0 && !preview.creationBlock && !postRefusal && !isPending;
  // Each ticked new offer's lot in the post, in the preview's order — the order the lots are written.
  const lotNos = useMemo(() => {
    const byLine = new Map<string, number>();
    for (const line of lines) {
      if (line.target.kind === "new" && !skip.has(line.id)) byLine.set(line.id, byLine.size + 1);
    }
    return byLine;
  }, [lines, skip]);
  const allTicked = lines.length > 0 && selection.leftOffers === 0;

  function toggleLine(lineId: string) {
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  function toggleAll() {
    setSkip(allTicked ? new Set(lines.map((line) => line.id)) : new Set());
  }

  const created = `Create ${plural(newOffers, "offer", "offers")}${intoPost ? " in a new post" : ""}`;
  const actionLabel =
    changedOffers > 0 && newOffers > 0
      ? `${created}, add to ${changedOffers}`
      : changedOffers > 0
        ? `Add to ${plural(changedOffers, "offer", "offers")}`
        : created;

  function confirm() {
    if (!preview) return;
    setError(undefined);
    const shown = preview.fingerprint;
    // Only the ids of lines on screen: one left over from another mode names nothing in this plan.
    const commitQuery = generatorRequestParams({
      ...request,
      skip: lines.flatMap((line) => (skip.has(line.id) ? [line.id] : [])),
      ...(intoPost ? { postTitle } : {}),
    }).toString();
    startTransition(async () => {
      const { generateOffersAction } = await import("@/app/actions/offers");
      const result = await generateOffersAction(collectionId, commitQuery, shown);
      if (result.status === "success") {
        onDone({
          createdOffers: result.createdOffers,
          changedOffers: result.changedOffers,
          post: result.post ? { postNo: result.post.postNo } : null,
        });
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <DialogShell
      title={`Generate offers on ${platformName}`}
      onClose={() => {
        if (!isPending) onClose();
      }}
      maxWidth={DIALOG_MAX_WIDTH}
      height={DIALOG_MAX_HEIGHT}
    >
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ ...HINT, fontSize: "0.8125rem" }}>
            From{" "}
            {input.kind === "ticked"
              ? `the ${plural(input.itemIds.length, "ticked copy", "ticked copies")} in view`
              : "the copies the list's filters show"}
            , as <strong>{OFFER_STATE_LABEL[state]}</strong> offers with no asking price and no listing URL — the
            same as quick offer mode.
          </div>
          {/* Which checklists count as sets an offer may be built on (#1617). */}
          <div>
            <SpecialisedChecklistsToggle />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
            <fieldset style={FIELDSET}>
              <legend style={LEGEND}>What to list</legend>
              {MODES.map((option) => (
                <label key={option.value} style={OPTION}>
                  <input
                    type="radio"
                    name="generator-mode"
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    disabled={isPending}
                  />
                  <span>
                    {option.label} <span style={HINT}>— {option.hint}</span>
                  </span>
                </label>
              ))}
              {mode === "checklists" && (
                <MixingSwitches
                  mixing={mixing}
                  priority={priority}
                  showCertificates={certificateStatuses.length > 0}
                  showFormats={formats.length > 0}
                  disabled={isPending}
                  onMixing={setMixing}
                  onPriority={setPriority}
                />
              )}
            </fieldset>
            <fieldset style={FIELDSET}>
              <legend style={LEGEND}>How to pack identical sets</legend>
              {PACKAGINGS.map((option) => (
                <label key={option.value} style={OPTION}>
                  <input
                    type="radio"
                    name="generator-packaging"
                    checked={packaging === option.value}
                    onChange={() => setPackaging(option.value)}
                    disabled={isPending}
                  />
                  <span>
                    {option.label} <span style={HINT}>— {option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          {offerPost && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <label style={{ ...OPTION, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={inPost}
                  onChange={(e) => setInPost(e.target.checked)}
                  disabled={isPending}
                />
                <span>
                  In a new post <span style={HINT}>— the new offers become its lots, in this order.</span>
                </span>
              </label>
              {inPost && (
                <>
                  <TextInput
                    aria-label="The post's title"
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                    disabled={isPending}
                    placeholder="The post's title, e.g. Generalgouvernement 1940–44"
                    style={TITLE_INPUT}
                    {...NO_AUTOFILL}
                  />
                  {postRefusal && <span style={HINT}>{postRefusal}</span>}
                </>
              )}
            </div>
          )}

          {isLoading ? (
            <SkeletonBlock style={{ height: "12rem" }} />
          ) : isError || !preview ? (
            <Callout tone="warning">The offers could not be planned. Close the dialog and try again.</Callout>
          ) : (
            <>
              <Summary preview={preview} selection={selection} mode={mode} />
              {preview.creationBlock && <Callout tone="warning">{preview.creationBlock}</Callout>}
              {preview.lines.length === 0 ? (
                <Empty>
                  {mode === "checklists"
                    ? mixesAny
                      ? "None of these copies completes a set, even with the mixing allowed."
                      : "None of these copies completes a set in one condition, certificate and format."
                    : "Every one of these copies belongs to a complete set — generate the complete sets instead."}
                </Empty>
              ) : (
                <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.5rem", overflow: "clip" }}>
                  <SelectAllStrip
                    ticked={lines.length - selection.leftOffers}
                    total={lines.length}
                    allTicked={allTicked}
                    disabled={isPending}
                    onToggle={toggleAll}
                  />
                  {lines.map((line) => (
                    <Line
                      key={line.id}
                      collectionId={collectionId}
                      areas={areas}
                      locations={locations}
                      baseCurrency={baseCurrency}
                      vendorMaps={vendorMaps}
                      line={line}
                      ticked={!skip.has(line.id)}
                      lotNo={intoPost ? (lotNos.get(line.id) ?? null) : null}
                      resultingSetCount={keptResultingSetCount(lines, skip, line.id)}
                      disabled={isPending}
                      onToggleTick={() => toggleLine(line.id)}
                      onChooseTarget={(offerId) => setTargets((prev) => ({ ...prev, [line.id]: offerId }))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Generating…" : actionLabel}
        disabled={!canConfirm}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={confirm}
      />
    </DialogShell>
  );
}

/**
 * Whether a complete set may mix an axis (#2102): Series from Singles' switches, one per axis and
 * independent; an axis the collection defines nothing on is not drawn. While any is on, which sets
 * come first — pure ones, or whatever completes a set in the usual order.
 */
function MixingSwitches({
  mixing,
  priority,
  showCertificates,
  showFormats,
  disabled,
  onMixing,
  onPriority,
}: {
  mixing: SeriesMixing;
  priority: MixPriority;
  showCertificates: boolean;
  showFormats: boolean;
  disabled: boolean;
  onMixing: (mixing: SeriesMixing) => void;
  onPriority: (priority: MixPriority) => void;
}) {
  const axes: { axis: keyof SeriesMixing; label: string; shown: boolean }[] = [
    { axis: "condition", label: "Conditions", shown: true },
    { axis: "certificate", label: "Certificates", shown: showCertificates },
    { axis: "format", label: "Formats", shown: showFormats },
  ];
  const mixesAny = mixing.condition || mixing.certificate || mixing.format;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", paddingLeft: "1.375rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
        <span style={HINT}>A set may mix:</span>
        {axes
          .filter((entry) => entry.shown)
          .map((entry) => (
            <FilterChip
              key={entry.axis}
              label={entry.label}
              toggle
              active={mixing[entry.axis]}
              onClick={() => {
                if (!disabled) onMixing({ ...mixing, [entry.axis]: !mixing[entry.axis] });
              }}
            />
          ))}
      </div>
      {mixesAny &&
        PRIORITIES.map((option) => (
          <label key={option.value} style={OPTION}>
            <input
              type="radio"
              name="generator-mix-priority"
              checked={priority === option.value}
              onChange={() => onPriority(option.value)}
              disabled={disabled}
            />
            <span>
              {option.label} <span style={HINT}>— {option.hint}</span>
            </span>
          </label>
        ))}
    </div>
  );
}

/** What the ticked offers make; then what was left out and why, the unticked offers among it. */
function Summary({
  preview,
  selection,
  mode,
}: {
  preview: NonNullable<ReturnType<typeof useOfferGeneratorPreview>["data"]>;
  selection: GeneratorSelection;
  mode: GeneratorMode;
}) {
  const { skipped, otherModeCopies } = preview;
  const skippedCount = skipped.reduce((n, entry) => n + entry.count, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", fontSize: "0.8125rem" }}>
      <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
        {plural(selection.newOffers, "new offer", "new offers")}
        {selection.changedOffers > 0 &&
          `, ${plural(selection.changedOffers, "existing offer", "existing offers")} receiving sets`}
        {" · "}
        {plural(selection.sets, "set", "sets")} · {plural(selection.copies, "copy", "copies")}
      </div>
      {skippedCount > 0 && (
        <div style={HINT}>
          {plural(skippedCount, "copy", "copies")} of the {preview.askedCopies} left out:{" "}
          {skipped.map((entry) => `${entry.count} ${entry.label}`).join("; ")}.
        </div>
      )}
      {otherModeCopies > 0 && (
        <div style={HINT}>
          {mode === "checklists"
            ? `${plural(otherModeCopies, "copy completes", "copies complete")} no set here and ${otherModeCopies === 1 ? "is" : "are"} left for Singles.`
            : `${plural(otherModeCopies, "copy belongs", "copies belong")} to complete sets and ${otherModeCopies === 1 ? "is" : "are"} left for Complete sets.`}
        </div>
      )}
      {/* Not added to the count above (#1887, confirmed with the collector): these copies do make an
          offer in this mode, so the other one would not list them either. */}
      {selection.leftOffers > 0 && (
        <div style={HINT}>
          {plural(selection.leftCopies, "copy", "copies")} in {plural(selection.leftOffers, "unticked offer", "unticked offers")}{" "}
          {selection.leftCopies === 1 ? "stays" : "stay"} where {selection.leftCopies === 1 ? "it is" : "they are"}.
        </div>
      )}
    </div>
  );
}

/** The list's own select-all box (#1887), drawn as the offers list draws it: the whole strip toggles
 *  it, and it reads partial while some offers are unticked. */
function SelectAllStrip({
  ticked,
  total,
  allTicked,
  disabled,
  onToggle,
}: {
  ticked: number;
  total: number;
  allTicked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.375rem 0.75rem 0.375rem 0",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
        fontSize: "0.8125rem",
      }}
    >
      <Tooltip content={allTicked ? "Unselect all" : "Select all"} style={{ ...SELECT_STRIP, alignSelf: "stretch" }}>
        <CheckCell disabled={disabled} bleed={{ top: "0.375rem", bottom: "0.375rem" }} style={{ flex: 1 }}>
          <input
            type="checkbox"
            checked={allTicked}
            ref={(el) => {
              if (el) el.indeterminate = ticked > 0 && !allTicked;
            }}
            onChange={onToggle}
            disabled={disabled}
            aria-label={allTicked ? "Unselect all offers" : "Select all offers"}
            style={{ cursor: disabled ? "default" : "pointer" }}
          />
        </CheckCell>
      </Tooltip>
      <span style={{ color: "var(--color-text-secondary)" }}>
        {ticked === total ? `All ${plural(total, "offer", "offers")} ticked` : `${ticked} of ${plural(total, "offer", "offers")} ticked`}
      </span>
    </div>
  );
}

function offerOption(offer: GeneratorOfferRef): string {
  return `${formatEntityNo(offer.offerNo)} ${offer.label} (${OFFER_STATE_LABEL[offer.state]})`;
}

type VendorMaps = ReturnType<typeof useAreaVendorMaps>;

/** One proposed offer on one line (#1368): its tick (#1887), the name once, the combination short,
 * what a set is by catalogue number, the quantity and the outcome — collapsed, so fifty offers read
 * as fifty lines. Expanding it shows the copies as full copy rows, to check a set against the desk. */
function Line({
  collectionId,
  areas,
  locations,
  baseCurrency,
  vendorMaps,
  line,
  ticked,
  lotNo,
  resultingSetCount,
  disabled,
  onToggleTick,
  onChooseTarget,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  vendorMaps: VendorMaps;
  line: GeneratorLineView;
  ticked: boolean;
  /** The new offer's lot in the new post (#2030), or null when there is no post or it is no lot. */
  lotNo: number | null;
  /** What the receiving offer will hold, the unticked lines before it left out. */
  resultingSetCount: number;
  disabled: boolean;
  onToggleTick: () => void;
  onChooseTarget: (offerId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const targetId = line.target.kind === "existing" ? line.target.offerId : null;
  const target = line.matches.find((offer) => offer.offerId === targetId) ?? null;
  // A line with no name (#2046) is spoken of by its catalogue numbers.
  const subject = line.title || line.catalog;
  const catalog = line.variantLabels.length > 0 ? `${line.catalog}, with ${line.variantLabels.join(", ")}` : line.catalog;
  return (
    <div style={{ borderTop: "1px solid var(--color-border)" }}>
      <div style={LINE} onClick={() => setOpen((o) => !o)}>
        {/* The whole strip, to the row's top and bottom, ticks it (#1589); the cell stops the click,
            so ticking never also expands the line. */}
        <CheckCell disabled={disabled} bleed={{ top: "0.375rem", bottom: "0.375rem" }} style={SELECT_STRIP}>
          <input
            type="checkbox"
            checked={ticked}
            onChange={onToggleTick}
            disabled={disabled}
            aria-label={`Create the offer of ${subject}`}
            style={{ cursor: disabled ? "default" : "pointer" }}
          />
        </CheckCell>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the copies of ${subject}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          style={TOGGLE}
        >
          <Icon name={open ? "collapse" : "expand"} size="sm" />
        </button>
        <Tooltip content={line.title} style={CELL}>
          <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{line.title}</span>
        </Tooltip>
        <span style={{ display: "inline-flex", gap: "0.2rem", minWidth: 0, overflow: "hidden" }}>
          {line.kind === "carrier" && <span style={ROW_CHIP}>Several stamps</span>}
          {line.combination.map((part) => (
            <CombinationChip key={part.axis} collectionId={collectionId} part={part} />
          ))}
        </span>
        <Tooltip content={catalog} style={{ ...CELL, fontVariantNumeric: "tabular-nums" }}>
          {line.catalog}
          {line.variantLabels.length > 0 && <span style={HINT}>, with {line.variantLabels.join(", ")}</span>}
        </Tooltip>
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}>
          {line.sets.length > 1 ? `×${line.sets.length}` : ""}
        </span>
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", minWidth: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {target ? (
            line.matches.length > 1 ? (
              <>
                <span style={{ flexShrink: 0 }}>Add to</span>
                <select
                  value={target.offerId}
                  onChange={(e) => onChooseTarget(e.target.value)}
                  disabled={disabled}
                  aria-label={`Offer receiving ${subject}`}
                  style={{ ...SELECT, flex: 1, minWidth: 0 }}
                >
                  {line.matches.map((offer) => (
                    <option key={offer.offerId} value={offer.offerId}>
                      {offerOption(offer)}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <Tooltip content={`${target.label} — it will then have ${plural(resultingSetCount, "set", "sets")}.`}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                  Added to {formatEntityNo(target.offerNo)} <OfferStateChip state={target.state} />
                </span>
              </Tooltip>
            )
          ) : (
            <>
              <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>New offer</span>
              {lotNo !== null && <span style={HINT}>· lot {lotNo}</span>}
              {line.biddingMatches.length > 0 && (
                <Tooltip content={biddingNote(line.biddingMatches)}>
                  <Icon name="warning" size="sm" color="var(--color-text-muted)" />
                </Tooltip>
              )}
            </>
          )}
        </span>
      </div>
      {open && (
        <LineCopies
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          vendorMaps={vendorMaps}
          line={line}
          target={target}
          resultingSetCount={resultingSetCount}
        />
      )}
    </div>
  );
}

function biddingNote(offers: GeneratorOfferRef[]): string {
  const one = offers.length === 1;
  return `${offers.map((offer) => formatEntityNo(offer.offerNo)).join(", ")} ${one ? "lists" : "list"} the same, but ${one ? "is" : "are"} in active bidding, so nothing is added there.`;
}

/** Condition and certificate in the dictionary's own colours (#728); a format carries none. On an axis
 *  the set mixes, each value says how many of its copies are in it — *MH ×11* (#2102). */
function CombinationChip({ collectionId, part }: { collectionId: string; part: GeneratorCombinationPart }) {
  const label = part.count === null ? part.label : `${part.label} ×${part.count}`;
  const tooltip = part.count === null ? part.name : `${part.name} — ${plural(part.count, "copy", "copies")} of the set`;
  if (part.axis === "condition") {
    return <ConditionChip collectionId={collectionId} conditionId={part.id} label={label} tooltip={tooltip} />;
  }
  if (part.axis === "certificate") {
    return (
      <CertificateStatusChip collectionId={collectionId} certificateStatusId={part.id} label={label} tooltip={tooltip} />
    );
  }
  return (
    <Tooltip content={tooltip}>
      <span style={ROW_CHIP}>{label}</span>
    </Tooltip>
  );
}

/** The expanded line: every set's copies, each as the app's own copy row (#1887) — read-only, as the
 *  add-to-offer dialog draws a set's copies — with the set's number above it where there are several. */
function LineCopies({
  collectionId,
  areas,
  locations,
  baseCurrency,
  vendorMaps,
  line,
  target,
  resultingSetCount,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  vendorMaps: VendorMaps;
  line: GeneratorLineView;
  target: GeneratorOfferRef | null;
  resultingSetCount: number;
}) {
  return (
    <div style={{ background: "var(--color-bg-page)", padding: "0 0.75rem 0.625rem 3.75rem" }}>
      {line.sets.map((set, index) => (
        <div key={set.map((copy) => copy.id).join(",")}>
          {line.sets.length > 1 && <div style={{ ...HINT, padding: "0.5rem 0 0.25rem" }}>Set {index + 1}</div>}
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.375rem", overflow: "clip" }}>
            {set.map((copy, i) => (
              <InventoryItemRow
                key={copy.id}
                collectionId={collectionId}
                item={copy}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                primaryVendorId={copy.areaId ? (vendorMaps.primaryVendorByArea.get(copy.areaId) ?? null) : null}
                vendorMap={vendorMaps.vendorMapFor(copy.areaId, copy.issueId)}
                isLast={i === set.length - 1}
                readOnly
              />
            ))}
          </div>
        </div>
      ))}
      {target && (
        <div style={{ ...HINT, paddingTop: "0.5rem" }}>
          Added to {formatEntityNo(target.offerNo)} {target.label} — it will then have{" "}
          {plural(resultingSetCount, "set", "sets")}.
        </div>
      )}
      {!target && line.biddingMatches.length > 0 && (
        <div style={{ ...HINT, paddingTop: "0.5rem" }}>{biddingNote(line.biddingMatches)}</div>
      )}
    </div>
  );
}
