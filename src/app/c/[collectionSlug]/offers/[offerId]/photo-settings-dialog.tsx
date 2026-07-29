"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { getCollageTemplatesAction } from "@/app/actions/collage-templates";
import type { CollageTemplateData } from "@/lib/collage-templates";
import {
  COLLAGE_LABEL_STEP,
  DEFAULT_COLLAGE_BACKGROUND,
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
  type OfferPhotoConfigInput,
  type PlatformPhotoLimits,
} from "@/lib/offer-photo-config";

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
  collageRows: string;
  collageColumns: string;
  collageGapPercent: string;
  collageBackground: string;
  collageLabelPercent: string;
}

const EMPTY_COLLAGE: CollageDraft = {
  collageRows: "",
  collageColumns: "",
  collageGapPercent: "",
  collageBackground: "",
  collageLabelPercent: "",
};

function toDraft(config: OfferPhotoConfigInput): CollageDraft {
  const c = config.collage;
  if (!c) return EMPTY_COLLAGE;
  return {
    collageRows: String(c.collageRows),
    collageColumns: String(c.collageColumns),
    collageGapPercent: String(c.collageGapPercent),
    collageBackground: c.collageBackground,
    collageLabelPercent: String(c.collageLabelPercent),
  };
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
  isPending,
  error,
  onClose,
  onSubmit,
}: PhotoSettingsDialogProps) {
  const [photoSides, setPhotoSides] = useState(config.photoSides);
  const [labelLeft, setLabelLeft] = useState(config.photoLabelLeftTemplate ?? "");
  const [labelRight, setLabelRight] = useState(config.photoLabelRightTemplate ?? "");
  const [collage, setCollage] = useState<CollageDraft>(() => toDraft(config));
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

  /** Copy a template's numbers onto the offer — the same seeding the platform does at creation. */
  function applyTemplate(templateId: string) {
    if (!templateId) {
      setCollage(EMPTY_COLLAGE);
      return;
    }
    const t = templates.find((row) => row.id === templateId);
    if (!t) return;
    setCollage({
      collageRows: String(t.rows),
      collageColumns: String(t.columns),
      collageGapPercent: String(t.gapPercent),
      collageBackground: t.background,
      collageLabelPercent: String(t.labelPercent),
    });
  }

  /** Any collage field filled in — what "Clear" acts on and what the save writes as a group. */
  const hasCollage = Object.values(collage).some((v) => v.trim());

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
              <input
                id="offer-photo-label-left"
                name="photoLabelLeftTemplate"
                type="text"
                value={labelLeft}
                onChange={(e) => setLabelLeft(e.target.value)}
                placeholder="{ref}"
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-photo-label-right">Tile label (right)</LabelWithError>
              <input
                id="offer-photo-label-right"
                name="photoLabelRightTemplate"
                type="text"
                value={labelRight}
                onChange={(e) => setLabelRight(e.target.value)}
                placeholder="{catalog}"
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>
          <span style={{ ...HINT, display: "block", margin: "-0.75rem 0 1.25rem" }}>
            Written under each stamp, one flush left and one flush right at the same size. A single
            one is centred; both blank leaves the tiles unlabelled.
          </span>

          <p style={SECTION_LABEL}>Collage</p>

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
                    {t.name} ({t.rows} × {t.columns})
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
            <NumberField
              id="offer-collage-rows"
              name="collageRows"
              label="Rows"
              value={collage.collageRows}
              min={MIN_COLLAGE_AXIS}
              max={MAX_COLLAGE_AXIS}
              isPending={isPending}
              onChange={(v) => set("collageRows", v)}
            />
            <NumberField
              id="offer-collage-columns"
              name="collageColumns"
              label="Columns"
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
            Rows × columns is a maximum, not a frame — fewer stamps make a smaller collage. Leave
            every collage field blank for no collage on this offer yet.
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
