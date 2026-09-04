"use client";

import { statedStampAttributes, type StampAttributeLabels } from "@/lib/stamp-attribute-kinds";
import { Tooltip } from "./tooltip";

// A stamp's catalogue attributes (#71/#72) wherever stamps are listed (#737): the flat Stamps list
// and the Issues tree. The point is to tell `240a` from `240b` at a glance, without opening either.
//
// **One muted line, not four columns and not six chips.** #737 rules columns out for the tree — a
// tree row is already dense — and both rows carry a chip line already full of catalog numbers, a
// Colnect id, a subtype, a copy count, a want marker and a price. So the attributes get a line of
// their own under that one, in the same muted register as the row's area and date, values separated
// by `·` in the order a catalogue prints them.
//
// **Only what the stamp states.** A stamp with no attributes renders nothing at all rather than a
// row of em dashes — empty is the normal case (#71), and a list is not the place to be told six
// times that nothing was recorded. Which attribute a value belongs to is a hover away, because the
// values themselves are self-describing enough on a row (`10 gr`, `Carmine`) and labelling all six
// inline would double the line's length to say what the reader already knows.

export function StampAttributesLine({
  attributes,
  /** Slightly larger on the flat stamp list, which sizes its row text up — mirrors `SubtypeChip`. */
  size = "small",
}: {
  attributes: StampAttributeLabels | null | undefined;
  size?: "small" | "medium";
}) {
  const stated = statedStampAttributes(attributes);
  if (stated.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        flexWrap: "wrap",
        marginTop: size === "medium" ? "0.35rem" : "0.25rem",
        fontSize: size === "medium" ? "0.75rem" : "0.6875rem",
        color: "var(--color-text-muted)",
      }}
    >
      {stated.map(({ key, label, value }, i) => (
        <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <Tooltip content={`${label}: ${value}`}>
            <span>{value}</span>
          </Tooltip>
        </span>
      ))}
    </div>
  );
}
