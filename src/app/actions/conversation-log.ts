"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  ConversationEntryError,
  createConversationEntries,
  deleteConversationEntry,
  updateConversationEntry,
  type ConversationEntryInput,
} from "@/lib/conversation-log";
import { isConversationChannel, isConversationDirection } from "@/lib/conversation-log-rules";
import { ConversationAttachmentError, removeConversationAttachment } from "@/lib/conversation-attachments";

// Server actions for the *Conversation* card (#2149): the collector adds, corrects and deletes
// entries by hand, and removes a file attached to one (#2150 — attaching is the upload route's).
// Thin wrappers over `conversation-log.ts` and `conversation-attachments.ts`, which hold every rule.

export type ConversationActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

/** The dialog's fields as an entry, or the sentence saying what is wrong. `occurredAt` arrives as an
 *  ISO instant: the dialog turns the clock time typed into one in the browser's own zone. */
function parseEntry(formData: FormData): ConversationEntryInput | string {
  const occurredAt = new Date(str(formData, "occurredAt"));
  if (Number.isNaN(occurredAt.getTime())) return "Enter when it was said.";
  const channel = str(formData, "channel");
  if (!isConversationChannel(channel)) return "Choose the channel it came through.";
  const direction = str(formData, "direction");
  if (!isConversationDirection(direction)) return "Choose who said it.";
  return {
    occurredAt,
    channel,
    direction,
    summary: str(formData, "summary"),
    quote: str(formData, "quote") || null,
    url: str(formData, "url") || null,
    saleId: str(formData, "saleId") || null,
  };
}

function failure(e: unknown, fallback: string): ConversationActionState {
  const known = e instanceof ConversationEntryError || e instanceof ConversationAttachmentError;
  return { status: "error", message: known ? e.message : fallback };
}

export async function createConversationEntryAction(
  contactId: string,
  formData: FormData
): Promise<ConversationActionState> {
  const session = await getSession();
  const input = parseEntry(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    await createConversationEntries(session.user.id, contactId, [input], "collector");
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to add the entry. Please try again.");
  }
}

export async function updateConversationEntryAction(
  entryId: string,
  formData: FormData
): Promise<ConversationActionState> {
  const session = await getSession();
  const input = parseEntry(formData);
  if (typeof input === "string") return { status: "error", message: input };
  try {
    await updateConversationEntry(session.user.id, entryId, input);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to save the entry. Please try again.");
  }
}

export async function deleteConversationEntryAction(entryId: string): Promise<ConversationActionState> {
  const session = await getSession();
  try {
    await deleteConversationEntry(session.user.id, entryId);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to delete the entry. Please try again.");
  }
}

export async function removeConversationAttachmentAction(attachmentId: string): Promise<ConversationActionState> {
  const session = await getSession();
  try {
    await removeConversationAttachment(session.user.id, attachmentId);
    return { status: "success" };
  } catch (e) {
    return failure(e, "Failed to remove the file. Please try again.");
  }
}
