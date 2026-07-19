"use client";

import { Tooltip } from "./tooltip";

/**
 * Small segmented single-choice control: a labelled row of joined buttons where
 * exactly one option is active. Shared by the price-details view and the stamp
 * form's tri-state controls. An option's `title` shows as our hover Tooltip
 * (used for icon-only buttons) and doubles as the button's accessible label.
 */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
  disabled?: boolean;
}) {
  const RADIUS = "0.375rem";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 500 }}>{label}</span>
      <div
        style={{
          display: "inline-flex",
          border: "1px solid var(--color-border-strong)",
          borderRadius: RADIUS,
        }}
      >
        {options.map((o, i) => {
          const active = o.value === value;
          const isFirst = i === 0;
          const isLast = i === options.length - 1;
          const button = (
            <button
              type="button"
              onClick={() => onChange(o.value)}
              disabled={disabled}
              aria-label={o.title ?? o.label}
              aria-pressed={active}
              style={{
                padding: "0.35rem 0.75rem",
                border: "none",
                borderRadius: `${isFirst ? RADIUS : "0"} ${isLast ? RADIUS : "0"} ${isLast ? RADIUS : "0"} ${isFirst ? RADIUS : "0"}`,
                cursor: disabled ? "default" : "pointer",
                fontSize: "0.8125rem",
                fontWeight: active ? 600 : 500,
                background: active ? "var(--color-action-primary)" : "var(--color-bg-page)",
                color: active ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {o.label}
            </button>
          );
          return o.title ? (
            <Tooltip key={o.value} content={o.title}>
              {button}
            </Tooltip>
          ) : (
            <span key={o.value} style={{ display: "inline-flex" }}>
              {button}
            </span>
          );
        })}
      </div>
    </div>
  );
}
