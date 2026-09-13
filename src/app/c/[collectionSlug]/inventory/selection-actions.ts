import type { IconName } from "@/app/icons";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

/**
 * One thing the Copies list's selection can be told to do (#991) — **the one list both of its
 * surfaces are drawn from**.
 *
 * The selection bar draws each entry as a button; the gutter menu on a ticked row draws the same
 * entry as a menu item. There is no second list to keep in step: a new bulk action is one more
 * entry in {@link buildSelectionActions}, and it is on the bar and in the menu from that edit —
 * in every grouped view too, since their member rows go through the same list component. A design
 * that kept two lists aligned by diligence was the thing #991 ruled out, for the reason #982 is
 * open about.
 *
 * The two labels are both required because the two surfaces say different things. The bar sits
 * under its own headline, *5 copies selected*, so a button needs no number. The menu opens on
 * **one** row and acts on **others** — a `⋮`-shaped control doing that is a real ambiguity — so
 * every entry names how many copies it reaches.
 */
export interface SelectionAction {
  key: string;
  /** The button's text on the bar. */
  barLabel: string;
  /** The menu entry's text, which always names the count. */
  menuLabel: string;
  /** Absent on the bar's inline link, which is prose beside the collision warning. */
  icon?: IconName;
  /** What the bar's hover says. */
  description: string;
  /**
   * The menu entry's second line. The collision warning rides here on the listing entries (#513):
   * it is a statement, and the statement stays on the bar — the menu only repeats it where it
   * applies, on the entries that would create the duplicate.
   */
  hint?: string;
  /**
   * How the bar draws it. `link` sits inline beside the collision warning; the rest are the button
   * group at the bar's right end, in their existing shapes (#497, #660).
   */
  tone: "link" | "neutral" | "outline" | "filled";
  /** Tinted amber on the bar while the selection collides with a live offer (#660). */
  colliding?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type NewOfferPackaging = "one-set" | "per-copy";

export interface SelectionActionInput {
  /** The ticked copies in view (#1021) — what the non-listing actions act on. */
  inView: number;
  /** Of those, the ones an offer can be made of — for sale, in hand, still held (#682). */
  listable: number;
  /** The live offer this selection already duplicates on the platform in scope (#513, #732). */
  collision: { offerRef: string; offerLabel: string; platformName: string } | null;
  /** The platform the list is working through (#506), with whether the whole selection is already
   * set aside from it. */
  exclusion: { platformName: string; excluded: boolean } | null;
  /** Set while quick offer mode is armed (#537). */
  quickOffer: { platformName: string; stateLabel: string } | null;
  /** A write is under way; the one action that fires one outright waits for it. */
  isPending: boolean;
  on: {
    bulkEdit: () => void;
    setExclusion: (excluded: boolean) => void;
    newOffer: (packaging: NewOfferPackaging) => void;
    addToOffer: () => void;
    addToCollisionOffer: () => void;
  };
}

function copies(n: number): string {
  return `${n} cop${n === 1 ? "y" : "ies"}`;
}

/** The bulk bar's new-offer shortcuts (#497), for a selection of `count` copies. One copy has no
 * packaging to decide, so it gets a single entry; several get one per composition. */
function newOfferShortcuts(
  count: number
): { packaging: NewOfferPackaging; barLabel: string; menuLabel: string; description: string }[] {
  if (count === 1) {
    return [
      {
        packaging: "one-set",
        barLabel: "New offer",
        menuLabel: "New offer · 1 copy",
        description: "Create a new offer from this copy, skipping the picker.",
      },
    ];
  }
  return [
    {
      packaging: "one-set",
      barLabel: "New offer · one set",
      menuLabel: `New offer · one set of ${count}`,
      description:
        "Create a new offer holding all of them as one set — a series or a lot sold together.",
    },
    {
      packaging: "per-copy",
      barLabel: `New offer · ${count} sets`,
      menuLabel: `New offer · ${count} sets`,
      description:
        "Create a new offer with each copy as its own single-copy set — a quantity of interchangeable singles.",
    },
  ];
}

/**
 * Everything the selection can be told to do right now, in the order the bar reads left to right.
 *
 * Empty while no ticked copy is in view: nothing here could honestly be offered over a selection
 * the collector cannot see (#1021), so neither surface offers anything.
 */
export function buildSelectionActions(input: SelectionActionInput): SelectionAction[] {
  const { inView, listable, collision, exclusion, quickOffer, isPending, on } = input;
  if (inView === 0) return [];

  const actions: SelectionAction[] = [];
  const collisionHint = collision
    ? `Already offered on ${collision.platformName} in this condition.`
    : undefined;

  if (collision && listable > 0) {
    actions.push({
      key: "add-to-collision-offer",
      barLabel: `Add to ${collision.offerRef} instead`,
      menuLabel: `Add ${listable} to ${collision.offerRef} instead`,
      icon: "addToOffer",
      description: `Add the selection to ${collision.offerRef} ${collision.offerLabel} instead of making a second listing of the same thing.`,
      hint: collisionHint,
      tone: "link",
      onSelect: on.addToCollisionOffer,
    });
  }

  // Where these copies are kept, what they are kept for (#682) and what they are (#723) — one
  // dialog, and the only action here that reaches the *whole* selection in view.
  actions.push({
    key: "bulk-edit",
    barLabel: "Bulk edit…",
    menuLabel: `Bulk edit ${copies(inView)}…`,
    icon: "edit",
    description:
      "Move the selected copies to a storage location, turn any of their disposition flags on or off, restate their condition, certificate or format, and add or remove your own tags — all in one pass.",
    tone: "neutral",
    onSelect: on.bulkEdit,
  });

  // Clearing the worklist in one go (#506). Only while a platform is in scope: the decision names one.
  if (exclusion) {
    const { platformName, excluded } = exclusion;
    actions.push({
      key: "platform-exclusion",
      barLabel: excluded ? `List on ${platformName} again` : `Never list on ${platformName}`,
      menuLabel: excluded
        ? `List ${inView} on ${platformName} again`
        : `Never list ${inView} on ${platformName}`,
      icon: excluded ? "check" : "excluded",
      description: excluded
        ? `Bring these copies back into the "not offered on ${platformName}" worklist.`
        : `Keep these copies out of the "not offered on ${platformName}" worklist for good. Nothing about the copies themselves changes.`,
      tone: "neutral",
      disabled: isPending,
      onSelect: () => on.setExclusion(!excluded),
    });
  }

  // The listing half: absent rather than disabled when nothing in view can be listed (#682), and
  // where only some can, the labels carry that number — a count that differs from the bar's own is
  // the plainest way to say which copies are meant.
  if (listable > 0) {
    const partial =
      listable < inView
        ? ` Applies to the ${listable} of the ${inView} copies in view that are for sale and in hand.`
        : "";
    const quickHint = quickOffer
      ? `Created straight away on ${quickOffer.platformName} as ${quickOffer.stateLabel}, with no dialog.`
      : undefined;
    for (const shortcut of newOfferShortcuts(listable)) {
      actions.push({
        key: `new-offer-${shortcut.packaging}`,
        barLabel: shortcut.barLabel,
        menuLabel: shortcut.menuLabel,
        icon: "add",
        description: (quickHint ? `${shortcut.description} ${quickHint}` : shortcut.description) + partial,
        // The conflict outranks the mode: it is why pressing this may be a mistake.
        hint: collisionHint ?? quickHint,
        tone: "outline",
        colliding: !!collision,
        onSelect: () => on.newOffer(shortcut.packaging),
      });
    }
    actions.push({
      key: "add-to-offer",
      barLabel: listable < inView ? `Add ${listable} to offer` : "Add selected to offer",
      menuLabel: `Add ${listable} to offer`,
      icon: "addToOffer",
      description: "Put these copies into an offer — an existing one, or a new one." + partial,
      hint: collisionHint,
      tone: "filled",
      colliding: !!collision,
      onSelect: on.addToOffer,
    });
  }

  return actions;
}

/** The same actions as gutter-menu entries (#991). */
export function selectionMenuActions(actions: SelectionAction[]): RowAction[] {
  return actions.map((a) => ({
    key: a.key,
    label: a.menuLabel,
    icon: a.icon,
    hint: a.hint,
    disabled: a.disabled,
    onSelect: a.onSelect,
  }));
}
