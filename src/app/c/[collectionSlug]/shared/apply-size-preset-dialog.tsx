"use client";

import { useState, useTransition } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import type { StampSizeApplySource } from "@/app/actions/stamp-size-presets";
import type { StampSizePresetData, StampSizePresetSubject } from "@/lib/stamp-size-presets";
import {
  describeStampSizePresetApply,
  sizePairFromFields,
  summarizeStampSizePresetApply,
} from "@/lib/stamp-size-preset-rules";
import { formatSizeMm, parseSizeMm } from "@/lib/stamp-size";
import { STAMP_SIZE_LABELS } from "@/lib/stamp-attribute-kinds";
import { NO_AUTOFILL } from "./no-autofill";
import type { RowAction } from "./row-actions-menu";
import { StampSizePresetPicker } from "./stamp-size-preset-picker";
import { TextInput } from "./text-input";

// Applying a stamp size preset to an issue or a checklist (#806; ADR-0048 §4, §6, §7) — the Germania
// case for a series already entered: dozens of stamps, one size, one click, with the counts on screen
// before anything is written.
//
// The subject is an issue or a checklist from their rows (#806), or the stamps ticked on the Issues
// list's tree (#809) — nothing below depends on which.
//
// ## A preset, or a typed size (#1291)
//
// The pair is chosen with the picker **or typed into the two fields** — a size that occurs in one
// series and nowhere else should not have to become a preset to be applied once. It is this dialog
// and not a second one: the preview, the box, the subtree and the toast below are the same whichever
// way the pair was named. Picking a preset fills the fields, so they always show the figures about to
// be written; editing either field afterwards lets the preset go and applies what the fields hold.
// Nothing is saved as a preset on the way.
//
// ## Preview before write, skipping stated sizes by default
//
// This is the only irreversible act in the whole track. A stated size is a ruler measurement at a
// stated dpi or a figure typed on purpose, and a bulk replace would destroy the most expensive data
// in the feature with the same click that fills in the cheapest. So nothing is written until a
// size is chosen and its counts are on screen, and the **"overwrite those too"** box starts
// unchecked. Overwriting stays possible — a series whose early figure was wrong is exactly what a
// preset should correct — as a second, separate decision taken with the counts in view.
//
// ## The box is not remembered
//
// Its state lives in this component and the component exists only while the dialog is open, so every
// opening starts unchecked. That is deliberate and should not be "improved" with `localStorage`: a
// destructive default that persists is a destructive default.
//
// ## The counts cover the whole subtree
//
// Every descendant of every member, at any depth, variant or distinct entry alike — ADR-0048 §7, done
// by `applyStampSizePreset` or, for a typed pair, `applyStampSize` — one write behind both, which is
// also what counts. The preview is that same function with
// `preview: true`, so the number in the dialog and the rows the write reaches cannot drift apart; the
// toast afterwards reports the write's own recount, not the preview's.
//
// ## Enter applies, as the dialog stands (#1303)
//
// The body and the footer are one `<form>` and **Apply** is its submit button, so Enter confirms
// the dialog exactly as a click would. It goes through the same disabled button, so while nothing is
// chosen, the figures are incomplete or the counts are not in, Enter does nothing — a disabled
// default button blocks implicit submission. It never ticks the overwrite box: that stays the second,
// deliberate decision above. The preset picker's list is portalled outside the form and takes Enter
// for itself, so Enter there picks a preset and applies nothing.
//
// There is **no bulk clear** (ADR-0048, *Deliberately left out*): no preset means *no size*, and a
// size is cleared on the stamp.

export interface ApplySizePresetScope {
  collectionId: string;
  subject: StampSizePresetSubject;
  /** Names the subject in the title — the issue's name, the checklist's, or `3 selected stamps`. */
  subjectLabel: string;
  /** Called after a write, for a caller whose screen draws a stamp's size. */
  onApplied?: () => void;
}

/** Row-menu entry opening the apply dialog, on the `{ action, dialog }` convention so the dialog
 *  survives the menu closing. */
