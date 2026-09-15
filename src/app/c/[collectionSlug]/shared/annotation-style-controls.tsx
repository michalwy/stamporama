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
 * How marks are drawn (#1300): one colour for every mark, text included; one thickness for every mark
 * but text; one font size for what is written on the picture. Each a few steps rather than a free
 * value — see `annotations.ts` for why.
 *
 * Beside the annotation layer rather than inside the tile viewer, for the same reason the layer is:
 * the comparison view can offer the same three settings over its pictures without a second set.
 * Changing one restyles every mark already drawn, because a mark carries no style of its own.
 */
export function AnnotationStyleControls({
  style,
  onChange,
}: {
  style: AnnotationStyle;
  onChange: (next: AnnotationStyle) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <Group label="Colour">
        {ANNOTATION_COLOURS.map((c) => (
          <Step
            key={c.id}
            hint={`${c.label} — every mark and every note`}
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
            hint={`Lines ${t} px thick — every mark but notes`}
            label={`${t} px`}
            active={style.thickness === t}
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
            hint={`Notes and ruler figures set at ${size} px`}
            label={`${size} px`}
            active={style.fontSize === size}
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
  onClick,
  children,
}: {
  hint: string;
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        style={{
          ...STEP,
          border: `1px solid ${active ? "var(--color-action-primary)" : "var(--color-border-strong)"}`,
          boxShadow: active ? "inset 0 0 0 1px var(--color-action-primary)" : "none",
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}
