"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import type { StampSizePresetData, StampSizePresetSubject } from "@/lib/stamp-size-presets";
import {
  describeStampSizePresetApply,
  summarizeStampSizePresetApply,
} from "@/lib/stamp-size-preset-rules";
import type { RowAction } from "./row-actions-menu";
import { StampSizePresetPicker } from "./stamp-size-preset-picker";

// Applying a stamp size preset to an issue or a checklist (#806; ADR-0048 §4, §6, §7) — the Germania
// case for a series already entered: dozens of stamps, one size, one click, with the counts on screen
// before anything is written.
//
// ## Preview before write, skipping stated sizes by default
//
// This is the only irreversible act in the whole track. A stated size is a ruler measurement at a
// stated dpi or a figure typed on purpose, and a bulk replace would destroy the most expensive data
// in the feature with the same click that fills in the cheapest. So nothing is written until a
// preset is chosen and its counts are on screen, and the **"overwrite those too"** box starts
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
// by `applyStampSizePreset`, which is also what counts. The preview is that same function with
// `preview: true`, so the number in the dialog and the rows the write reaches cannot drift apart; the
// toast afterwards reports the write's own recount, not the preview's.
//
// There is **no bulk clear** (ADR-0048, *Deliberately left out*): no preset means *no size*, and a
// size is cleared on the stamp.

export interface ApplySizePresetScope {
  collectionId: string;
  subject: StampSizePresetSubject;
  /** Names the subject in the title — the issue's name, or the checklist's. */
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
      label: "Apply size preset…",
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
  const [overwriteStated, setOverwriteStated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  // Fresh on every opening and every pick: `gcTime: 0` keeps a count from a previous opening from
  // being shown while this one loads, and the counts are the whole point of the dialog.
  const preview = useQuery({
    queryKey: ["stamp-size-preset-preview", preset?.id ?? null, subjectKey(subject)],
    enabled: preset !== null,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { previewStampSizePresetAction } = await import("@/app/actions/stamp-size-presets");
      const state = await previewStampSizePresetAction(preset!.id, subject);
      if (state.status === "error") throw new Error(state.message);
      return state.result;
    },
  });

  const counts = preview.data;
  const description = counts ? describeStampSizePresetApply(counts, overwriteStated) : null;
  const willWrite = description?.willWrite ?? 0;

  function close() {
    if (!isPending) onClose();
  }

  function apply() {
    if (!preset || !counts || willWrite === 0) return;
    setError(undefined);
    startTransition(async () => {
      const { applyStampSizePresetAction } = await import("@/app/actions/stamp-size-presets");
      const state = await applyStampSizePresetAction(preset.id, subject, overwriteStated);
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

  return (
    <DialogShell
      title={`Apply size preset — ${subjectLabel}`}
      onClose={close}
      dismissable={!pickerOpen && !isPending}
    >
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={muted}>
            Writes a preset&apos;s width and height onto every stamp here — its variants and child
            stamps too, at any depth. The figures are copied: correcting the preset later does not
            change these stamps. A stamp that already states a size is left alone unless you say
            otherwise below.
          </p>

          <div>
            <LabelWithError>Preset</LabelWithError>
            <StampSizePresetPicker
              collectionId={collectionId}
              selectedId={preset?.id ?? null}
              triggerLabel={preset ? undefined : "Choose a preset…"}
              width="100%"
              disabled={isPending}
              onOpenChange={setPickerOpen}
              onPick={(p) => {
                setPreset(p);
                setError(undefined);
              }}
            />
          </div>

          {preset && (
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
              {preview.isPending ? (
                <p style={muted}>Counting the stamps…</p>
              ) : preview.isError || !counts || !description ? (
                <p style={{ ...muted, color: "var(--color-error)" }}>
                  {preview.error instanceof Error
                    ? preview.error.message
                    : "Could not count the stamps."}
                </p>
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
        onAction={apply}
        onCancel={close}
        disabled={isPending || !preset || !counts || willWrite === 0}
        cancelDisabled={isPending}
        error={error}
      />
    </DialogShell>
  );
}
