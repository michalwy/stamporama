"use client";

import { useState, useTransition } from "react";
import {
  applyLotRecipe,
  lotBuilderSearchParams,
  toLotRecipe,
  type LotBuilderRequest,
  type LotRecipe,
} from "@/lib/lot-builder-criteria";
import type { LotBuilderPresetData } from "@/lib/lot-builder-presets";
import { Icon } from "@/app/icons";
import {
  ConfirmDialog,
  DialogActions,
  DialogBody,
  DialogShell,
  ErrorBubble,
} from "@/app/dialog-shell";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useInvalidateOffers, useLotBuilderPresets } from "../use-offers-query";
import { NOTE } from "./lot-builder-chrome";

// Saved criteria for the bulk-lot builder (#773) — the control, on *The pick*'s heading row.
//
// **Why it exists.** The builder carries eleven controls. Stating them is most of the work of
// building a lot, and a collector who builds the same *kind* of lot repeatedly retypes all eleven
// and mistypes some of them.
//
// **Why it sits on The pick and not above the whole screen.** A preset holds the recipe and
// deliberately not the platform or the area (`LotRecipe`), and *The pool*'s controls are mostly the
// ones it does hold — years, conditions, formats, the per-copy ceiling — while the platform and the
// area are the ones it does not. Putting the control on the heading of the second band would have
// said the preset was about that band alone. It is on **The pick** because that is where the
// recipe's own name belongs, and the copy beside it says what it reaches.
//
// **Saving reads the address, not the controls.** The criteria live in the URL and the commit
// re-plans from it (#717); a preset saved from a second assembly of the same eleven fields would be
// a second place for them to disagree. So the action is handed `lotBuilderSearchParams(request)`
// and drops everything outside the recipe server-side, once.
//
// **Applying is whole, never a merge**, and it leaves the platform, the area and the subtree scope
// exactly as they stand — the two halves of what makes one preset usable over Germany and then over
// Poland.

/** Whether what is on screen still says what the selected preset says. Compared through the query
 *  string rather than field by field: the criteria's own round trip is what both the proposal and
 *  the commit are built on, so two recipes are the same exactly when it says they are. */
function sameRecipe(a: LotRecipe, b: LotRecipe): boolean {
  const key = (recipe: LotRecipe) =>
    lotBuilderSearchParams({
      criteria: { ...recipe, platformId: "", areaId: null, areaSubtree: true },
      seed: "",
      pinnedItemIds: [],
      rejectedItemIds: [],
    }).toString();
  return key(a) === key(b);
}

type Dialog = { kind: "none" } | { kind: "save" } | { kind: "delete"; preset: LotBuilderPresetData };

