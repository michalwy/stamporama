// Reserved photo-slot roles and their shared visual identity (#112, #137). Front/back are the
// copy slots; main is the stamp slot. The colours are theme-aware disposition/accent tokens.
// Both the photo editor and the read-only strip read this map so their slot borders, badges,
// and labels stay in lockstep — change a colour here and both surfaces follow.

export type SlotRole = "front" | "back" | "main";

export const SLOT_ROLE_META: Record<
  SlotRole,
  { short: string; title: string; color: string; soft: string }
> = {
  front: {
    short: "F",
    title: "Mark as front",
    color: "var(--color-disposition-sale)",
    soft: "var(--color-disposition-sale-soft)",
  },
  back: {
    short: "B",
    title: "Mark as back",
    color: "var(--color-disposition-trade)",
    soft: "var(--color-disposition-trade-soft)",
  },
  main: {
    short: "★",
    title: "Mark as main",
    color: "var(--color-accent)",
    soft: "var(--color-accent-soft)",
  },
};

export function isSlotRole(role: string | null | undefined): role is SlotRole {
  return role === "front" || role === "back" || role === "main";
}
