// Which tab the offer's Pricing panel shows on its right (#2522).
//
// A tab is *present* when its card applies to the offer at all; a present tab may be *empty* — drawn,
// but with nothing to show yet (a Colnect market never read). The remembered tab wins when it is
// present and has content; otherwise the first tab with content; otherwise the first present one,
// whose own button is what fills it. No present tab at all → null, and the price table takes the
// panel's whole width.
//
// A tab the collector *clicked* on this screen beats all of that (#2577): it opens, and stays open,
// even while empty — an empty Colnect market's own button is the only way to fill it, so passing over
// it on a click would leave its prices unreadable. The preference for content applies only to the
// panel's own choice when the screen opens.

export interface PricingTabChoice {
  key: string;
  present: boolean;
  empty: boolean;
}

export function pickPricingTab<T extends PricingTabChoice>(
  tabs: readonly T[],
  stored: string | null,
  clicked: string | null = null
): T | null {
  const present = tabs.filter((tab) => tab.present);
  if (present.length === 0) return null;
  const chosen = present.find((tab) => tab.key === clicked);
  if (chosen) return chosen;
  const withContent = present.filter((tab) => !tab.empty);
  const remembered = present.find((tab) => tab.key === stored);
  if (remembered && (!remembered.empty || withContent.length === 0)) return remembered;
  return withContent[0] ?? present[0];
}
