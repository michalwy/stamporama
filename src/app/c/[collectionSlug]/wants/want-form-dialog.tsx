"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import { effectivePrimaryVendorId, effectiveVendorsForArea } from "@/lib/area-vendor";
import {
  StampSelect,
  type PickedIssue,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-select";
import {
  issueLabel,
  orderedCatalogLabels,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import type { WantCreateInput, WantListItem } from "@/lib/wants";
import {
  WANT_PRIORITIES,
  WANT_PRIORITY_CHIP,
  WANT_PRIORITY_LABEL,
  type WantPriority,
} from "@/lib/want-rules";
import { WantAcceptanceFields } from "./want-acceptance-fields";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

/** Above this dialog's panel (`zIndexBase + 1` = 101), so an acceptance menu opened inside it is
 *  not painted behind it. */
const MENU_Z_INDEX = 200;

const HINT: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/**
 * Priority as **three chips**, one chosen, rather than a `<select>`.
 *
 * They are drawn in the very colours the list row uses (`WANT_PRIORITY_CHIP`), which is the reason
 * to spend the width: the thing being picked here is the thing that will be recognised there, and a
 * dropdown showed the word without the signal. Three options is also exactly the size at which a
 * closed menu costs more than it saves — the whole vocabulary fits on one line.
 *
 * A `radiogroup`, not a row of toggles: the answers are mutually exclusive, so a screen reader
 * should be told that one of three is selected rather than that three things are separately pressed.
 */
function PriorityChoice({
  value,
  onChange,
  disabled,
}: {
  value: WantPriority;
  onChange: (next: WantPriority) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Priority"
      style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", minHeight: "2rem", alignItems: "center" }}
    >
      {WANT_PRIORITIES.map((p) => {
        const active = p === value;
        const chip = WANT_PRIORITY_CHIP[p];
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(p)}
            style={{
              padding: "0.25rem 0.625rem",
              borderRadius: "0.375rem",
              fontSize: "0.8125rem",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              // Unchosen chips stay plain: three coloured chips side by side would say that all
              // three are the answer, and the colour is what marks the one that is.
              background: active ? chip.background : "transparent",
              color: active ? chip.color : "var(--color-text-muted)",
              border: `1px solid ${active ? chip.border : "var(--color-border-strong)"}`,
              fontWeight: active ? 600 : 400,
            }}
          >
            {WANT_PRIORITY_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Add or edit one want (#532; ADR-0032).
 *
 * The stamp field is the **same `StampSelect` the Add copy dialog uses** — inline autocomplete plus
 * *Browse…*, collapsing to a chip summary with *Change* once picked. Both screens ask the identical
 * question ("which stamp is this about?"), and a want typed at a fair is found the same way a copy
 * is: by catalog number, by name, or by walking areas and issues.
 *
 * On an **add** the Browse popup also offers each issue's checklists, exactly as lot intake and
 * auction lot composition do: someone collecting a series is after every stamp on it on the same
 * terms, and entering that twelve times is the work the *whole set* button exists to remove. The
 * fan-out creates one want **per stamp** — a want is per stamp because each is found, priced and
 * closed on its own day — sharing this form's acceptance, price, priority and note.
 *
 * An **edit** offers no whole set: turning one want into twelve is not an edit.
 */
export function WantFormDialog({
  mode,
  collectionId,
  areas,
  want,
  initialStamp,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  mode: "add" | "edit";
  collectionId: string;
  /** For the Browse… popup's area → issue → stamp tree, and for prefix-formatting the summary. */
  areas: CollectionAreaData[];
  want?: WantListItem;
  /** Add mode opened from a catalogue row (#532): the stamp is already answered, so the form opens
   *  on the terms instead of on the picker. Still changeable — the picker's *Change* is right
   *  there — because opening this from the wrong row is a thing that happens. */
  initialStamp?: PickedStamp;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: WantCreateInput) => void;
}) {
  const [stampId, setStampId] = useState(want?.stampId ?? initialStamp?.stampId ?? "");
  const [checklist, setChecklist] = useState<PickedIssue | null>(null);
  // A picker popup stacks above this dialog; while one is up this dialog must stop dismissing
  // itself, or one Esc would close both.
  const [pickerOpen, setPickerOpen] = useState(false);
  // …and so does an acceptance menu, which is a popover rather than a layer (#361).
  const [menuOpen, setMenuOpen] = useState(false);
  const [acceptance, setAcceptance] = useState({
    conditionIds: want?.conditionIds ?? [],
    certificateStatusIds: want?.certificateStatusIds ?? [],
    formatIds: want?.formatIds ?? [],
  });
  const [priority, setPriority] = useState(want?.priority ?? "normal");
  const [notes, setNotes] = useState(want?.notes ?? "");

  // Prefill the picker summary on an edit, exactly as the copy form does: the want's catalog
  // numbers are raw (vendor id + number), so they are prefix-formatted here against the stamp's own
  // area — the same labels a fresh pick produces (#357).
  const pickerInitial: PickedStamp | undefined = initialStamp ?? (want
    ? {
        stampId: want.stampId,
        catalogLabels: orderedCatalogLabels(
          want.catalogNumbers,
          want.areaId
            ? new Map(effectiveVendorsForArea(areas, want.areaId).map((v) => [v.catalogVendorId, v]))
            : undefined,
          want.areaId ? effectivePrimaryVendorId(areas, want.areaId) : null
        ),
        name: want.stampName,
        secondary:
          want.issueName || want.issueYear ? issueLabel(want.issueName, want.issueYear) : null,
        unknownVariant: want.unknownVariant,
      }
    : undefined);

  // The button counts what it will make, the way the auction line dialog's does: a control that
  // creates twelve rows must not read the same as one that creates one.
  const actionLabel = isPending
    ? "Saving…"
    : mode === "edit"
      ? "Save want"
      : checklist
        ? `Add ${checklist.requiredCount} want${checklist.requiredCount === 1 ? "" : "s"}`
        : "Add want";

  return (
    <DialogShell
      title={mode === "add" ? "Add to want list" : "Edit want"}
      onClose={onClose}
      maxWidth="34rem"
      dismissable={!pickerOpen && !menuOpen}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!stampId && !checklist) return;
          onSubmit({
            stampId: stampId || null,
            checklistId: checklist?.checklistId ?? null,
            ...acceptance,
            priority,
            notes: notes.trim() || null,
          });
        }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <LabelWithError htmlFor="copy-stamp-search">Stamp</LabelWithError>
              <StampSelect
                collectionId={collectionId}
                areas={areas}
                selectedStampId={stampId}
                onSelectedStampIdChange={setStampId}
                initial={pickerInitial}
                // Add only: an edit changes one want, and a whole set is a different act.
                checklist={
                  mode === "add" ? { selected: checklist, onChange: setChecklist } : undefined
                }
                disabled={isPending}
                onPickerOpenChange={setPickerOpen}
              />
              {checklist && (
                <p style={HINT}>
                  One want per stamp on the set, all on the terms below. Stamps already on the want
                  list are left alone.
                </p>
              )}
            </div>

            {/* The three acceptance axes and Priority in one two-column block: they are the want's
                *terms*, answered together, and a control on a row of its own below would read as a
                different kind of question. Priority rides in the grid's fourth cell rather than in
                a second grid, so the four labels line up.

                There is no maximum price, deliberately (ADR-0032 §5): a want has no date, so a
                figure on it would be a price opinion frozen the day it was typed, and what a stamp
                is worth at the moment of buying is the recommendation engine's answer against the
                copy actually in front of you. */}
            <WantAcceptanceFields
              collectionId={collectionId}
              value={acceptance}
              onChange={setAcceptance}
              disabled={isPending}
              // Above this dialog's own panel, or the menu opens behind it.
              menuZIndex={MENU_Z_INDEX}
              onPopoverOpenChange={setMenuOpen}
              extra={
                <div style={{ minWidth: 0 }}>
                  <LabelWithError>Priority</LabelWithError>
                  <PriorityChoice
                    value={priority}
                    onChange={setPriority}
                    disabled={isPending}
                  />
                </div>
              }
            />

            <div>
              <LabelWithError htmlFor="want-notes">Notes (optional)</LabelWithError>
              <textarea
                id="want-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isPending}
                rows={2}
                style={{ ...INPUT_STYLE, resize: "vertical" }}
              />
              <p style={HINT}>
                Taking a copy in never closes a want on its own — the copies that could satisfy one
                are put in front of you at intake, and closing, narrowing or leaving it open is your
                call.
              </p>
            </div>
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          disabled={isPending || (!stampId && !checklist)}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
