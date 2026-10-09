"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { getCollageTemplatesAction } from "@/app/actions/collage-templates";
import type { CollageTemplateData } from "@/lib/collage-templates";
import {
  COLLAGE_GRID_MODES,
  COLLAGE_GRID_MODE_LABELS,
  COLLAGE_LABEL_STEP,
  DEFAULT_COLLAGE_BACKGROUND,
  DEFAULT_COLLAGE_GRID_MODE,
  collageAxisLabels,
  normalizeCollageGridMode,
  MAX_COLLAGE_AXIS,
  MAX_COLLAGE_LABEL_PERCENT,
  MAX_COLLAGE_PERCENT,
  MIN_COLLAGE_AXIS,
  MIN_COLLAGE_LABEL_PERCENT,
  MIN_COLLAGE_PERCENT,
} from "@/lib/collage-template-rules";
import {
  PHOTO_SIDES,
  PHOTO_SIDES_LABELS,
  applyCollagePairing,
  type OfferPhotoConfigInput,
  type PlatformPhotoLimits,
} from "@/lib/offer-photo-config";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const HINT: React.CSSProperties = {
  display: "block",
  marginTop: "0.25rem",
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  margin: "0 0 0.5rem",
};

/** The collage fields as the form holds them — strings, so "not set yet" is simply blank. */
interface CollageDraft {
  /** Always set — a toggle has no blank state — which is why it is not one of the fields that decide
   * whether the offer carries a collage at all (#413). */
  collageGridMode: string;
  collageRows: string;
  collageColumns: string;
  collageGapPercent: string;
  collageBackground: string;
  collageLabelPercent: string;
}

const EMPTY_COLLAGE: CollageDraft = {
  collageGridMode: DEFAULT_COLLAGE_GRID_MODE,
  collageRows: "",
  collageColumns: "",
  collageGapPercent: "",
  collageBackground: "",
  collageLabelPercent: "",
};

function toDraft(c: OfferPhotoConfigInput["collage"]): CollageDraft {
  if (!c) return EMPTY_COLLAGE;
  return {
    collageGridMode: c.collageGridMode,
    collageRows: String(c.collageRows),
    collageColumns: String(c.collageColumns),
    collageGapPercent: String(c.collageGapPercent),
    collageBackground: c.collageBackground,
    collageLabelPercent: String(c.collageLabelPercent),
  };
}

/** A template's numbers as the form holds them. */
function templateDraft(t: CollageTemplateData): CollageDraft {
  return {
    collageGridMode: normalizeCollageGridMode(t.gridMode),
    collageRows: String(t.rows),
    collageColumns: String(t.columns),
    collageGapPercent: String(t.gapPercent),
    collageBackground: t.background,
    collageLabelPercent: String(t.labelPercent),
  };
}

/** A grid in a word: `3 × 4`, or `auto, up to 3 × 4`. */
function gridText(gridMode: string, rows: string | number, columns: string | number): string {
  return normalizeCollageGridMode(gridMode) === "auto"
    ? `auto, up to ${rows} × ${columns}`
    : `${rows} × ${columns}`;
}

/** How a platform limit reads when it states none. */
function limitText(value: number | null, unit: string): string {
  return value == null ? "no limit" : `${value}${unit}`;
}

function NumberField({
  id,
  name,
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  isPending,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  min: number;
  max: number;
  /** Whole numbers everywhere except the label strip, which needs tenths (#337). */
  step?: number;
  hint?: string;
  isPending: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ flex: 1 }}>
      <LabelWithError htmlFor={id}>{label}</LabelWithError>
      <input
        id={id}
        name={name}
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={isPending}
        style={INPUT_STYLE}
      />
      {hint && <span style={HINT}>{hint}</span>}
    </div>
  );
}

