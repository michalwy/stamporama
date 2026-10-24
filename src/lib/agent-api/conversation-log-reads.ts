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
// **A file is one string too** (#2150), the same grammar: `name=` the file's name and `data=` its
// bytes in base64 — a data URL's `data:…;base64,` prefix is read past, and the base64 may wrap over
// lines. A parameter carries no bytes any other way, and this is the one spelling an MCP client can
// send as well as a REST one. **What the file is comes from its bytes**, never from the name. A file
// sent with `add_conversation_entries` says which entry it goes with by `entry=`, the entry's place
// in `entries` — the `index` its answer carries.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { agentConversationAttachmentUrl } from "./photo-url";
import { attachmentKind } from "../conversation-attachment-rules";
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

/** A file kept with an entry, as an agent reads it — a link, never the bytes (#706). */
export interface AgentConversationAttachment {
  readonly id: string;
  readonly name: string;
  /** `image` or `pdf`. */
  readonly type: string;
  readonly bytes: number;
  /** The file itself, fetched with the same token. */
  readonly url: string;
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
  /** The files kept with it, in the order they were attached. */
  readonly attachments: readonly AgentConversationAttachment[];
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
  readonly attachments: readonly ConversationAttachmentLike[];
}

/** The fields of an attachment the projection reads. */
export interface ConversationAttachmentLike {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export function agentConversationAttachment(
  attachment: ConversationAttachmentLike,
  collectionId: string
): AgentConversationAttachment {
  return {
    id: attachment.id,
    name: attachment.fileName,
    type: attachmentKind(attachment.contentType),
    bytes: attachment.sizeBytes,
    url: agentConversationAttachmentUrl(collectionId, attachment.id),
  };
}

export function agentConversationEntry(entry: ConversationEntryLike, collectionId: string): AgentConversationEntry {
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
    attachments: entry.attachments.map((attachment) => agentConversationAttachment(attachment, collectionId)),
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
  /** The files sent with the entries, answered each by its place in `files` — present only when
   *  files were sent. */
  readonly files?: readonly AgentAttachmentAnswer[];
}

export function summarizeConversationBatch(
  answers: readonly AgentConversationAnswer[],
  files?: readonly AgentAttachmentAnswer[]
): AgentConversationBatch {
  return {
    recorded: answers.filter((answer) => answer.status === "recorded").length,
    refused: answers.filter((answer) => answer.status === "refused").length,
    entries: answers,
    ...(files && files.length > 0 ? { files } : {}),
  };
}

// ── Files ───────────────────────────────────────────────────────────────────

/** The most files one call attaches. A file is sent whole in the call, so a handful at a time. */
export const MAX_ATTACHMENT_FILES = 10;

/** The names a file may carry; `entry` only with `add_conversation_entries`. */
export const ATTACHMENT_FILE_FIELDS = ["name", "data", "entry"] as const;

type AttachmentFileField = (typeof ATTACHMENT_FILE_FIELDS)[number];

/** One file as sent: its name, its bytes, and — sent with entries — the entry it goes with. */
export interface AttachmentFileSpec {
  readonly name: string;
  readonly bytes: Buffer;
  /** The entry's place in `entries`; null where the call names the entry itself. */
  readonly entry: number | null;
}

const FILE_EXAMPLE = "`name=payment.png` and `data=<the file in base64>` on lines of their own";

/**
 * Bytes from base64 — standard or URL-safe, padded or not, wrapped over lines, after an optional
 * data URL prefix — or null when it is not base64. Strict, since `Buffer.from` quietly skips what it
 * cannot read and would store a damaged file without a word.
 */
export function decodeAttachmentData(value: string): Buffer | null {
  let text = value.replace(/\s+/g, "");
  const dataUrl = /^data:[^,]*;base64,/i.exec(text);
  if (dataUrl) text = text.slice(dataUrl[0].length);
  text = text.replace(/-/g, "+").replace(/_/g, "/");
  if (text === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const unpadded = text.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return null;
  return Buffer.from(unpadded, "base64");
}

/**
 * One file, a field per line, or the reason it is not one. `withEntry` is whether the call sends
 * entries, so a file must say which of them it goes with — and must not where it does not.
 */
export function parseAttachmentFileSpec(
  file: string,
  options: { withEntry: boolean; entries?: number }
): { ok: true; spec: AttachmentFileSpec } | { ok: false; reason: string } {
  const fields = new Map<AttachmentFileField, string>();
  let last: AttachmentFileField | null = null;
  for (const line of file.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    const named = eq < 0 ? "" : line.slice(0, eq).trim().toLocaleLowerCase();
    if ((ATTACHMENT_FILE_FIELDS as readonly string[]).includes(named)) {
      const name = named as AttachmentFileField;
      if (fields.has(name)) return { ok: false, reason: `The file names "${name}" twice.` };
      fields.set(name, line.slice(eq + 1).trim());
      last = name;
      continue;
    }
    if (last === null) {
      if (line.trim() === "") continue;
      return { ok: false, reason: `The file does not start with a field. A file takes ${FILE_EXAMPLE}.` };
    }
    fields.set(last, `${fields.get(last)}\n${line}`);
  }
  const data = fields.get("data");
  if (!data?.trim()) return { ok: false, reason: `The file has no data. Send it as ${FILE_EXAMPLE}.` };
  const bytes = decodeAttachmentData(data);
  if (!bytes) return { ok: false, reason: "The file's data is not base64. Send the file's bytes base64-encoded in `data=`." };
  let entry: number | null = null;
  const entryValue = fields.get("entry")?.trim();
  if (options.withEntry) {
    if (!entryValue || !/^\d+$/.test(entryValue)) {
      return { ok: false, reason: "The file says no `entry=` — the place in `entries`, from 0, of the entry it goes with." };
    }
    entry = Number(entryValue);
    if (options.entries !== undefined && entry >= options.entries) {
      return { ok: false, reason: `\`entry=${entry}\` names no entry; "entries" carries ${options.entries}, numbered from 0.` };
    }
  } else if (entryValue !== undefined) {
    return { ok: false, reason: "`entry=` is for files sent with `add_conversation_entries`; this call names its entry itself." };
  }
  return { ok: true, spec: { name: fields.get("name")?.trim() ?? "", bytes, entry } };
}

/** One file of a call, answered. */
export type AgentAttachmentAnswer =
  | { readonly index: number; readonly entry?: number; readonly status: "attached"; readonly attachment: AgentConversationAttachment }
  | { readonly index: number; readonly entry?: number; readonly status: "refused"; readonly reason: string };

export interface AgentAttachmentBatch {
  readonly attached: number;
  readonly refused: number;
  readonly files: readonly AgentAttachmentAnswer[];
  /** The entry as it now stands, its files included. */
  readonly entry: AgentConversationEntry;
}

export function summarizeAttachmentBatch(
  answers: readonly AgentAttachmentAnswer[],
  entry: AgentConversationEntry
): AgentAttachmentBatch {
  return {
    attached: answers.filter((answer) => answer.status === "attached").length,
    refused: answers.filter((answer) => answer.status === "refused").length,
    files: answers,
    entry,
  };
}
