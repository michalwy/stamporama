"use client";

import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  ANNOTATION_COLOURS,
  ANNOTATION_FONT_SIZES,
  ANNOTATION_THICKNESSES,
  type AnnotationStyle,
} from "@/lib/annotations";

/**
 * How marks are drawn (#1300): a colour, a line thickness (every mark but a note) and a font size (a
 * note and a ruler mark's figure). Each a few steps rather than a free value — see `annotations.ts`
 * for why.
 *
 * Beside the annotation layer rather than inside the tile viewer, for the same reason the layer is:
 * the comparison view can offer the same three settings over its pictures without a second set.
 *
 * What they act on is `target` (#1342): the marks drawn **next** — a mark keeps the style it was drawn
 * in — or one mark **selected** on purpose, when only the settings that show on it are offered.
 */
export function AnnotationStyleControls({
  style,
  onChange,
  target = "next",
  fields = { thickness: true, fontSize: true },
}: {
  style: AnnotationStyle;
  onChange: (next: AnnotationStyle) => void;
  target?: "next" | "selected";
  /** Which of the settings apply — for a selected note there is no line, for a ring no type. */
  fields?: { thickness: boolean; fontSize: boolean };
}) {
  const scope = target === "selected" ? "the selected mark only" : "the marks you draw next";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <Group label="Colour">
        {ANNOTATION_COLOURS.map((c) => (
          <Step
            key={c.id}
            hint={`${c.label} — ${scope}`}
            label={c.label}
            active={style.colour === c.id}
            onClick={() => onChange({ ...style, colour: c.id })}
          >
            <span
              style={{
                display: "block",
                width: "0.875rem",
                height: "0.875rem",
                borderRadius: "999px",
                background: c.colour,
                // The swatch's own halo, as the mark has one — white on a light panel reads as nothing.
                boxShadow: `0 0 0 1px ${c.halo}`,
              }}
            />
          </Step>
        ))}
      </Group>
      <Group label="Line">
        {ANNOTATION_THICKNESSES.map((t) => (
          <Step
            key={t}
            hint={fields.thickness ? `Lines ${t} px thick — ${scope}` : "A note has no line"}
            label={`${t} px`}
            active={style.thickness === t}
            disabled={!fields.thickness}
            onClick={() => onChange({ ...style, thickness: t })}
          >
            <span
              style={{
                display: "block",
                width: "1rem",
                height: t,
                borderRadius: t,
                background: "currentColor",
              }}
            />
          </Step>
        ))}
      </Group>
      <Group label="Text">
        {ANNOTATION_FONT_SIZES.map((size, i) => (
          <Step
            key={size}
            hint={fields.fontSize ? `Notes and ruler figures set at ${size} px — ${scope}` : "This mark has no text"}
            label={`${size} px`}
            active={style.fontSize === size}
            disabled={!fields.fontSize}
            onClick={() => onChange({ ...style, fontSize: size })}
          >
            <span style={{ fontSize: `${0.6875 + i * 0.125}rem`, fontWeight: 600, lineHeight: 1 }}>A</span>
          </Step>
        ))}
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
      <span style={{ color: "var(--color-text-muted)", marginRight: "0.125rem" }}>{label}</span>
      {children}
    </div>
  );
}

const STEP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "1.75rem",
  height: "1.75rem",
  padding: "0 0.25rem",
  borderRadius: "0.375rem",
  font: "inherit",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

function Step({
  hint,
  label,
  active,
  disabled = false,
  onClick,
  children,
}: {
  hint: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        // The focus stays in a note being typed (#1342): pressing a setting would otherwise blur the
        // field, which finishes the note before the setting could reach it.
        onMouseDown={(e) => e.preventDefault()}
        style={{
          ...STEP,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.4 : 1,
          border: `1px solid ${active ? "var(--color-action-primary)" : "var(--color-border-strong)"}`,
          boxShadow: active ? "inset 0 0 0 1px var(--color-action-primary)" : "none",
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}
