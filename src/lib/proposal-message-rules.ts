// The message a proposal's buyer is sent (#2288) — pure, no Prisma and no `server-only`, because the
// template's editor is a client component and lists the very placeholders the renderer fills.
//
// A proposal goes to one person, usually in a chat: the lots numbered with their prices and the total,
// in the collector's own words around them. The words are the **Direct platform's template**, as a
// post's text comes from its group's (#1544); the figures are placeholders. Plain text — a chat reads
// no formatting.
//
// What a placeholder comes out as is the template's whole contract: nothing is added, substituted or
// fallen back to (#1692). With no template there is no message at all.
//
// **One template per language** (#2603): a proposal is sent in its buyer's language, and its message
// comes from the template for that language and no other — a language with none has no message.

import {
  isKnownTemplateToken,
  resolveTemplateToken,
  TEMPLATE_TOKEN,
  templateNumbers,
  templateTokens,
  writtenAmount,
  type CurrencyStyle,
  type TemplateValue,
} from "./template-amount";
import { normalizeLanguage } from "./languages";

/** One placeholder a proposal's message may carry, with the label and example its editor shows.
 *  `amount` marks one that writes amounts and so takes the currency parameter (#2028); `number` one
 *  that writes an internal number and so takes the padding one (#2097). */
export interface ProposalMessagePlaceholder {
  token: string;
  label: string;
  example: string;
  amount?: boolean;
  number?: boolean;
}

/** The placeholders a proposal's message may carry. */
export const PROPOSAL_MESSAGE_PLACEHOLDERS: readonly ProposalMessagePlaceholder[] = [
  { token: "{buyer}", label: "Buyer's name", example: "Jan Kowalski" },
  {
    token: "{lots}",
    label: "Lots with their numbers and prices, one per line",
    example: "2. Austria 1850 Mercury — 25 zł",
    amount: true,
  },
  { token: "{total}", label: "Total of the lots", example: "120 zł", amount: true },
  { token: "{proposal}", label: "Proposal number", example: "4", number: true },
];

/** One lot as `{lots}` lists it. */
export interface ProposalMessageLot {
  /** Its lot number — the one the photos, the document and the proposal's screen carry. */
  lotNo: number;
  title: string;
  /** What it is offered at, as a 2-dp string, or null while it has no price. */
  price: string | null;
}

/** What a proposal gives its message. `lots` are the ones still offered — the withdrawn left out, as
 *  the total leaves them out — in lot order. */
export interface ProposalMessageInput {
  proposalNo: number;
  buyerName: string;
  currency: string;
  lots: readonly ProposalMessageLot[];
  /** The proposal's total over those lots, as a 2-dp string. */
  total: string;
}

/** `2. Austria 1850 Mercury — 25 zł`: the number the buyer answers with, the title, and the price
 *  where there is one — the dash a post's template examples and the buyer message join them with. A lot
 *  with no title is its number alone. */
function lotLine(lot: ProposalMessageLot, currency: string, style: CurrencyStyle): string {
  const head = lot.title ? `${lot.lotNo}. ${lot.title}` : `${lot.lotNo}.`;
  return lot.price === null ? head : `${head} — ${writtenAmount(lot.price, currency, style)}`;
}

/** Each placeholder's value for this proposal. */
export function proposalMessageValues(input: ProposalMessageInput): Record<string, TemplateValue> {
  return {
    "{buyer}": input.buyerName,
    "{lots}": (style: CurrencyStyle) => input.lots.map((lot) => lotLine(lot, input.currency, style)).join("\n"),
    "{total}": (style: CurrencyStyle) => writtenAmount(input.total, input.currency, style),
    "{proposal}": templateNumbers(input.proposalNo),
  };
}

/**
 * The message for this proposal, or null with no template — a blank one included, which is no
 * message. A token that is not a placeholder stays as typed, the rule of every template here, and
 * nothing else is touched: the template's own lines and spacing are the message's.
 */
export function renderProposalMessage(template: string | null | undefined, input: ProposalMessageInput): string | null {
  if (!template?.trim()) return null;
  const values = proposalMessageValues(input);
  return template.replace(TEMPLATE_TOKEN, (token) => resolveTemplateToken(token, values) ?? token);
}

/** The tokens a template carries that are not placeholders — named beside the field while it is typed,
 *  so a misspelt `{lot}` is seen there rather than in the buyer's chat. */
export function unknownProposalMessagePlaceholders(template: string): string[] {
  return templateTokens(template).filter((token) => !isKnownTemplateToken(token, PROPOSAL_MESSAGE_PLACEHOLDERS));
}

// ── One template per language (#2603) ────────────────────────────────────────────────────────────

/** One language's proposal message template, as the Direct platform keeps it. */
export interface ProposalMessageTemplate {
  /** A normalised ISO 639-1 code. */
  language: string;
  template: string;
}

/** The name a language's template field carries on Settings → Direct, `proposalMessageTemplate:de` —
 *  the action reads every field so named as the whole set. */
export const PROPOSAL_MESSAGE_FIELD_PREFIX = "proposalMessageTemplate:";

/**
 * The rows a set of templates keyed by language is saved as: each language normalised, the text
 * trimmed, a blank one left out — a language with no text has no message. Where two keys normalise to
 * the same language the first with text wins. Ordered by language.
 */
export function proposalMessageTemplateRows(
  templates: Readonly<Record<string, string | null | undefined>>
): ProposalMessageTemplate[] {
  const rows = new Map<string, string>();
  for (const [key, raw] of Object.entries(templates)) {
    const language = normalizeLanguage(key);
    const template = raw?.trim();
    if (!language || !template || rows.has(language)) continue;
    rows.set(language, template);
  }
  return [...rows]
    .map(([language, template]) => ({ language, template }))
    .sort((a, b) => a.language.localeCompare(b.language));
}

/** The template for `language` and no other — null where that language has none, or the proposal has
 *  no language at all. Nothing is filled in from another language. */
export function proposalMessageTemplateFor(
  templates: readonly ProposalMessageTemplate[],
  language: string | null
): string | null {
  const code = normalizeLanguage(language);
  if (!code) return null;
  return templates.find((t) => normalizeLanguage(t.language) === code)?.template ?? null;
}
