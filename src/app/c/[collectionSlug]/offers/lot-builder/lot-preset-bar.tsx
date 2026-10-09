"use client";

import { useState, useTransition } from "react";
import {
  applyLotRecipe,
  lotBuilderSearchParams,
  lotPlatformChoice,
  NO_LOT_PLATFORM,
  sameLotRecipe,
  toLotRecipe,
  type LotBuilderRequest,
  type LotPlatformChoice,
  type LotRecipe,
} from "@/lib/lot-builder-criteria";
import type { LotBuilderPresetData } from "@/lib/lot-builder-presets";
import { Icon } from "@/app/icons";
import {
  ConfirmDialog,
  DialogActions,
  DialogBody,
  DialogShell,
} from "@/app/dialog-shell";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useInvalidateOffers, useLotBuilderPresets } from "../use-offers-query";
import { NOTE } from "./lot-builder-chrome";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";

// Saved criteria for the bulk-lot builder (#773) — the control, on *The pick*'s heading row.
//
// **Why it exists.** The builder carries eleven controls. Stating them is most of the work of
// building a lot, and a collector who builds the same *kind* of lot repeatedly retypes all eleven
// and mistypes some of them.
//
// **Why it sits on The pick and not above the whole screen.** A preset holds the recipe and
// deliberately not the area (`LotRecipe`), so a control over everything would have promised it
// reached the area too. It is on **The pick** because that is where the recipe's own name belongs,
// and the copy beside it says what it reaches.
//
// **The platform rides with it** (#1688), and with it the listing type and the Facebook group. A
// preset saved before that states none, and applying it leaves all three as they are on screen; the
// three on screen at that moment are then what the preset is compared against, so changing the
// platform afterwards is an edit *Update* can keep. A preset naming a platform deleted since applies
// without it and says so, and one naming a group archived or deleted since leaves the group unchosen
// — the panel reports that one, since the group is only judged once its platform's groups are in.
//
// **Saving reads the address, not the controls.** The criteria live in the URL and the commit
// re-plans from it (#717); a preset saved from a second assembly of the same eleven fields would be
// a second place for them to disagree. So the action is handed `lotBuilderSearchParams(request)`
// and drops everything outside the recipe server-side, once.
//
// **Applying is whole, never a merge**, and it leaves the area and the subtree scope exactly as they
// stand — what makes one preset usable over Germany and then over Poland.

type Dialog = { kind: "none" } | { kind: "save" } | { kind: "delete"; preset: LotBuilderPresetData };

export function LotPresetBar({
  collectionId,
  request,
  platformIds,
  groupNotice,
  onApply,
  disabled,
}: {
  collectionId: string;
  request: LotBuilderRequest;
  /** The platforms a lot can be built for — a preset naming any other applies without one. */
  platformIds: string[];
  /** Why the group a preset named is not chosen, from the panel (#1688), or null. */
  groupNotice: string | null;
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
  // What a preset stating no platform is compared against: the platform, type and group on screen
  // when it was applied (#1688). Without it an older preset would read as *edited* the moment it was
  // applied, and changing the platform after it would not.
  const [platformBaseline, setPlatformBaseline] = useState<LotPlatformChoice>(NO_LOT_PLATFORM);
  // The platform a preset named is gone — said beside the select until a platform is chosen.
  const [platformGone, setPlatformGone] = useState(false);
  const sayPlatformGone = platformGone && request.criteria.platformId === platformBaseline.platformId;
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const current = presets?.find((p) => p.id === selectedId);
  const onScreen = toLotRecipe(request.criteria);
  const compared = current && {
    ...current.recipe,
    ...(current.recipe.platformId ? {} : platformBaseline),
  };
  const edited = !!compared && !sameLotRecipe(compared, onScreen);

  function apply(preset: LotBuilderPresetData | undefined) {
    setSelectedId(preset?.id ?? "");
    setPlatformGone(false);
    if (!preset) return;
    setPlatformBaseline(lotPlatformChoice(request.criteria));
    const gone = !!preset.recipe.platformId && !platformIds.includes(preset.recipe.platformId);
    setPlatformGone(gone);
    // Gone, the preset is applied as one stating no platform — what is on screen stays, and the
    // preset still reads as *edited*, since the screen is not what it says.
    onApply(gone ? { ...preset.recipe, ...NO_LOT_PLATFORM } : preset.recipe);
  }
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
        setPlatformGone(false);
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
      else {
        setPlatformGone(false);
        await invalidateAll(collectionId);
      }
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
            onChange={(e) => apply(presets.find((p) => p.id === e.currentTarget.value))}
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

      {/* A preset whose platform or group is gone loads without it and says so (#1688), leaving the
          choice to the collector rather than quietly putting the lot somewhere else. */}
      {current && (sayPlatformGone || groupNotice) && (
        <span style={{ ...NOTE, color: "var(--color-warning)" }}>
          {sayPlatformGone ? PLATFORM_GONE : groupNotice}
        </span>
      )}

      {current && edited && (
        <Tooltip content={`Overwrite "${current.name}" with what is on screen`}>
          <button type="button" onClick={update} disabled={busy} style={PRESET_BTN}>
            <Icon name="check" size="sm" /> Update
          </button>
        </Tooltip>
      )}

      <Tooltip content="Keep these criteria under a name — the platform with its listing type and group, the years, conditions, formats, ceilings, targets, preferences and wording, but not the area">
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
            <TextInput
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
              Keeps the platform with its listing type and, on Facebook, its group; the years, the
              conditions and formats, the per-copy ceiling, both targets, the three preferences and
              the wording. <strong>Not</strong> the area — that is what you change between two lots
              of the same kind, so the same saved criteria work over one area today and another
              tomorrow.
            </p>
          </DialogBody>
          <DialogActions
            actionLabel="Save"
            variant="primary"
            onCancel={close}
            onAction={save}
            disabled={isPending || !name.trim()}
            cancelDisabled={isPending}
            error={error}
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
          error={error}
          onConfirm={() => remove(dialog.preset)}
          onClose={close}
        />
      )}
    </span>
  );
}

const PLATFORM_GONE =
  "The platform these criteria were saved for no longer exists — choose one, then Update.";

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
