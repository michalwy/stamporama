"use client";

import { TAG_COLORS, TAG_COLOR_LABELS, type TagColor } from "@/lib/tag-colors";
import { Tooltip } from "./tooltip";

// The colour field on a dictionary entry (#728) — a condition or a certificate status.
//
// **Native radios, one per hue, visually replaced by the swatch.** A colour is a choice from a
// closed list, which is what a radio group *is*: the browser gives it one tab stop with the arrow
// keys moving inside it, and the form submits `color` without a hidden input shadowing state that
// could drift from what is on screen. A row of eleven buttons would have been eleven tab stops in
// a dialog of three fields, which is exactly the slalom the `tabIndex={-1}` rule exists to prevent
// — except here the control is not auxiliary to anything, so it must stay reachable.
//
// **None is a swatch, not the absence of one.** No colour is a real answer: a collector who wants
// one condition to jump out wants the rest quiet, and a list where everything is coloured says no
// more than a list where nothing is. It leads the row because it is where an entry starts.

const SWATCH = 22;

const SWATCH_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: SWATCH,
  height: SWATCH,
  borderRadius: "0.375rem",
  cursor: "pointer",
  boxSizing: "border-box",
};

/** The tick drawn inside the chosen swatch. Weight and glyph rather than colour alone, for the
 * reason the completeness chip carries one: on a row of ten tints, a ring around one of them is
 * the difference a scanning eye misses. */
function Tick({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4L19 7"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Swatch({
  name,
  value,
  checked,
  label,
  disabled,
  onChange,
  style,
  tick,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  style: React.CSSProperties;
  tick: string;
}) {
  return (
    <Tooltip content={label}>
      <label style={{ display: "inline-flex" }}>
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(value)}
          aria-label={label}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            margin: 0,
            pointerEvents: "none",
          }}
        />
        <span
          style={{
            ...SWATCH_BASE,
            ...style,
            outline: checked ? "2px solid var(--color-text-primary)" : "none",
            outlineOffset: 2,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {checked && <Tick color={tick} />}
        </span>
      </label>
    </Tooltip>
  );
}

export function TagColorPicker({
  value,
  onChange,
  disabled,
  /** Form field name; the dictionary actions read `color`. */
  name = "color",
}: {
  value: TagColor | null;
  onChange: (value: TagColor | null) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
      <Swatch
        name={name}
        value=""
        checked={value === null}
        label="No colour"
        disabled={disabled}
        onChange={() => onChange(null)}
        tick="var(--color-text-secondary)"
        style={{
          background: "var(--color-bg-page)",
          border: "1px dashed var(--color-border-strong)",
        }}
      />
      {TAG_COLORS.map((hue) => (
        <Swatch
          key={hue}
          name={name}
          value={hue}
          checked={value === hue}
          label={TAG_COLOR_LABELS[hue]}
          disabled={disabled}
          onChange={(v) => onChange(v as TagColor)}
          tick={`var(--color-tag-${hue})`}
          style={{
            background: `var(--color-tag-${hue}-soft)`,
            border: `1px solid var(--color-tag-${hue}-border)`,
          }}
        />
      ))}
    </div>
  );
}
