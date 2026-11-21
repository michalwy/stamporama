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

import { MAX_QUOTE_LENGTH } from "../conversation-log-rules";
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
  readonly language: string | null;
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
  /** The language the contact reads (#2603), an ISO 639-1 code, or null while it is not known. */
  readonly language: string | null;
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
    language: contact.language,
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

// ── create_contact / update_contact (#2611) ──────────────────────────────────

/** The contact's own keys behind the fields the agent may write one value to. */
export type ContactFieldKey =
  | "fullName"
  | "email"
  | "phone"
  | "notes"
  | "market"
  | "language"
  | "defaultCurrency"
  | "defaultShippingCost"
  | "buyerPremiumPercent"
  | "buyerPremiumFixed"
  | "freeExtrasMinimumOrder"
  | "freeExtrasBudgetPercent"
  | "freeExtrasMaximumBudget";

export interface ContactFieldSpec {
  /** The parameter, and the word `clear` names it by. */
  readonly param: string;
  readonly key: ContactFieldKey;
  /** How the conversation-log note names it. */
  readonly label: string;
  /** Offered by the contact's dialog only to a seller or an auction house — the dialog clears it on
   *  any other contact. */
  readonly sellerOnly: boolean;
  /** An amount, typed with either decimal separator or as a sum, as the dialog's amount fields are. */
  readonly amount: boolean;
}

/** Every one-value field of the contact's dialog, in the dialog's order. `name` is not here: it is
 *  required on create, can be renamed but never cleared. */
export const CONTACT_FIELDS: readonly ContactFieldSpec[] = [
  { param: "full_name", key: "fullName", label: "full name", sellerOnly: false, amount: false },
  { param: "email", key: "email", label: "email", sellerOnly: false, amount: false },
  { param: "phone", key: "phone", label: "phone", sellerOnly: false, amount: false },
  { param: "notes", key: "notes", label: "notes", sellerOnly: false, amount: false },
  { param: "market", key: "market", label: "market", sellerOnly: true, amount: false },
  { param: "language", key: "language", label: "language", sellerOnly: false, amount: false },
  { param: "default_currency", key: "defaultCurrency", label: "default currency", sellerOnly: true, amount: false },
  { param: "default_shipping_cost", key: "defaultShippingCost", label: "default shipping cost", sellerOnly: true, amount: true },
  { param: "buyer_premium_percent", key: "buyerPremiumPercent", label: "buyer's premium %", sellerOnly: true, amount: true },
  { param: "buyer_premium_fixed", key: "buyerPremiumFixed", label: "fixed buyer's premium", sellerOnly: true, amount: true },
  { param: "free_extras_minimum_order", key: "freeExtrasMinimumOrder", label: "minimum order for free extras", sellerOnly: false, amount: true },
  { param: "free_extras_budget_percent", key: "freeExtrasBudgetPercent", label: "free-extras budget %", sellerOnly: false, amount: true },
  { param: "free_extras_maximum_budget", key: "freeExtrasMaximumBudget", label: "maximum free-extras budget", sellerOnly: false, amount: true },
];

/** The names `clear` accepts — every field above; a name is never cleared. */
export const CLEARABLE_CONTACT_FIELDS: readonly string[] = CONTACT_FIELDS.map((field) => field.param);

/** The fields a call writes: a value, or null for one named in `clear`. A field not named is absent. */
export type ContactFieldChanges = Partial<Record<ContactFieldKey, string | null>>;

/**
 * The fields as sent, checked the way the dialog would and the domain cannot: an amount the dialog's
 * field would drop silently is refused here with its parameter named, and a field both sent and named
 * in `clear` is refused. `normalizeAmount` is the dialog's own reading of an amount field (either
 * separator, a sum) — passed in so this stays pure of where it lives.
 */
export function contactFieldChanges(
  read: (param: string) => string | null,
  clear: ReadonlySet<string>,
  normalizeAmount: (raw: string) => string
): ContactFieldChanges {
  const changes: ContactFieldChanges = {};
  for (const field of CONTACT_FIELDS) {
    const value = read(field.param);
    if (value !== null && clear.has(field.param)) {
      throw invalidRequest(`"${field.param}" is both sent and named in "clear". Send one or the other. Nothing was written.`);
    }
    if (clear.has(field.param)) {
      changes[field.key] = null;
    } else if (value !== null) {
      if (field.amount) {
        const normalised = normalizeAmount(value);
        const n = Number(normalised);
        if (normalised === "" || !Number.isFinite(n) || n < 0) {
          throw invalidRequest(`"${field.param}" is an amount such as 5.00; "${value}" is not one. Nothing was written.`);
        }
        changes[field.key] = normalised;
      } else {
        changes[field.key] = value;
      }
    }
  }
  return changes;
}