export function LotPresetBar({
  collectionId,
  request,
  onApply,
  disabled,
}: {
  collectionId: string;
  request: LotBuilderRequest;
  /** Hands back the criteria with the recipe laid over them — the panel writes them to the URL. */
  onApply: (recipe: LotRecipe) => void;
  disabled: boolean;
}) {
  const { data: presets } = useLotBuilderPresets(collectionId);
  const { invalidateAll } = useInvalidateOffers();
  // Which preset the screen is *working from*. Component state, not the URL: the criteria are the
  // navigation state and the preset is only the name they arrived under, so a link carries the lot
  // rather than a preset id that may have been renamed or deleted since.
  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const current = presets?.find((p) => p.id === selectedId);
  const onScreen = toLotRecipe(request.criteria);
  const edited = !!current && !sameRecipe(current.recipe, onScreen);
  const search = lotBuilderSearchParams(request).toString();

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  function save() {
    setError(undefined);
    startTransition(async () => {
      const { createLotBuilderPresetAction } = await import("@/app/actions/offers");
      const result = await createLotBuilderPresetAction(collectionId, name, search);
      if (result.status === "error") setError(result.message);
      else {
        setSelectedId(result.presetId);
        setDialog({ kind: "none" });
        await invalidateAll(collectionId);
      }
    });
  }

  function update() {
    if (!current) return;
    setError(undefined);
    startTransition(async () => {
      const { updateLotBuilderPresetAction } = await import("@/app/actions/offers");
      const result = await updateLotBuilderPresetAction(current.id, current.name, search);
      if (result.status === "error") setError(result.message);
      else await invalidateAll(collectionId);
    });
  }

  function remove(preset: LotBuilderPresetData) {
    setError(undefined);
    startTransition(async () => {
      const { deleteLotBuilderPresetAction } = await import("@/app/actions/offers");
      const result = await deleteLotBuilderPresetAction(preset.id);
      if (result.status === "error") setError(result.message);
      else {
        if (selectedId === preset.id) setSelectedId("");
        setDialog({ kind: "none" });
        await invalidateAll(collectionId);
      }
    });
  }

  const busy = disabled || isPending;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      {presets && presets.length > 0 && (
        <>
          <select
            aria-label="Saved criteria"
            style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer", maxWidth: "14rem" }}
            value={selectedId}
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.currentTarget.value);
              setSelectedId(preset?.id ?? "");
              if (preset) onApply(preset.recipe);
            }}
            disabled={busy}
          >
            <option value="">Saved criteria…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {/* The offer list's own word for a text that has stopped following what generated it
              (#636's `edited` chip). Here it says the same thing about a recipe: the preset is still
              what you started from, and the screen no longer says what it says. */}
          {edited && <span style={NOTE}>· edited</span>}
        </>
      )}

      {current && edited && (
        <Tooltip content={`Overwrite "${current.name}" with what is on screen`}>
          <button type="button" onClick={update} disabled={busy} style={PRESET_BTN}>
            <Icon name="check" size="sm" /> Update
          </button>
        </Tooltip>
      )}

      <Tooltip content="Keep these criteria under a name — the years, conditions, formats, ceilings, targets and preferences, but not the platform or the area">
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            setName("");
            setDialog({ kind: "save" });
          }}
          disabled={busy}
          style={PRESET_BTN}
        >
          <Icon name="add" size="sm" /> Save as…
        </button>
      </Tooltip>

      {current && (
        <Tooltip content={`Delete "${current.name}"`} align="end">
          <button
            type="button"
            onClick={() => setDialog({ kind: "delete", preset: current })}
            disabled={busy}
            style={{ ...PRESET_BTN, color: "var(--color-error)" }}
          >
            <Icon name="delete" size="sm" />
          </button>
        </Tooltip>
      )}

      {/* A failure with no form left on screen — the update and the delete both act straight off the
          bar — states itself here rather than as a toast, which is dismissed and gone. */}
      {error && dialog.kind === "none" && <span style={{ ...NOTE, color: "var(--color-error)" }}>{error}</span>}

      {dialog.kind === "save" && (
        <DialogShell title="Save these criteria" onClose={close}>
          <DialogBody>
            <label
              htmlFor="lot-preset-name"
              style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, marginBottom: "0.375rem" }}
            >
              Name
            </label>
            <input
              id="lot-preset-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="e.g. Job lots, ~100 used"
              style={{ ...FILTER_CONTROL_STYLE, width: "100%" }}
            />
            <p style={{ ...NOTE, margin: "0.75rem 0 0", lineHeight: 1.5 }}>
              Keeps the years, the conditions and formats, the per-copy ceiling, both targets and the
              three preferences. <strong>Not</strong> the platform and not the area — those are what
              you change between two lots of the same kind, so the same saved criteria work over one
              area today and another tomorrow.
            </p>
          </DialogBody>
          <DialogActions
            actionLabel="Save"
            variant="primary"
            onCancel={close}
            onAction={save}
            disabled={isPending || !name.trim()}
            cancelDisabled={isPending}
            error={<ErrorBubble>{error}</ErrorBubble>}
          />
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete these saved criteria?"
          message={
            <>
              <strong>{dialog.preset.name}</strong> will be gone. Nothing else changes — the criteria
              on screen stay as they are, and every lot already built from them is an ordinary offer
              that records its own copies.
            </>
          }
          actionLabel="Delete"
          isPending={isPending}
          error={<ErrorBubble>{error}</ErrorBubble>}
          onConfirm={() => remove(dialog.preset)}
          onClose={close}
        />
      )}
    </span>
  );
}

/** The quiet button a heading row carries — the detail screens' own card button, so the builder's
 *  headings and every detail card's read alike. */
const PRESET_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.25rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Applying a recipe over the criteria in force — re-exported so the panel does not import the pure
 *  module for one call and the reasoning stays next to the control that causes it. */
export { applyLotRecipe };
