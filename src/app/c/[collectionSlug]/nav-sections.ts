/**
 * What the sidebar's sections are, which routes belong to them, and what colour each one speaks in
 * (#762).
 *
 * A plain module rather than part of `collection-sidebar.tsx`: what the sections *are* is a fact
 * about the app's shape, and keeping it beside the component that draws it leaves one place to
 * change when a screen moves — and one place for anything else that ever needs to ask which section
 * a route belongs to.
 */

export type SectionKey = "catalog" | "collection" | "selling" | "buying" | "partners";

/**
 * Which routes each section owns — the one place the mapping is written down.
 *
 * It decides which section is open when nothing has been toggled and which collapsed heading
 * carries the active tint. Stated as route prefixes rather than read
 * off the rendered entries, because a section has to be resolvable *before* its entries are
 * rendered — a collapsed section renders none of them. Prefix, not exact: an offer's own screen is
 * still the Selling section's, the same way it is still the Offers entry's.
 *
 * `/sales` and `/auctions/sales` are two different screens on purpose, and the prefix test keeps
 * them apart: `/c/x/auctions/sales` does not begin with `/c/x/sales`.
 */
export const SECTION_ROUTES: Record<SectionKey, string[]> = {
  catalog: ["/issues", "/stamps"],
  collection: ["/inventory", "/locations"],
  selling: ["/offers", "/sales"],
  buying: ["/wants", "/purchases", "/auctions"],
  partners: ["/trades", "/contacts", "/colnect"],
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  catalog: "Catalog",
  collection: "Collection",
  selling: "Selling",
  buying: "Buying",
  partners: "Partners",
};

/**
 * One quiet hue per section, and it is **not decoration**: the app reuses colours it already reads
 * elsewhere, so the tint says the same thing twice rather than something new. Green, blue and
 * violet are the **disposition** colours — in collection, for sale, for trade — so `Collection`,
 * `Selling` and `Partners` wear the colour their own records already carry, and `Buying` takes
 * amber, money going the other way.
 *
 * `Catalog` takes the near-neutral **slate**, and that is the point of it: five saturated families
 * one under another is the "pstrokate" sidebar this was fixing, and the catalog is the section to
 * spend the least colour on — it is the app's reference layer, read to look something up rather
 * than worked in all day. Trying a fifth hue there is what pushed Selling onto pink and made the
 * whole column loud; the fix was to stop looking for a fifth hue.
 *
 * Red, orange and teal are deliberately unused: the first two mean *something is wrong* everywhere
 * else in the app, and teal is the accent.
 */
export const SECTION_TINTS: Record<SectionKey, string> = {
  catalog: "slate",
  collection: "green",
  selling: "blue",
  buying: "amber",
  partners: "violet",
};

/** The section the given screen belongs to, or null on Overview / Settings / the footer links. */
export function sectionForPath(pathname: string, base: string): SectionKey | null {
  for (const key of Object.keys(SECTION_ROUTES) as SectionKey[]) {
    const owns = SECTION_ROUTES[key].some((route) => {
      const href = `${base}${route}`;
      return pathname === href || pathname.startsWith(`${href}/`);
    });
    if (owns) return key;
  }
  return null;
}