/** Whether these role flags make the contact one the dialog offers the auction defaults and market to. */
export function sellsToCollector(flags: ContactRoleFlags): boolean {
  return flags.seller || flags.auctionHouse;
}

/**
 * Refuse a seller-only field set on a contact that will be neither a seller nor an auction house —
 * the dialog does not offer it there, and would clear it on the next save.
 */
export function refuseSellerOnlyFields(changes: ContactFieldChanges, roles: ContactRoleFlags, who: string): void {
  if (sellsToCollector(roles)) return;
  const set = CONTACT_FIELDS.filter((field) => field.sellerOnly && typeof changes[field.key] === "string");
  if (set.length === 0) return;
  const names = set.map((field) => `"${field.param}"`).join(", ");
  throw invalidRequest(
    `${names} ${set.length === 1 ? "belongs" : "belong"} to a seller or an auction house — the defaults an auction sale with them starts from — and ${who} is neither. Send "roles" with seller or auction_house as well, or leave ${set.length === 1 ? "it" : "them"} out. Nothing was written.`
  );
}

/** The role flags a list of role words stands for. */
export function roleFlags(roles: readonly AgentContactRole[]): ContactRoleFlags {
  return {
    buyer: roles.includes("buyer"),
    seller: roles.includes("seller"),
    exchangePartner: roles.includes("exchange_partner"),
    auctionHouse: roles.includes("auction_house"),
    other: roles.includes("other"),
  };
}

/** What a contact is, for the change note: the dialog's fields, named, with its roles and profiles. */
export type ContactLogFacts = Omit<ContactRecordFacts, "id">;

/** One change the note states — `before` is null for a contact just created. */
export interface ContactChange {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** How long one value may run in the note before it is cut. */
const MAX_LOGGED_VALUE = 500;

function shown(value: string | null): string {
  if (value === null || value === "") return "(none)";
  return value.length > MAX_LOGGED_VALUE ? `${value.slice(0, MAX_LOGGED_VALUE)}…` : value;
}

/**
 * What a write changed, field by field, from the contact as it was (`null` when it was just created)
 * to the contact as the domain now reads it — so the note states what was stored, normalised, and
 * never what was merely sent. Facebook profiles are stated as added and removed.
 */
export function contactChanges(before: ContactLogFacts | null, after: ContactLogFacts): ContactChange[] {
  const changes: ContactChange[] = [];
  const push = (label: string, was: string | null, now: string | null) => {
    if ((was ?? null) !== (now ?? null)) changes.push({ label, before: before === null ? null : was ?? null, after: now ?? null });
  };
  push("name", before?.name ?? null, after.name);
  const rolesOf = (facts: ContactLogFacts | null) => {
    const roles = facts === null ? [] : contactRoles(facts);
    return roles.length > 0 ? roles.join(", ") : null;
  };
  for (const field of CONTACT_FIELDS) {
    if (field.key === "market") push("roles", rolesOf(before), rolesOf(after));
    push(field.label, before?.[field.key] ?? null, after[field.key]);
  }
  const had = before?.facebookProfileUrls ?? [];
  const added = after.facebookProfileUrls.filter((url) => !had.includes(url));
  const removed = had.filter((url) => !after.facebookProfileUrls.includes(url));
  if (added.length > 0 || removed.length > 0) {
    changes.push({
      label: "Facebook profiles",
      before: removed.length > 0 ? `removed ${removed.join(", ")}` : null,
      after: added.length > 0 ? `added ${added.join(", ")}` : null,
    });
  }
  return changes;
}

/**
 * The conversation-log note a write leaves on the contact (#2611): the summary names what changed —
 * what the contact's page shows — and the quote states each change from the old value to the new one,
 * so a wrong one can be found and put back. Null when nothing changed, which writes no note.
 */
export function contactChangeNote(
  changes: readonly ContactChange[],
  created: boolean
): { summary: string; quote: string } | null {
  if (changes.length === 0) return null;
  const labels = changes.map((change) => change.label).join(", ");
  const summary = created ? `Contact created by the Assistant with ${labels}.` : `Contact changed by the Assistant: ${labels}.`;
  const lines = changes.map((change) => {
    if (change.label === "Facebook profiles") {
      return `Facebook profiles: ${[change.after, change.before].filter((part) => part !== null).join("; ")}`;
    }
    return created ? `${change.label}: ${shown(change.after)}` : `${change.label}: ${shown(change.before)} → ${shown(change.after)}`;
  });
  const quote = lines.join("\n");
  return { summary, quote: quote.length > MAX_QUOTE_LENGTH ? `${quote.slice(0, MAX_QUOTE_LENGTH - 1)}…` : quote };
}