export interface PhotoSettingsDialogProps {
  collectionId: string;
  /** The offer's current configuration (#308), seeded at creation from its platform. */
  config: OfferPhotoConfigInput;
  /** The platform's live limits, shown read-only — they belong to the platform, not the offer. */
  limits: PlatformPhotoLimits;
  platformName: string;
  /** Whether the platform needs symbols covered (#1665) — what *follow the platform* means here. */
  platformCoverSymbols: boolean;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/**
 * This listing's own photo configuration (#308): which scan sides to include, the label written
 * under each stamp (#312), and the collage numbers — copied from a collage template (#307) and then
 * editable here, because a template is a starting point rather than a live reference. Picking a
 * template overwrites the numbers below it; clearing them leaves the offer with no collage to render
 * until one is chosen. The platform's own limits sit at the top, read-only.
 */
export function PhotoSettingsDialog({
  collectionId,
  config,
  limits,
  platformName,
  platformCoverSymbols,
  isPending,
  error,
  onClose,
  onSubmit,
}: PhotoSettingsDialogProps) {
  const [photoSides, setPhotoSides] = useState(config.photoSides);
  const [labelLeft, setLabelLeft] = useState(config.photoLabelLeftTemplate ?? "");
  const [labelRight, setLabelRight] = useState(config.photoLabelRightTemplate ?? "");
  const [preferSingles, setPreferSingles] = useState(config.preferSingles);
  const [collage, setCollage] = useState<CollageDraft>(() => toDraft(config.collage));
  // #1673: series on photos of their own, laid out with a template of their own.
  const [groupByChecklist, setGroupByChecklist] = useState(config.groupByChecklist ?? false);
  const [groupCollage, setGroupCollage] = useState<CollageDraft>(() =>
    toDraft(config.groupCollage ?? null)
  );
  const [templates, setTemplates] = useState<CollageTemplateData[]>([]);
  // Regenerate on save (#328), on by default — see the note by the footer checkbox.
  const [regenerate, setRegenerate] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCollageTemplatesAction(collectionId)
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  /** Copy a template's numbers onto the offer. The pairing flag (#694) reaches the sides select
   * above rather than the numbers below, because that is where the offer says it:
   * `applyCollagePairing` moves between the two both-sides answers and leaves a front-only or
   * back-only listing alone.
   *
   * This is the one place the move runs **both** ways, and it differs from the platform's seeding
   * on purpose (#878): picking a template here is a deliberate act, so an unpaired one unpairs the
   * offer. Seeding at creation upgrades only — nobody has picked anything then, and a platform
   * without a paired default template has said nothing about arrangement. */
  function applyTemplate(templateId: string) {
    if (!templateId) {
      setCollage(EMPTY_COLLAGE);
      return;
    }
    const t = templates.find((row) => row.id === templateId);
    if (!t) return;
    setPhotoSides((sides) => applyCollagePairing(sides, t.pairSides));
    setCollage(templateDraft(t));
  }

  /** Copy a template's numbers onto the series photos (#1673). Its pairing is not read: which sides
   * are photographed is one answer for the whole offer, set by the template above. */
  function applyGroupTemplate(templateId: string) {
    const t = templates.find((row) => row.id === templateId);
    if (t) setGroupCollage(templateDraft(t));
  }

  const hasGroupCollage = groupCollage.collageRows.trim() !== "";

  /** Any collage field filled in — what "Clear" acts on and what the save writes as a group. */
  const hasCollage = Object.entries(collage).some(
    ([field, value]) => field !== "collageGridMode" && value.trim()
  );

  const axisLabels = collageAxisLabels(normalizeCollageGridMode(collage.collageGridMode));

  function set(field: keyof CollageDraft, value: string) {
    setCollage((c) => ({ ...c, [field]: value }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  return (
    <DialogShell title="Photo settings" onClose={onClose} maxWidth="40rem" minHeight="20rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {/* The platform's own limits, stated not editable here: they describe what the platform
              accepts, are read when photos are generated, and are changed on the platform itself. */}
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0 0 1.25rem" }}>
            {platformName} accepts {limitText(limits.maxPhotos, "")} photo
            {limits.maxPhotos === 1 ? "" : "s"}, longest edge{" "}
            {limitText(limits.maxPhotoEdge, " px")}, up to{" "}
            {limitText(limits.maxPhotoFileSizeMib, " MiB")} each. Change those on the platform.
          </p>

          {/* Covering symbols (#1665): the platform's rule unless this listing says otherwise. Read
              live, so *follow* keeps tracking the platform. */}
          <div style={{ marginBottom: "1.25rem" }}>
            <LabelWithError htmlFor="offer-cover-symbols">Cover symbols</LabelWithError>
            <select
              id="offer-cover-symbols"
              name="coverSymbols"
              defaultValue={config.coverSymbols == null ? "" : config.coverSymbols ? "on" : "off"}
              disabled={isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer", maxWidth: "20rem" }}
            >
              <option value="">
                As {platformName} ({platformCoverSymbols ? "covered" : "not covered"})
              </option>
              <option value="on">Covered on this offer</option>
              <option value="off">Not covered on this offer</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-photo-sides">Sides to photograph</LabelWithError>
              <select
                id="offer-photo-sides"
                name="photoSides"
                value={photoSides}
                onChange={(e) => setPhotoSides(e.target.value as typeof photoSides)}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {PHOTO_SIDES.map((side) => (
                  <option key={side} value={side}>
                    {PHOTO_SIDES_LABELS[side]}
                  </option>
                ))}
              </select>
            </div>
            {/* Two annotations on one strip (#312): an identifier on the left, something
                descriptive on the right, drawn at one shared size. */}
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-photo-label-left">Tile label (left)</LabelWithError>
              <TextInput
                id="offer-photo-label-left"
                name="photoLabelLeftTemplate"
                value={labelLeft}
                onChange={(e) => setLabelLeft(e.target.value)}
                placeholder="{ref}"
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-photo-label-right">Tile label (right)</LabelWithError>
              <TextInput
                id="offer-photo-label-right"
                name="photoLabelRightTemplate"
                value={labelRight}
                onChange={(e) => setLabelRight(e.target.value)}
                placeholder="{catalog}"
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>
          <span
            style={{
              ...HINT,
              display: "block",
              margin: photoSides === "paired" ? "-0.75rem 0 0.375rem" : "-0.75rem 0 1.25rem",
            }}
          >
            Written under each stamp, one flush left and one flush right at the same size. A single
            one is centred; both blank leaves the tiles unlabelled.
          </span>
          {/* Said here rather than in the option's name (#694): what pairing changes is the picture,
              and the one thing worth knowing before generating is that a half-scanned copy still
              appears — it is not the all-or-nothing rule the other modes follow. */}
          {photoSides === "paired" && (
            <span style={{ ...HINT, display: "block", margin: "0 0 1.25rem" }}>
              Paired puts each stamp&rsquo;s two scans side by side in one cell under one label, so a
              group is a single image instead of a page of fronts and a page of backs. A copy scanned
              on one side only takes a narrower cell in the same collage.
            </span>
          )}

          <p style={SECTION_LABEL}>Collage</p>

          {/* When a collage is made at all (#521). A collage is how more stamps fit than the
              platform has slots for, so with slots to spare the stamps go up one per photo and only
              the tail is grouped — and the first photo, the listing's thumbnail, is a single stamp
              whenever this offer has one to show. Sets of several stamps are one collage either
              way: a set is one thing being sold. */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4375rem",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
              cursor: isPending ? "default" : "pointer",
              marginBottom: "0.25rem",
            }}
          >
            <input
              type="checkbox"
              name="preferSingles"
              checked={preferSingles}
              onChange={(e) => setPreferSingles(e.target.checked)}
              disabled={isPending}
              style={{ cursor: isPending ? "default" : "pointer" }}
            />
            Single photos while {platformName}&rsquo;s limit allows
          </label>
          <span style={{ ...HINT, display: "block", margin: "0 0 1.25rem" }}>
            {limits.maxPhotos == null
              ? `${platformName} states no photo limit, so every single-stamp set gets its own photo.`
              : `Single-stamp sets go up one per photo while the ${limits.maxPhotos} allowed last; whatever is left over is collaged. Off, they are always collaged.`}
          </span>

          {/* Series on photos of their own (#1673): a set's copies grouped by checklist, each group
              on its own images in the checklist's order, the rest after them. The rules — two
              copies make a group, a copy on several checklists joins the largest — are in the user
              guide; the tooltip says the one thing worth knowing before ticking it. */}
          <Tooltip content="Every series this offer's set holds two or more stamps of gets photos of its own, in the series' order; the other stamps follow on photos of their own.">
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4375rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-secondary)",
                cursor: isPending ? "default" : "pointer",
                marginBottom: "0.25rem",
                width: "fit-content",
              }}
            >
              <input
                type="checkbox"
                name="groupByChecklist"
                checked={groupByChecklist}
                onChange={(e) => setGroupByChecklist(e.target.checked)}
                disabled={isPending}
                style={{ cursor: isPending ? "default" : "pointer" }}
              />
              Group series on their own photos
            </label>
          </Tooltip>
          {/* The group template's numbers travel in hidden fields whether or not the box is
              ticked, so turning grouping off and on again keeps the template. */}
          <input type="hidden" name="groupCollageGridMode" value={groupCollage.collageGridMode} />
          <input type="hidden" name="groupCollageRows" value={groupCollage.collageRows} />
          <input type="hidden" name="groupCollageColumns" value={groupCollage.collageColumns} />
          <input type="hidden" name="groupCollageGapPercent" value={groupCollage.collageGapPercent} />
          <input type="hidden" name="groupCollageBackground" value={groupCollage.collageBackground} />
          <input
            type="hidden"
            name="groupCollageLabelPercent"
            value={groupCollage.collageLabelPercent}
          />
          {groupByChecklist ? (
            <div style={{ margin: "0.5rem 0 1.25rem" }}>
              <LabelWithError htmlFor="offer-group-collage-template">Series template</LabelWithError>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {/* One-shot, like the picker below: it copies the numbers and falls back. */}
                <select
                  id="offer-group-collage-template"
                  value=""
                  onChange={(e) => applyGroupTemplate(e.target.value)}
                  disabled={isPending || templates.length === 0}
                  style={{ ...INPUT_STYLE, cursor: "pointer" }}
                >
                  <option value="">
                    {hasGroupCollage
                      ? `${gridText(
                          groupCollage.collageGridMode,
                          groupCollage.collageRows,
                          groupCollage.collageColumns
                        )} — pick another template`
                      : "Same as the collage below — pick a template"}
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({gridText(t.gridMode, t.rows, t.columns)})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setGroupCollage(EMPTY_COLLAGE)}
                  disabled={isPending || !hasGroupCollage}
                  style={{
                    ...INPUT_STYLE,
                    width: "auto",
                    whiteSpace: "nowrap",
                    cursor: hasGroupCollage ? "pointer" : "not-allowed",
                    color: hasGroupCollage
                      ? "var(--color-text-primary)"
                      : "var(--color-text-muted)",
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: "1.25rem" }} />
          )}

          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="offer-collage-template">Copy from template</LabelWithError>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {/* A one-shot picker, not a stored reference: choosing a template copies its numbers
                  into the fields below and the select falls back to its placeholder. */}
              <select
                id="offer-collage-template"
                value=""
                onChange={(e) => applyTemplate(e.target.value)}
                disabled={isPending || templates.length === 0}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">
                  {templates.length === 0 ? "— no templates defined yet —" : "— pick a template —"}
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({gridText(t.gridMode, t.rows, t.columns)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCollage(EMPTY_COLLAGE)}
                disabled={isPending || !hasCollage}
                style={{
                  ...INPUT_STYLE,
                  width: "auto",
                  whiteSpace: "nowrap",
                  cursor: hasCollage ? "pointer" : "not-allowed",
                  color: hasCollage ? "var(--color-text-primary)" : "var(--color-text-muted)",
                }}
              >
                Clear
              </button>
            </div>
            <span style={HINT}>
              Copies the template&apos;s numbers into the fields below, where you can adjust them for
              this listing. Editing the template later leaves this offer alone.
            </span>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-collage-grid-mode">Grid</LabelWithError>
              <select
                id="offer-collage-grid-mode"
                name="collageGridMode"
                value={collage.collageGridMode}
                onChange={(e) => set("collageGridMode", normalizeCollageGridMode(e.target.value))}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {COLLAGE_GRID_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {COLLAGE_GRID_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
            <NumberField
              id="offer-collage-rows"
              name="collageRows"
              label={axisLabels.rows}
              value={collage.collageRows}
              min={MIN_COLLAGE_AXIS}
              max={MAX_COLLAGE_AXIS}
              isPending={isPending}
              onChange={(v) => set("collageRows", v)}
            />
            <NumberField
              id="offer-collage-columns"
              name="collageColumns"
              label={axisLabels.columns}
              value={collage.collageColumns}
              min={MIN_COLLAGE_AXIS}
              max={MAX_COLLAGE_AXIS}
              isPending={isPending}
              onChange={(v) => set("collageColumns", v)}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <NumberField
              id="offer-collage-gap"
              name="collageGapPercent"
              label="Gap (%)"
              value={collage.collageGapPercent}
              min={MIN_COLLAGE_PERCENT}
              max={MAX_COLLAGE_PERCENT}
              hint="Of the stamp."
              isPending={isPending}
              onChange={(v) => set("collageGapPercent", v)}
            />
            <NumberField
              id="offer-collage-strip"
              name="collageLabelPercent"
              label="Label strip (%)"
              value={collage.collageLabelPercent}
              min={MIN_COLLAGE_LABEL_PERCENT}
              max={MAX_COLLAGE_LABEL_PERCENT}
              step={COLLAGE_LABEL_STEP}
              hint="Of the image, and the label size. Tenths allowed; 0 for none."
              isPending={isPending}
              onChange={(v) => set("collageLabelPercent", v)}
            />
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-collage-background">Background</LabelWithError>
              {/* The colour travels in a hidden field so an untouched picker stays *blank*: a colour
                  input always reports a value, which would make "no collage yet" impossible to save. */}
              <input type="hidden" name="collageBackground" value={collage.collageBackground} />
              <input
                id="offer-collage-background"
                type="color"
                value={collage.collageBackground || DEFAULT_COLLAGE_BACKGROUND}
                onChange={(e) => set("collageBackground", e.target.value)}
                disabled={isPending}
                style={{ ...INPUT_STYLE, width: "5rem", padding: "0.25rem" }}
              />
            </div>
          </div>

          <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.75rem 0 0" }}>
            {collage.collageGridMode === "auto"
              ? "The two numbers are limits only — each image is arranged from the stamps it actually holds, so a listing of four and one of nine both come out evenly."
              : "Every row is filled to the number of columns, and the last row is as short as it needs to be."}{" "}
            Their product is how many stamps go on one image either way, and it is a maximum rather
            than a frame — fewer stamps make a smaller collage. Leave the numbers blank for no collage
            on this offer yet.
          </p>
        </DialogBody>

        {/* Saving these settings puts the stored images out of date (#311), so the regeneration is
            offered where the save is rather than as a second trip to the card (#328). Checked by
            default: the settings exist to change what the images look like, and photos that do not
            match the settings that produced them are the exception, not the norm. Unchecking keeps
            the old files exactly as they are — they may already be live on the platform (#312). */}
        <DialogActions
          actionLabel={isPending ? "Saving…" : regenerate ? "Save & regenerate" : "Save settings"}
          onCancel={onClose}
          disabled={isPending}
          error={error}
          leading={
            <Tooltip content="Render this offer's images again once the settings are saved, replacing the stored ones">
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4375rem",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-secondary)",
                  cursor: isPending ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name="regeneratePhotos"
                  checked={regenerate}
                  onChange={(e) => setRegenerate(e.target.checked)}
                  disabled={isPending}
                  style={{ cursor: isPending ? "default" : "pointer" }}
                />
                Regenerate photos after saving
              </label>
            </Tooltip>
          }
        />
      </form>
    </DialogShell>
  );
}
