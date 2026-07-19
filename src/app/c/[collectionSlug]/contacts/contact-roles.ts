import type { ContactRoles } from "@/lib/contacts";

/** The combinable contact role flags, in display order, shared by the form checkboxes,
 * the row badges, and the filter chips so the label wording stays in one place. */
export const CONTACT_ROLES: { key: keyof ContactRoles; label: string }[] = [
  { key: "seller", label: "Seller" },
  { key: "buyer", label: "Buyer" },
  { key: "exchangePartner", label: "Exchange partner" },
  { key: "auctionHouse", label: "Auction house" },
  { key: "platform", label: "Platform" },
  { key: "other", label: "Other" },
];
