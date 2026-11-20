import "server-only";
import { prisma } from "../../db";
import { getContactListItem } from "../../contacts";
import { normalizeFacebookProfileUrl } from "../../facebook-profile-rules";
import { normalizeMarketCode } from "../../market-anchoring";
import type { Prisma } from "@/generated/prisma/client";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalString, requiredString } from "../params";
import { resolveSeller } from "../purchase-reads";
import {
  AGENT_CONTACT_ROLES,
  CONTACT_ROLE_FLAGS,
  contactRecord,
  contactRow,
  parseContactRole,
  type AgentContact,
  type AgentContactRow,
  type ContactHistoryFacts,
} from "../contact-reads";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type { Operation, OperationContext, ParsedParams } from "../types";

// Contacts (#2610) — the people the collection deals with, read in full: who a contact is, how to reach
// them, their defaults, their Facebook profiles, and what the collector has done with them.
//
// **Read only, and the reads are the contact page's own.** The contact comes from `contacts.ts`'
// `getContactListItem`, the read behind the contact's page and its *Edit* dialog, so what the agent is
// told is what the collector sees. **Email, phone and notes are read here and nowhere else**: the
// collector opened them to the Assistant on 2026-11-21, for this read; a seller, a buyer and a
// proposal's contact stay two fields wherever else they appear (`purchase-reads.ts`, `sale-reads.ts`,
// `proposal-reads.ts`), and `find_contacts`' row is no wider.
//
// **What was done with the contact is the record's numbers**, each list newest first and narrowed as
// the contact's page narrows it: a purchase is one it supplied — never a trade's incoming half, which is
// its trade's — and an opening balance has no supplier at all. The list operations narrowed to the
// contact (`list_purchases`, `list_sales`, `list_trades`, `list_proposals`,
// `list_conversation_entries`) read each one.
//
// **A contact is named as the other operations name one**: its id, or what it is filed under or its
// full name exactly; an unknown name is refused with the close ones, pointing at `find_contacts`
// rather than at an operation that would create somebody.

// ── find_contacts ────────────────────────────────────────────────────────────

export async function findContacts(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentContactRow>> {
  const search = optionalString(params, "search");
  const roleValue = optionalString(params, "role");
  const marketValue = optionalString(params, "market");
  const profileValue = optionalString(params, "facebook_profile");

  const and: Prisma.ContactWhereInput[] = [];
  for (const word of (search ?? "").split(/\s+/).filter((w) => w.length > 0)) {
    and.push({
      OR: [
        { name: { contains: word, mode: "insensitive" } },
        { fullName: { contains: word, mode: "insensitive" } },
      ],
    });
  }
  if (roleValue !== null) {
    and.push({ [CONTACT_ROLE_FLAGS[parseContactRole(roleValue, "role")]]: true });
  }
  if (marketValue !== null) {
    const code = normalizeMarketCode(marketValue);
    if (!code) {
      throw invalidRequest(`"market" is a two-letter country code, such as DE or PL; "${marketValue}" is not one.`);
    }
    and.push({ market: code });
  }
  if (profileValue !== null) {
    const profile = normalizeFacebookProfileUrl(profileValue);
    if (!profile.ok || profile.value === null) {
      throw invalidRequest(
        `${profile.ok ? "That is not a profile link." : profile.message} Send a Facebook profile link as "facebook_profile", such as https://www.facebook.com/jan.kowalski.`
      );
    }
    and.push({ facebookProfiles: { some: { url: profile.value } } });
  }

  const where: Prisma.ContactWhereInput = {
    collectionId: context.collectionId,
    collection: { ownerId: context.ownerId },
    AND: and,
  };
  const window = parseListWindow(params);
  const [rows, total, header] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: {
        id: true,
        name: true,
        fullName: true,
        market: true,
        buyer: true,
        seller: true,
        exchangePartner: true,
        auctionHouse: true,
        other: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: window.offset,
      take: window.limit,
    }),
    // The match count and never `items.length` (#706).
    prisma.contact.count({ where }),
    loadCollectionHeader(context),
  ]);
  return listResponse(
    rows.map((row) => contactRow(row, collectionPath(header, `/contacts/${encodeURIComponent(row.id)}`))),
    total,
    window
  );
}

export const findContactsOperation: Operation = {
  name: "find_contacts",
  method: "GET",
  path: "/contacts",
  description:
    "Find the collection's contacts — the people and firms it buys from, sells to, trades with and bids at — by part of the name or full name, a role, a market, or a Facebook profile link, in any combination. This is how a contact is found before `get_contact` reads it in full.",
  writes: false,
  parameters: [
    {
      name: "search",
      in: "query",
      type: "string",
      required: false,
      description:
        "Words that must each appear in what the contact is filed under or in their full name, ignoring case — `jan`, `kowalski`, `bronek`.",
    },
    {
      name: "role",
      in: "query",
      type: "string",
      required: false,
      description:
        "Only contacts playing this role: `seller` (sells to the collector), `buyer` (buys from the collector), `exchange_partner` (trades stamps), `auction_house`, or `other`. A contact may play several.",
      values: AGENT_CONTACT_ROLES,
    },
    {
      name: "market",
      in: "query",
      type: "string",
      required: false,
      description: "Only contacts in this market, a two-letter country code such as DE or PL.",
    },
    {
      name: "facebook_profile",
      in: "query",
      type: "string",
      required: false,
      description: "Only the contact holding this Facebook profile link — at most one, since a profile belongs to one contact.",
    },
  ],
  result: {
    kind: "list",
    description:
      "The contacts, by name: `id`, `name` (what the contact is filed under — a marketplace login where they have one), `fullName` (their name beside a login, else null), `roles`, `market` (null where not known) and `path`, the contact's page in the app.",
  },
  handler: async (context, params) => findContacts(context, params),
};