export function useApplySizePresetAction(scope: ApplySizePresetScope): {
  action: RowAction;
  dialog: React.ReactNode;
} {
  const [open, setOpen] = useState(false);
  return {
    action: {
      key: "apply-size-preset",
      label: "Apply size…",
      icon: "sizePreset",
      onSelect: () => setOpen(true),
    },
    dialog: open ? <ApplySizePresetDialog scope={scope} onClose={() => setOpen(false)} /> : null,
  };
}

function subjectKey(subject: StampSizePresetSubject): string {
  if (subject.kind === "issue") return `issue:${subject.issueId}`;
  if (subject.kind === "checklist") return `checklist:${subject.checklistId}`;
  return `stamps:${[...subject.stampIds].sort().join(",")}`;
}

function sourceKey(source: StampSizeApplySource | null): string | null {
  if (!source) return null;
  if (source.kind === "preset") return `preset:${source.presetId}`;
  return `typed:${source.widthText.trim()}x${source.heightText.trim()}`;
}

const SIZE_FIELDS = ["widthMm", "heightMm"] as const;

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

export function ApplySizePresetDialog({
  scope,
  onClose,
}: {
  scope: ApplySizePresetScope;
  onClose: () => void;
}) {
  const { collectionId, subject, subjectLabel, onApplied } = scope;
  const { toast } = useToast();
  const [preset, setPreset] = useState<StampSizePresetData | null>(null);
  const [fields, setFields] = useState<Record<(typeof SIZE_FIELDS)[number], string>>({
    widthMm: "",
    heightMm: "",
  });
  const [overwriteStated, setOverwriteStated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  // The pair about to be written: the preset's while one is chosen, else what the fields hold —
  // whole and readable, on the form's own grammar (`sizePairFromFields`), or nothing at all.
  const pair = preset
    ? { widthMm: preset.widthMm, heightMm: preset.heightMm }
    : sizePairFromFields(fields.widthMm, fields.heightMm);
  const source: StampSizeApplySource | null = preset
    ? { kind: "preset", presetId: preset.id }
    : pair
      ? { kind: "typed", collectionId, widthText: fields.widthMm, heightText: fields.heightMm }
      : null;

  // Fresh on every opening and every change of size: `gcTime: 0` keeps a count from a previous
  // opening from being shown while this one loads, and the counts are the whole point of the dialog.
  // `keepPreviousData` holds the last counts on screen while the next figure is typed — they do not
  // depend on the pair, only on the subject, which one opening never changes.
  const preview = useQuery({
    queryKey: ["stamp-size-apply-preview", sourceKey(source), subjectKey(subject)],
    enabled: source !== null,
    staleTime: 0,
    gcTime: 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { previewStampSizeApplyAction } = await import("@/app/actions/stamp-size-presets");
      const state = await previewStampSizeApplyAction(source!, subject);
      if (state.status === "error") throw new Error(state.message);
      return state.result;
    },
  });

  const counts = source ? preview.data : undefined;
  // Worded with the pair on screen rather than the one the counts came back with, which may be a
  // keystroke behind; the counts themselves are the same for any pair.
  const description =
    counts && pair ? describeStampSizePresetApply({ ...counts, ...pair }, overwriteStated) : null;
  const willWrite = description?.willWrite ?? 0;

  function setField(field: (typeof SIZE_FIELDS)[number], text: string) {
    setFields((prev) => ({ ...prev, [field]: text }));
    setPreset(null);
    setError(undefined);
  }

  function close() {
    if (!isPending) onClose();
  }

  function apply() {
    if (!source || !counts || willWrite === 0) return;
    setError(undefined);
    startTransition(async () => {
      const { applyStampSizeAction } = await import("@/app/actions/stamp-size-presets");
      const state = await applyStampSizeAction(source, subject, overwriteStated);
      if (state.status === "error") {
        setError(state.message);
        return;
      }
      toast(summarizeStampSizePresetApply(state.result, overwriteStated));
      onApplied?.();
      onClose();
    });
  }

  const muted: React.CSSProperties = {
    fontSize: "0.8125rem",
    color: "var(--color-text-muted)",
    margin: 0,
    lineHeight: 1.5,
  };

  const started = preset !== null || fields.widthMm.trim() !== "" || fields.heightMm.trim() !== "";

  return (
    <DialogShell
      title={`Apply size — ${subjectLabel}`}
      onClose={close}
      dismissable={!pickerOpen && !isPending}
    >
      <form
        style={FORM_STYLE}
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={muted}>
              Writes a width and height onto every stamp here — its variants and child stamps too, at
              any depth. Type the figures, or fill them from a preset. They are copied: correcting a
              preset later does not change these stamps. A stamp that already states a size is left
              alone unless you say otherwise below.
            </p>

            <div
              style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem 1rem", flexWrap: "wrap" }}
            >
              {SIZE_FIELDS.map((field) => {
                const text = fields[field];
                const unreadable = text.trim() !== "" && !parseSizeMm(text).ok;
                return (
                  <div key={field} style={{ width: "9rem" }}>
                    <LabelWithError htmlFor={`f-apply-size-${field}`}>
                      {STAMP_SIZE_LABELS[field].field}
                    </LabelWithError>
                    <TextInput
                      id={`f-apply-size-${field}`}
                      inputMode="decimal"
                      disabled={isPending}
                      value={text}
                      onChange={(e) => setField(field, e.target.value)}
                      placeholder={STAMP_SIZE_LABELS[field].example}
                      aria-invalid={unreadable || undefined}
                      {...NO_AUTOFILL}
                      style={{
                        ...INPUT_STYLE,
                        ...(unreadable ? { borderColor: "var(--color-error)" } : null),
                      }}
                    />
                  </div>
                );
              })}
              <StampSizePresetPicker
                collectionId={collectionId}
                selectedId={preset?.id ?? null}
                triggerLabel="Fill from a preset"
                width="14rem"
                disabled={isPending}
                onOpenChange={setPickerOpen}
                onPick={(p) => {
                  setPreset(p);
                  setFields({ widthMm: formatSizeMm(p.widthMm), heightMm: formatSizeMm(p.heightMm) });
                  setError(undefined);
                }}
              />
            </div>

            {started && (
              <div
                style={{
                  padding: "0.75rem 0.875rem",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.5rem",
                  background: "var(--color-bg-page)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                  color: "var(--color-text-primary)",
                }}
              >
                {!source ? (
                  <p style={muted}>
                    Millimetres, to a tenth — both a width and a height, like 21.5 and 25.
                  </p>
                ) : preview.isError ? (
                  <p style={{ ...muted, color: "var(--color-error)" }}>
                    {preview.error instanceof Error
                      ? preview.error.message
                      : "Could not count the stamps."}
                  </p>
                ) : !counts || !description ? (
                  <p style={muted}>Counting the stamps…</p>
                ) : (
                  <>
                    {description.lines.map((line) => (
                      <p key={line} style={{ margin: 0, lineHeight: 1.5 }}>
                        {line}
                      </p>
                    ))}
                    {counts.total > 0 && (
                      <p style={muted}>
                        {counts.total === 1 ? "1 stamp" : `${counts.total} stamps`} in all, variants
                        and child stamps included.
                      </p>
                    )}
                    {counts.withStatedSize > 0 && (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "0.5rem",
                          marginTop: "0.25rem",
                          cursor: isPending ? "default" : "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={overwriteStated}
                          disabled={isPending}
                          onChange={(e) => setOverwriteStated(e.target.checked)}
                          style={{ marginTop: "0.2rem" }}
                        />
                        <span>
                          Overwrite those too
                          <span style={{ display: "block", ...muted }}>
                            Replaces sizes that were measured or typed on those stamps. It cannot be
                            undone.
                          </span>
                        </span>
                      </label>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending
              ? "Applying…"
              : willWrite > 0
                ? `Apply to ${willWrite === 1 ? "1 stamp" : `${willWrite} stamps`}`
                : "Apply"
          }
          onCancel={close}
          disabled={isPending || !source || !counts || willWrite === 0 || preview.isError}
          cancelDisabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
