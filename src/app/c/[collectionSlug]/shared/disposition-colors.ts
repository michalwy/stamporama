import type { TagColorTokens } from "@/lib/tag-colors";

/**
 * The colour each disposition is drawn in (#1646): *In collection* green, *For sale* blue, *For
 * trade* violet, painted from `--color-disposition-<token>` / `-soft` / `-border`, which
 * `globals.css` defines for both themes. The copy rows took these colours first; every other place a
 * disposition is shown or chosen reads them from here so the three cannot drift apart. The colour
 * sits beside the word, never instead of it.
 */
export type DispositionKey = "inCollection" | "forSale" | "forTrade";

export const DISPOSITION_TOKEN: Record<DispositionKey, "collection" | "sale" | "trade"> = {
  inCollection: "collection",
  forSale: "sale",
  forTrade: "trade",
};

export function isDispositionKey(key: string): key is DispositionKey {
  return Object.hasOwn(DISPOSITION_TOKEN, key);
}

/** The disposition's chip triple, in the shape `FilterChip`'s `tint` and the tag chips take. */
export function dispositionTint(key: DispositionKey): TagColorTokens {
  const token = DISPOSITION_TOKEN[key];
  return {
    color: `var(--color-disposition-${token})`,
    border: `var(--color-disposition-${token}-border)`,
    background: `var(--color-disposition-${token}-soft)`,
  };
}

/** A chip stating a disposition the copy carries — always in its colour. */
export function dispositionChipColors(key: DispositionKey): React.CSSProperties {
  const tint = dispositionTint(key);
  return { color: tint.color, borderColor: tint.border, background: tint.background };
}

/**
 * A disposition **picker** button: the chosen one takes its colour, an unchosen one stays neutral,
 * so what is picked is read at a glance and the three unpicked do not compete with it.
 */
export function dispositionToggleColors(key: DispositionKey, on: boolean): React.CSSProperties {
  if (on) return dispositionChipColors(key);
  return {
    color: "var(--color-text-secondary)",
    borderColor: "var(--color-border)",
    background: "var(--color-bg-page)",
  };
}
