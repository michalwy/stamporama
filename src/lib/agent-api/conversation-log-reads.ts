// The pure half of the conversation log through the agent API (#2149, ADR-0073): how one entry is
// spelled in a batch, how a sale is named, and what an entry reads back as.
//
// **One entry is one string, a field per line**, `name=value`:
//
//     at=2026-10-20T14:05:00+02:00
//     channel=messenger
//     direction=from_buyer
//     summary=Takes both sets for 40 PLN with shipping; pays by BLIK tonight.
//     quote=ok biorę oba za 40 zł z wysyłką
//
// A parameter on this surface is a scalar or a string list and nothing richer (#706), so a batch is a
// string list, as the price observations' is. Their `;`-separated pairs do not fit here: a summary
// and a quote are free text, and a `;` in what a buyer wrote is ordinary. **A line that does not
// start with a field's name and `=` continues the field before it**, so a quote may run over several
// lines.
//
// **A batch answers per entry and never fails whole over one** (#1540's rule): an entry with a
// misread time is one entry to send again.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import {
  CONVERSATION_CHANNELS,
  CONVERSATION_DIRECTIONS,
  checkConversationText,
  isConversationChannel,
  isConversationDirection,
  type ConversationChannel,
  type ConversationDirection,
} from "../conversation-log-rules";

/** The most entries one call records — a conversation read at once, with room to spare. */
export const MAX_CONVERSATION_ENTRIES = 50;

/** The names an entry may carry, in the order the description lists them. */
export const CONVERSATION_ENTRY_FIELDS = ["at", "channel", "direction", "summary", "quote", "link", "sale"] as const;

export type ConversationEntryField = (typeof CONVERSATION_ENTRY_FIELDS)[number];

/** The word for *about no sale*, where a sale is named. */
export const NO_SALE = "none";

/** How a sale was named: its short number, its id, or none. */
export type SaleRef = { kind: "number"; saleNo: number } | { kind: "id"; id: string } | { kind: "none" };

/**
 * A sale as the agent names it — its number as the collector calls it (`12`, `s12`, `#12`), its id
 * from `list_sales`, or `none`.
 */
export function parseSaleRef(value: string): SaleRef {
  const text = value.trim();
  if (text.toLocaleLowerCase() === NO_SALE) return { kind: "none" };
  const numbered = /^[s#]?(\d+)$/i.exec(text);
  if (numbered) return { kind: "number", saleNo: Number(numbered[1]) };
  return { kind: "id", id: text };
}

/** One entry as sent, its fields checked — the sale not resolved yet. */
export interface ConversationEntrySpec {
  readonly at: Date;
  readonly channel: ConversationChannel;
  readonly direction: ConversationDirection;
  readonly summary: string;
  readonly quote: string | null;
  readonly link: string | null;
  /** The entry's own sale, or null to take the call's. */
  readonly sale: SaleRef | null;
}

const EXAMPLE =
  "`at=2026-10-20T14:05:00+02:00`, `channel=messenger`, `direction=from_buyer` and `summary=…` on lines of their own";

/**
 * An instant, ISO 8601 with its offset — `2026-10-20T14:05:00+02:00` or `…Z`, or the reason it is not
 * one. A clock time without its zone is refused, as the auction writes refuse one: a Messenger time
 * read without it is an hour or two off.
 */
export function parseConversationInstant(value: string): Date | string {
  const text = value.trim();
  const shaped = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text);
  const date = shaped ? new Date(text) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return `"${text}" is not an instant. Send when it was said as ISO 8601 with the time zone — "2026-10-20T14:05:00+02:00" or "2026-10-20T12:05:00Z".`;
  }
  return date;
}

