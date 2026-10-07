"use client";

import type { FacebookGroupChoice } from "@/lib/facebook-auctions";

/**
 * The Facebook group picker (#1544, #1663): the offer form's and every shortcut's that creates an offer,
 * so a group reads the same wherever an auction is made. Only the options are shared — each place
 * styles and labels the control the way its own fields are.
 */
export function FacebookGroupSelect({
  groups,
  value,
  onChange,
  id,
  name,
  ariaLabel,
  disabled,
  required,
  style,
}: {
  groups: readonly FacebookGroupChoice[];
  value: string;
  onChange: (groupId: string) => void;
  id?: string;
  name?: string;
  ariaLabel?: string;
  disabled?: boolean;
  required?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <select
      id={id}
      name={name}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required={required}
      style={style}
    >
      <option value="">
        {groups.length === 0 ? "No groups yet — add one in Settings → Facebook" : "Choose a group…"}
      </option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.archived ? `${g.name} (archived)` : g.name}
        </option>
      ))}
    </select>
  );
}
