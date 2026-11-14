// Which tab the offer's Pricing panel shows on its right (#2522).
//
// A tab is *present* when its card applies to the offer at all; a present tab may be *empty* — drawn,
// but with nothing to show yet (a Colnect market never read). The remembered tab wins when it is
// present and has content; otherwise the first tab with content; otherwise the first present one,
// whose own button is what fills it. No present tab at all → null, and the price table takes the
// panel's whole width.

export interface PricingTabChoice {
  key: string;
  present: boolean;
  empty: boolean;
}

export function pickPricingTab<T extends PricingTabChoice>(tabs: readonly T[], stored: string | null): T | null {
  const present = tabs.filter((tab) => tab.present);
  if (present.length === 0) return null;
  const withContent = present.filter((tab) => !tab.empty);
  const remembered = present.find((tab) => tab.key === stored);
  if (remembered && (!remembered.empty || withContent.length === 0)) return remembered;
  return withContent[0] ?? present[0];
}