/** One entry's fields, a field per line, or the reason it is not an entry. */
export function parseConversationEntrySpec(
  entry: string
): { ok: true; spec: ConversationEntrySpec } | { ok: false; reason: string } {
  const fields = new Map<ConversationEntryField, string>();
  let last: ConversationEntryField | null = null;
  for (const line of entry.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    const named = eq < 0 ? "" : line.slice(0, eq).trim().toLocaleLowerCase();
    if ((CONVERSATION_ENTRY_FIELDS as readonly string[]).includes(named)) {
      const name = named as ConversationEntryField;
      if (fields.has(name)) return { ok: false, reason: `The entry names "${name}" twice.` };
      fields.set(name, line.slice(eq + 1).trim());
      last = name;
      continue;
    }
    if (last === null) {
      if (line.trim() === "") continue;
      return {
        ok: false,
        reason: `"${line.trim()}" does not start with a field. An entry takes ${CONVERSATION_ENTRY_FIELDS.join(", ")} — ${EXAMPLE}.`,
      };
    }
    // The field before goes on: a quote or a summary over several lines.
    fields.set(last, `${fields.get(last)}\n${line}`);
  }

  const missing = (["at", "channel", "direction", "summary"] as const).filter((name) => !fields.get(name)?.trim());
  if (missing.length > 0) {
    return { ok: false, reason: `The entry has no ${missing.join(" and no ")}. Write it as ${EXAMPLE}.` };
  }
  const at = parseConversationInstant(fields.get("at")!);
  if (typeof at === "string") return { ok: false, reason: at };
  const channel = fields.get("channel")!.trim();
  if (!isConversationChannel(channel)) {
    return { ok: false, reason: `"${channel}" is not a channel; one of ${CONVERSATION_CHANNELS.join(", ")}.` };
  }
  const direction = fields.get("direction")!.trim();
  if (!isConversationDirection(direction)) {
    return { ok: false, reason: `"${direction}" is not a direction; one of ${CONVERSATION_DIRECTIONS.join(", ")}.` };
  }
  const text = checkConversationText({
    summary: fields.get("summary")!,
    quote: fields.get("quote") ?? null,
    url: fields.get("link") ?? null,
  });
  if (!text.ok) return { ok: false, reason: text.message };
  const sale = fields.get("sale")?.trim();
  return {
    ok: true,
    spec: {
      at,
      channel,
      direction,
      summary: text.summary,
      quote: text.quote,
      link: text.url,
      sale: sale ? parseSaleRef(sale) : null,
    },
  };
}

/** An entry as an agent reads it. */
export interface AgentConversationEntry {
  readonly id: string;
  readonly buyer: { readonly id: string; readonly name: string };
  readonly sale: { readonly id: string; readonly saleNo: number } | null;
  readonly at: string;
  readonly channel: string;
  readonly direction: string;
  readonly summary: string;
  readonly quote: string | null;
  readonly link: string | null;
  /** `assistant` or `collector` — who wrote it. */
  readonly writtenBy: string;
}

/** The fields of an entry the projection reads — structurally typed, so it unit-tests without Prisma. */
export interface ConversationEntryLike {
  readonly id: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly saleId: string | null;
  readonly saleNo: number | null;
  readonly occurredAt: string;
  readonly channel: string;
  readonly direction: string;
  readonly summary: string;
  readonly quote: string | null;
  readonly url: string | null;
  readonly author: string;
}

export function agentConversationEntry(entry: ConversationEntryLike): AgentConversationEntry {
  return {
    id: entry.id,
    buyer: { id: entry.contactId, name: entry.contactName },
    sale: entry.saleId !== null && entry.saleNo !== null ? { id: entry.saleId, saleNo: entry.saleNo } : null,
    at: entry.occurredAt,
    channel: entry.channel,
    direction: entry.direction,
    summary: entry.summary,
    quote: entry.quote,
    link: entry.url,
    writtenBy: entry.author,
  };
}

/** One entry of a batch, answered. */
export type AgentConversationAnswer =
  | { readonly index: number; readonly status: "recorded"; readonly entry: AgentConversationEntry }
  | { readonly index: number; readonly status: "refused"; readonly reason: string };

export interface AgentConversationBatch {
  readonly recorded: number;
  readonly refused: number;
  readonly entries: readonly AgentConversationAnswer[];
}

export function summarizeConversationBatch(answers: readonly AgentConversationAnswer[]): AgentConversationBatch {
  return {
    recorded: answers.filter((answer) => answer.status === "recorded").length,
    refused: answers.filter((answer) => answer.status === "refused").length,
    entries: answers,
  };
}