// ── get_contact ──────────────────────────────────────────────────────────────

async function resolveContact(context: OperationContext, value: string): Promise<string> {
  const candidates = await prisma.contact.findMany({
    where: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });
  return resolveSeller(value, candidates, "contact", null);
}

/** What the collector has done with the contact — the contact page's narrowing, as numbers. */
async function loadContactHistory(collectionId: string, contactId: string): Promise<ContactHistoryFacts> {
  const [purchases, sales, trades, proposals, auctionSales, conversationEntries] = await Promise.all([
    prisma.purchase.findMany({
      where: { collectionId, contactId, kind: "purchase", tradeId: null },
      orderBy: [{ purchasedAt: "desc" }, { purchaseNo: "desc" }],
      select: { purchaseNo: true },
    }),
    prisma.sale.findMany({
      where: { collectionId, buyerId: contactId },
      orderBy: [{ soldAt: "desc" }, { saleNo: "desc" }],
      select: { saleNo: true },
    }),
    prisma.trade.findMany({
      where: { collectionId, partnerId: contactId },
      orderBy: [{ createdAt: "desc" }, { tradeNo: "desc" }],
      select: { tradeNo: true },
    }),
    prisma.proposal.findMany({
      where: { collectionId, contactId },
      orderBy: [{ createdAt: "desc" }, { proposalNo: "desc" }],
      select: { proposalNo: true },
    }),
    prisma.auctionSale.findMany({
      where: { collectionId, sellerId: contactId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true },
    }),
    prisma.conversationEntry.count({ where: { collectionId, contactId } }),
  ]);
  return {
    purchases: purchases.map((row) => row.purchaseNo),
    sales: sales.map((row) => row.saleNo),
    trades: trades.map((row) => row.tradeNo),
    proposals: proposals.map((row) => row.proposalNo),
    auctionSales,
    conversationEntries,
  };
}

export async function readContact(context: OperationContext, params: ParsedParams): Promise<AgentContact> {
  const contactId = await resolveContact(context, requiredString(params, "contact"));
  const [contact, remembered, history, header] = await Promise.all([
    getContactListItem(context.ownerId, contactId),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { defaultAuctionPlatform: { select: { name: true } } },
    }),
    loadContactHistory(context.collectionId, contactId),
    loadCollectionHeader(context),
  ]);
  if (!contact || contact.collectionId !== context.collectionId) {
    throw notFound(`No contact with id "${contactId}" is in this token's collection. Use \`find_contacts\` to find the right one.`);
  }
  return contactRecord(contact, {
    auctionPlatform: remembered?.defaultAuctionPlatform?.name ?? null,
    history,
    path: collectionPath(header, `/contacts/${encodeURIComponent(contactId)}`),
  });
}

export const getContactOperation: Operation = {
  name: "get_contact",
  method: "GET",
  path: "/contacts/{contact}",
  description:
    "One contact in full, as the contact's page and edit dialog show it: name, full name, email, phone, notes, roles and market; the defaults an auction sale or a sale to them starts from; their Facebook profiles; and the numbers of every purchase, sale, trade and proposal made with them, the auction sales tracked with them, and how many conversation entries are logged.",
  writes: false,
  parameters: [
    {
      name: "contact",
      in: "path",
      type: "string",
      required: true,
      description:
        "The contact's id from `find_contacts`, or what they are filed under or their full name, exactly; a name that matches nobody is refused with the contacts close to it.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The contact. `name` is what they are filed under (a marketplace login where they have one) and `fullName` their name beside it; `email`, `phone`, `notes` and `market` are null where not recorded. `roles` lists the ones they play. `facebookProfiles` are their profile links. The auction defaults, seeded onto an auction sale tracked with them: `defaultCurrency`, `defaultShippingCost`, `buyerPremiumPercent`, `buyerPremiumFixed`, and `auctionPlatform`, the platform they were last tracked on. Their own free-extras terms, each null for none and combined with the platform's on a sale to them: `freeExtrasMinimumOrder` and `freeExtrasMaximumBudget` in the collection's base currency, `freeExtrasBudgetPercent` of the order. What was done with them, newest first: `purchases` (purchase numbers — orders they supplied; a trade's incoming half is under its trade), `sales`, `trades` and `proposals` (their numbers), `auctionSales` (`id`, `name`, `status` — they have no number) and `conversationEntries`, a count. `list_purchases` with `seller`, `list_sales` with `buyer`, `list_trades` with `partner`, `list_proposals` with `contact` and `list_conversation_entries` with `buyer` read each in turn. `path` is the contact's page in the app.",
  },
  handler: async (context, params) => readContact(context, params),
};
