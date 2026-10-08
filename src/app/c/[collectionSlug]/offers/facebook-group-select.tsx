"use client";

import type { FacebookGroupChoice } from "@/lib/facebook-auctions";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

/**
 * The Facebook group picker (#1544, #1663): the offer form's and every shortcut's that creates an offer,
 * so a group reads the same wherever an auction is made. Each place styles and labels the control the
 * way its own fields are; what is shared besides the options is the width rule (#1669) — the select is
 * only as wide as its longest name needs, never wider than the field it sits in, with a name that does
 * not fit ellipsised and shown whole in the hint.
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
  wrapperStyle,
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
  /** Layout for the hint's wrapper, which stands between the select and its parent — a place whose
   *  select fills the field hands it `display: "flex"` here. */
  wrapperStyle?: React.CSSProperties;
}) {
  const chosen = groups.find((g) => g.id === value);
  return (
    <Tooltip content={chosen?.name} align="start" style={{ maxWidth: "100%", minWidth: 0, ...wrapperStyle }}>
      <select
        id={id}
        name={name}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        style={{
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          ...style,
        }}
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
    </Tooltip>
  );
}
