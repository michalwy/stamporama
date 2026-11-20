// What the contact operations answer with, and the projections that build it (#2610).
//
// **Pure, and structurally typed on purpose**, the shape every `*-reads.ts` beside it has and for
// their reason (`agent-api.md`, *The module layout is the Prisma-free split*). No Prisma, no
// `server-only`, so `pnpm test:unit` holds every decision below.
//
// Three of them are worth a test:
//
//  - **`get_contact` is the one place a contact is read in full** — email, phone and notes included,
//    which the collector opened to the Assistant on 2026-11-21. Everywhere else a contact is still
//    two fields (a seller, a buyer, a proposal's contact), and `find_contacts`' row is the same short
//    shape: a list of people is how one is found, not how one is read. The projections name their
//    fields; **do not replace a mapper here with a spread**, or the row starts carrying the record.
//  - **A role is a word, not a flag.** The contact's five flags become the list of the ones it plays,
//    in snake case — `exchange_partner`, `auction_house` — so `role=` and the answer use one spelling.
//  - **What was done with the contact is numbers**, the ones the collector calls each record by, newest
//    first: the list operations narrowed to the contact read each one, and a buyer of three hundred
//    sales is three hundred short integers rather than three hundred rows.

import { invalidRequest } from "./errors";

/** The contact roles as the agent names them — `find_contacts`' closed vocabulary, and what a
 *  contact's `roles` lists. In the order the contact's edit dialog shows them. */
export const AGENT_CONTACT_ROLES = ["seller", "buyer", "exchange_partner", "auction_house", "other"] as const;
export type AgentContactRole = (typeof AGENT_CONTACT_ROLES)[number];

/** The contact's own flag behind each role word. */
export const CONTACT_ROLE_FLAGS: Record<AgentContactRole, keyof ContactRoleFlags> = {
  seller: "seller",
  buyer: "buyer",
  exchange_partner: "exchangePartner",
  auction_house: "auctionHouse",
  other: "other",
};

export interface ContactRoleFlags {
  readonly buyer: boolean;
  readonly seller: boolean;
  readonly exchangePartner: boolean;
  readonly auctionHouse: boolean;
  readonly other: boolean;
}

/** The role words a contact's flags stand for, in the dialog's order. */
export function contactRoles(flags: ContactRoleFlags): AgentContactRole[] {
  return AGENT_CONTACT_ROLES.filter((role) => flags[CONTACT_ROLE_FLAGS[role]]);
}

/** A role word as sent, or a refusal naming the five. The dispatcher checks `values` already; this is
 *  the narrowing to the type. */
export function parseContactRole(value: string, parameter: string): AgentContactRole {
  const role = AGENT_CONTACT_ROLES.find((candidate) => candidate === value.trim());
  if (!role) {
    throw invalidRequest(
      `"${value}" is not a role for "${parameter}". Send one of ${AGENT_CONTACT_ROLES.join(", ")}.`,
      AGENT_CONTACT_ROLES
    );
  }
  return role;
}

// ── find_contacts ────────────────────────────────────────────────────────────

/** What `find_contacts` reads off each contact. */
export interface ContactRowFacts extends ContactRoleFlags {
  readonly id: string;
  readonly name: string;
  readonly fullName: string | null;
  readonly market: string | null;
}

/** One contact as `find_contacts` states it — who it is, never what it holds. */
export interface AgentContactRow {
  readonly id: string;
  readonly name: string;
  readonly fullName: string | null;
  readonly roles: readonly AgentContactRole[];
  readonly market: string | null;
  readonly path: string;
}

export function contactRow(contact: ContactRowFacts, path: string): AgentContactRow {
  return {
    id: contact.id,
    name: contact.name,
    fullName: contact.fullName,
    roles: contactRoles(contact),
    market: contact.market,
    path,
  };
}

// ── get_contact ──────────────────────────────────────────────────────────────

/** Everything the contact's edit dialog shows, as `contacts.ts` reads it — amounts as 2-dp strings. */
export interface ContactRecordFacts extends ContactRowFacts {
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly facebookProfileUrls: readonly string[];
  readonly defaultCurrency: string | null;
  readonly defaultShippingCost: string | null;
  readonly buyerPremiumPercent: string | null;
  readonly buyerPremiumFixed: string | null;
  readonly freeExtrasMinimumOrder: string | null;
  readonly freeExtrasBudgetPercent: string | null;
  readonly freeExtrasMaximumBudget: string | null;
}

/** An auction sale tracked with the contact — it has no number, so it is named as the register names it. */
export interface AgentContactAuctionSale {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** What the collector has done with the contact, each record by the number it is called by, newest first. */
export interface ContactHistoryFacts {
  readonly purchases: readonly number[];
  readonly sales: readonly number[];
  readonly trades: readonly number[];
  readonly proposals: readonly number[];
  readonly auctionSales: readonly AgentContactAuctionSale[];
  readonly conversationEntries: number;
}

/** One contact as `get_contact` states it: the edit dialog's fields, the profiles, and the record. */
export interface AgentContact extends ContactHistoryFacts {
  readonly id: string;
  readonly name: string;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly roles: readonly AgentContactRole[];
  readonly market: string | null;
  readonly facebookProfiles: readonly string[];
  readonly defaultCurrency: string | null;
  readonly defaultShippingCost: string | null;
  readonly buyerPremiumPercent: string | null;
  readonly buyerPremiumFixed: string | null;
  /** The platform the contact was last tracked on at auction — remembered by the app, not a setting. */
  readonly auctionPlatform: string | null;
  readonly freeExtrasMinimumOrder: string | null;
  readonly freeExtrasBudgetPercent: string | null;
  readonly freeExtrasMaximumBudget: string | null;
  readonly path: string;
}

export function contactRecord(
  contact: ContactRecordFacts,
  extra: { readonly auctionPlatform: string | null; readonly history: ContactHistoryFacts; readonly path: string }
): AgentContact {
  const { history } = extra;
  return {
    id: contact.id,
    name: contact.name,
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    notes: contact.notes,
    roles: contactRoles(contact),
    market: contact.market,
    facebookProfiles: [...contact.facebookProfileUrls],
    defaultCurrency: contact.defaultCurrency,
    defaultShippingCost: contact.defaultShippingCost,
    buyerPremiumPercent: contact.buyerPremiumPercent,
    buyerPremiumFixed: contact.buyerPremiumFixed,
    auctionPlatform: extra.auctionPlatform,
    freeExtrasMinimumOrder: contact.freeExtrasMinimumOrder,
    freeExtrasBudgetPercent: contact.freeExtrasBudgetPercent,
    freeExtrasMaximumBudget: contact.freeExtrasMaximumBudget,
    purchases: [...history.purchases],
    sales: [...history.sales],
    trades: [...history.trades],
    proposals: [...history.proposals],
    auctionSales: history.auctionSales.map((sale) => ({ id: sale.id, name: sale.name, status: sale.status })),
    conversationEntries: history.conversationEntries,
    path: extra.path,
  };
}
