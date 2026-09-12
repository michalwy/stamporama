"use client";

import Link from "next/link";
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
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { BulkCopyChanges } from "@/app/c/[collectionSlug]/shared/bulk-copy-changes";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { useCollectionTags } from "@/app/c/[collectionSlug]/shared/use-tags";

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

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "0.3rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

/** The three identity axes' *leave as is*, as a `<select>` value. `""` so the untouched state needs
 * no sentinel of its own — an axis nobody has answered is a blank select. */
const KEEP = "";

/** The **null** value on the two axes that have one — *no certificate*, *single*. It is a value
 * here, not the absence of an answer (ADR-0006 §2; ADR-0020), so it needs a key of its own next to
 * {@link KEEP}, which is the absence. Never leaves this module: the submit maps it back to `null`. */
const NONE = "__none__";

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

/** Above this dialog's own panel (`zIndexBase + 1` = 101), so a tag menu opened inside it is not
 *  painted behind it — `MultiSelectFilter`'s own note. */
const MENU_Z_INDEX = 200;

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
 * Change **where a batch of copies is kept, what it is kept for, and what it is** (#682/#723), from
 * the Copies list's own selection (#373).
 *
 * One dialog rather than a bar button per axis, because the bar already carries four controls and
 * these changes are routinely the same act — a drawer of duplicates is filed away *and* flagged for
 * trade in one pass; a batch relabelled to a better grade is the batch whose certificate has just
 * come back. Every section may be left alone, so the dialog is equally the *move* action, the
 * *re-flag* action and the *re-grade* action; it refuses to submit only when no section says
 * anything.
 *
 * The identity axes (#723) are `<select>`s rather than the segmented controls above them for the
 * ordinary reason: a segmented control states every answer at once, which is right for three
 * choices and wrong for a collection's twenty grades. Two of them carry a **null value** — *No
 * certificate* and *Single* — as an option beside the real ones rather than as a *Clear* mode of
 * their own: null is a value on those axes (ADR-0006 §2; ADR-0020), so it belongs in the same list,
 * and the mode picker the location needs exists only because "no location" and "leave the location
 * alone" are genuinely two acts there. Condition has no such option at all: `Item.conditionId` is
 * not nullable, so its only two states are *leave alone* and a grade.
 *
 * The **ref rides with the location**, exactly as it does when a purchase is stored (#565): it
 * names a card *inside* a location, so it is offered only while one is being chosen, and a move
 * with the box left blank clears the refs the copies carried — a slot name from the old album
 * addresses nothing in the new one.
 *
 * **Tags are the one axis stated as two verbs** (#1181), and they are the exception that proves
 * every other section's rule rather than a break from it. A copy has one location, one grade and
 * one answer per disposition flag, so *leave as is* there is a third option beside the values; a
 * copy carries **any number** of tags, so there is no single value a picker could show and a
 * replace over a mixed drawer would flatten forty copies onto whatever this dialog happened to
 * hold. So it adds the tags it names, removes the tags it names, and leaves every tag it does not
 * name exactly where it is on each copy. A tag ticked on one side is not offered on the other, so
 * the contradiction cannot be typed.
 *
 * The write is the intake screen's own (`bulkUpdateLotItemsAction`, #121/#565): the same fields
 * over the same rows, so a copy filed from the Copies list and one filed while its purchase was
 * being sorted cannot end up written two different ways. The tags ride in that same call and the
 * same transaction — a bulk edit is one act, and half of it landing is the thing a bulk pass must
 * never do quietly.
 */
export function BulkEditCopiesDialog({
  collectionId,
  collectionSlug,
  copies,
  locations,
  conditions,
  certificateStatuses,
  formats,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  collectionId: string;
  /** For the *Add one in Settings* link the empty dictionary offers — nothing is seeded (#152). */
  collectionSlug: string;
  copies: ItemListItem[];
  locations: LocationData[];
  /** The collection's grades (#723). Empty hides the section — there is nothing to change to. */
  conditions: StampConditionData[];
  /** The collection's certificate statuses (#723). Most collections define none, and the section is
   *  absent entirely there, exactly as the list's own certificate filter is (#428). */
  certificateStatuses: CertificateStatusData[];
  /** The collection's physical formats (#723). Absent when none are defined, as above (#343). */
  formats: StampFormatData[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (changes: BulkCopyChanges) => void;
}) {
  const [locationMode, setLocationMode] = useState<LocationMode>("keep");
  const [locationId, setLocationId] = useState("");
  const [locationRef, setLocationRef] = useState("");
  const [flagOps, setFlagOps] = useState<Record<DispositionFlag, FlagOp>>(NO_FLAG_CHANGES);
  // The three identity axes, each holding KEEP, NONE (where it has one) or a dictionary id.
  const [conditionChoice, setConditionChoice] = useState(KEEP);
  const [certificateChoice, setCertificateChoice] = useState(KEEP);
  const [formatChoice, setFormatChoice] = useState(KEEP);
  // The two tag lists (#1181). Their own hook rather than a prop, exactly as the edit dialogs' tag
  // field reads the dictionary: it is small, per-collection and cached, and this dialog is opened
  // from a list that has no other reason to hold it.
  const { data: tags } = useCollectionTags(collectionId);
  const [addTagIds, setAddTagIds] = useState<string[]>([]);
  const [removeTagIds, setRemoveTagIds] = useState<string[]>([]);
  // A tag menu is a popover with an Escape listener of its own and is not an escape layer (#361),
  // so one Escape would otherwise close the menu *and* this dialog under it.
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
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
  // How much of the selection each answered identity axis would leave exactly as it is — the same
  // number the disposition rows carry, and for the same reason: it is what says whether an apply is
  // a re-grade or a no-op over copies that already read that way.
  const identityAxes = [
    {
      key: "condition" as const,
      label: "Condition",
      choice: conditionChoice,
      setChoice: setConditionChoice,
      // A grade is never "none", so the option list is the dictionary and nothing else.
      options: conditions.map((c) => ({ value: c.id, label: c.name })),
      unchanged: copies.filter((c) => c.conditionId === conditionChoice).length,
      available: conditions.length > 0,
    },
    {
      key: "certificate" as const,
      label: "Certificate",
      choice: certificateChoice,
      setChoice: setCertificateChoice,
      options: [
        { value: NONE, label: "No certificate" },
        ...certificateStatuses.map((c) => ({ value: c.id, label: c.name })),
      ],
      unchanged: copies.filter(
        (c) => (c.certificateStatusId ?? NONE) === certificateChoice
      ).length,
      available: certificateStatuses.length > 0,
    },
    {
      key: "format" as const,
      label: "Format",
      choice: formatChoice,
      setChoice: setFormatChoice,
      options: [
        { value: NONE, label: "Single" },
        ...formats.map((f) => ({ value: f.id, label: f.name })),
      ],
      unchanged: copies.filter((c) => (c.formatId ?? NONE) === formatChoice).length,
      available: formats.length > 0,
    },
  ].filter((axis) => axis.available);
  const changedIdentity = identityAxes.filter((axis) => axis.choice !== KEEP);
  const changesTags = addTagIds.length > 0 || removeTagIds.length > 0;
  const canApply =
    !isPending &&
    (locationAnswered || changedFlags.length > 0 || changedIdentity.length > 0 || changesTags);

  return (
    <DialogShell
      title={`Bulk edit — ${copiesLabel}`}
      onClose={onClose}
      maxWidth="30rem"
      dismissable={!tagMenuOpen}
    >
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
          // The sentinel is mapped back at this boundary and never travels: the wire carries a real
          // id or an empty field, and an empty field is the null value the axis has (#723).
          if (conditionChoice !== KEEP) changes.conditionId = conditionChoice;
          if (certificateChoice !== KEEP) {
            changes.certificateStatusId = certificateChoice === NONE ? null : certificateChoice;
          }
          if (formatChoice !== KEEP) {
            changes.formatId = formatChoice === NONE ? null : formatChoice;
          }
          // Sent only when non-empty: an empty list is not a value on this axis, it is silence.
          if (addTagIds.length > 0) changes.addTagIds = addTagIds;
          if (removeTagIds.length > 0) changes.removeTagIds = removeTagIds;
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
                          {describeAlready(already, count)}
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

            {/* What the copies **are** (#723): the grade, the certificate and the physical format.
                The correction a mixed batch usually needs — a drawer relabelled to a better grade,
                a run of pairs recorded as singles — done once instead of copy by copy. */}
            {identityAxes.length > 0 && (
              <div>
                <LabelWithError>Condition, certificate and format</LabelWithError>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {identityAxes.map((axis) => (
                    <div
                      key={axis.key}
                      style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}
                    >
                      <label
                        htmlFor={`bulk-edit-${axis.key}`}
                        style={{
                          width: "7.5rem",
                          flexShrink: 0,
                          fontSize: "0.8125rem",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {axis.label}
                      </label>
                      <select
                        id={`bulk-edit-${axis.key}`}
                        value={axis.choice}
                        onChange={(e) => axis.setChoice(e.target.value)}
                        disabled={isPending}
                        style={SELECT_STYLE}
                      >
                        <option value={KEEP}>Leave as is</option>
                        {axis.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {axis.choice !== KEEP && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--color-text-muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {describeAlready(axis.unchanged, count)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <p style={HINT_STYLE}>
                  Applied to every selected copy, whatever it reads now — this is the correction of a
                  batch that was recorded wrong, not a filter. Catalog values are looked up per
                  condition, so a re-graded copy is valued against its new grade from here on.
                </p>
              </div>
            )}

            {/* The collector's own labels (#1181). Two controls, never one: a copy carries any
                number of tags, so *what these copies are tagged* has no single answer a picker
                could show — the pass says what to put on and what to take off, and everything it
                does not name stays. Shown even with an empty dictionary, because nothing is seeded;
                the link is where a first tag can be made from here, since this pass picks existing
                tags rather than typing new ones (#1192 left the bulk edit as it was). */}
            <div>
              <LabelWithError>Tags</LabelWithError>
              {(tags?.length ?? 0) === 0 ? (
                <p style={HINT_STYLE}>
                  No tags yet.{" "}
                  <Link
                    href={`/c/${collectionSlug}/settings?tab=tags`}
                    style={{ color: "var(--color-accent)" }}
                  >
                    Add one in Settings
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <TagRow
                      label="Add"
                      // A tag already ticked to be removed is not offered here, so *put it on and
                      // take it off in one pass* cannot be stated at all.
                      options={(tags ?? [])
                        .filter((t) => !removeTagIds.includes(t.id))
                        .map((t) => ({ id: t.id, label: t.name }))}
                      selected={addTagIds}
                      onChange={setAddTagIds}
                      allLabel="No tags to add"
                      disabled={isPending}
                      onOpenChange={setTagMenuOpen}
                      // How many already carry **every** tag being added — the number that says
                      // whether this is a tagging pass or a no-op, as each row above it does.
                      note={
                        addTagIds.length === 0
                          ? null
                          : describeAlready(
                              copies.filter((c) =>
                                addTagIds.every((id) => c.tags.some((t) => t.id === id))
                              ).length,
                              count
                            )
                      }
                    />
                    <TagRow
                      label="Remove"
                      options={(tags ?? [])
                        .filter((t) => !addTagIds.includes(t.id))
                        .map((t) => ({ id: t.id, label: t.name }))}
                      selected={removeTagIds}
                      onChange={setRemoveTagIds}
                      allLabel="No tags to remove"
                      disabled={isPending}
                      onOpenChange={setTagMenuOpen}
                      // Here the useful count is the opposite one: how many the removal actually
                      // reaches. A copy not carrying the tag is left alone rather than failing.
                      note={
                        removeTagIds.length === 0
                          ? null
                          : `on ${
                              copies.filter((c) =>
                                removeTagIds.some((id) => c.tags.some((t) => t.id === id))
                              ).length
                            } of ${count}`
                      }
                    />
                  </div>
                  <p style={HINT_STYLE}>
                    Only the tags named here change. Every other tag each copy carries is left
                    exactly as it is — this is not a way to set the tags to one list.
                  </p>
                </>
              )}
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

/** *all of them already* / *3 of 40 already* — the phrasing the disposition and identity rows use,
 *  shared so the tag rows cannot word the same fact differently. */
function describeAlready(already: number, count: number): string {
  return already === count
    ? `all ${count === 1 ? "of it" : "of them"} already`
    : `${already} of ${count} already`;
}

/** One half of the tag change: a label, a multi-select over the dictionary, and the count saying
 *  what it would actually reach. Laid out as the disposition and identity rows are, so the three
 *  sections read down the same two columns. */
function TagRow({
  label,
  options,
  selected,
  onChange,
  allLabel,
  disabled,
  onOpenChange,
  note,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  note: string | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
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
      <span style={{ flex: 1, minWidth: 0 }}>
        <MultiSelectFilter
          options={options}
          selected={selected}
          onChange={onChange}
          allLabel={allLabel}
          itemNoun="tags"
          ariaLabel={`${label} tags`}
          disabled={disabled}
          fullWidth
          zIndex={MENU_Z_INDEX}
          onOpenChange={onOpenChange}
        />
      </span>
      {note && (
        <span
          style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}
        >
          {note}
        </span>
      )}
    </div>
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
