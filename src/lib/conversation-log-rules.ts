// The conversation log's vocabulary and field rules (#2149, ADR-0073) — what an entry may say, read
// the same way by the card's dialog, the server actions and the agent API. Pure: no Prisma, no I/O.

/** Where a conversation took place. *Other* is the honest answer for a channel not listed. */
export const CONVERSATION_CHANNELS = ["messenger", "email", "allegro", "phone", "other"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_CHANNEL_LABEL: Record<ConversationChannel, string> = {
  messenger: "Messenger",
  email: "E-mail",
  allegro: "Allegro messages",
  phone: "Phone",
  other: "Other",
};

/** Who said it: the buyer, the collector, or neither — a note about the conversation. */
export const CONVERSATION_DIRECTIONS = ["from_buyer", "to_buyer", "note"] as const;
export type ConversationDirection = (typeof CONVERSATION_DIRECTIONS)[number];

export const CONVERSATION_DIRECTION_LABEL: Record<ConversationDirection, string> = {
  from_buyer: "From the buyer",
  to_buyer: "To the buyer",
  note: "Note",
};

/** Who wrote the entry — fixed when it is written; correcting an entry does not change it. */
export const CONVERSATION_AUTHORS = ["assistant", "collector"] as const;
export type ConversationAuthor = (typeof CONVERSATION_AUTHORS)[number];

/** A summary is a sentence or two; a quote is what was said where the words matter. Both are capped
 *  so that an entry stays an entry rather than a pasted conversation. */
export const MAX_SUMMARY_LENGTH = 2000;
export const MAX_QUOTE_LENGTH = 5000;
export const MAX_URL_LENGTH = 2000;

export function isConversationChannel(value: string): value is ConversationChannel {
  return (CONVERSATION_CHANNELS as readonly string[]).includes(value);
}

export function isConversationDirection(value: string): value is ConversationDirection {
  return (CONVERSATION_DIRECTIONS as readonly string[]).includes(value);
}

/** The text fields of an entry as typed, before they are checked. */
export interface ConversationTextInput {
  summary: string;
  quote: string | null;
  url: string | null;
}

export type ConversationTextCheck =
  | { ok: true; summary: string; quote: string | null; url: string | null }
  | { ok: false; field: "summary" | "quote" | "url"; message: string };

/**
 * The text fields checked: a summary is required, a blank quote or link is none, and a link is a web
 * address — `http://` or `https://` — since it is opened from the card.
 */
export function checkConversationText(input: ConversationTextInput): ConversationTextCheck {
  const summary = input.summary.trim();
  if (summary === "") return { ok: false, field: "summary", message: "Write what was said — the summary is required." };
  if (summary.length > MAX_SUMMARY_LENGTH) {
    return {
      ok: false,
      field: "summary",
      message: `The summary is ${summary.length} characters; an entry's summary is at most ${MAX_SUMMARY_LENGTH}. Put the words themselves in the quote.`,
    };
  }
  const quote = input.quote?.trim() || null;
  if (quote !== null && quote.length > MAX_QUOTE_LENGTH) {
    return {
      ok: false,
      field: "quote",
      message: `The quote is ${quote.length} characters; an entry's quote is at most ${MAX_QUOTE_LENGTH}. Quote what matters, not the whole conversation.`,
    };
  }
  const url = input.url?.trim() || null;
  if (url !== null && (!/^https?:\/\/\S+$/i.test(url) || url.length > MAX_URL_LENGTH)) {
    return { ok: false, field: "url", message: "The link must be a web address starting with http:// or https://." };
  }
  return { ok: true, summary, quote, url };
}
