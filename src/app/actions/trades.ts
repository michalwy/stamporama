"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createTrade,
  updateTrade,
  setTradeStatus,
  setTradeShipping,
  deleteTrade,
  createTradeSection,
  updateTradeSection,
  renameTradeSection,
  reorderTradeSections,
  deleteTradeSection,
  type TradeCreateInput,
  type TradeSectionInput,
} from "@/lib/trades";
import {
  addTradeGiveLines,
  addTradeReceiveLines,
  updateTradeReceiveLine,
  deleteTradeLine,
  type GiveLineRefusal,
  type TradeReceiveLineInput,
} from "@/lib/trade-lines";
import { isTradeStatus, type TradeStatus } from "@/lib/trade-rules";
import { normalizeDecimalInput } from "@/lib/decimal-input";

// Server actions for trades (#646; ADR-0039). Thin: they parse the form, call the domain and turn a
// thrown error into a message the dialog can show. Every rule they appear to enforce — the legal
// transitions, the `agreed` lock, the one-section minimum — actually lives in `lib/trades.ts` and
// `lib/trade-rules.ts`, because the API route and the later screens in this track go through the
// same functions.

export type TradeActionState =
  | { status: "success" }
  | { status: "error"; message: string };

/** Create returns the new trade's id so the caller can go straight to it. */
export type CreateTradeActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function optionalStr(formData: FormData, key: string): string | null {
  return str(formData, key) || null;
}

/** A percentage from the form → a non-negative number, or the fallback when blank/unreadable. */
function parsePercent(raw: string, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(normalizeDecimalInput(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function parseCount(raw: string, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** The trade header from the dialog form. Its sections and lines are not captured here — they are
 * the trade screen's job (#637). */
function parseFields(formData: FormData): { data: TradeCreateInput; error?: string } {
  const currency = str(formData, "currency");
  if (!currency) {
    return { data: {} as TradeCreateInput, error: "A currency is required." };
  }
  if (!str(formData, "partnerId") && !str(formData, "partnerName")) {
    return { data: {} as TradeCreateInput, error: "An exchange partner is required." };
  }

  return {
    data: {
      partnerId: optionalStr(formData, "partnerId"),
      partnerName: optionalStr(formData, "partnerName"),
      currency,
      notes: optionalStr(formData, "notes"),
      catalogVendorId: optionalStr(formData, "catalogVendorId"),
      balanceByValue: str(formData, "balanceByValue") === "true",
      countTolerance: parseCount(str(formData, "countTolerance"), 0),
      valueTolerancePct: parsePercent(str(formData, "valueTolerancePct"), 0),
      ownValueWarnPct: parsePercent(str(formData, "ownValueWarnPct"), 25),
    },
  };
}

export async function createTradeAction(
  collectionId: string,
  formData: FormData
): Promise<CreateTradeActionState> {
  const session = await getSession();
  const { data, error } = parseFields(formData);
  if (error) return { status: "error", message: error };
  try {
    const trade = await createTrade(session.user.id, collectionId, data);
    return { status: "success", id: trade.id };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to create trade. Please try again.") };
  }
}

export async function updateTradeAction(
  tradeId: string,
  formData: FormData
): Promise<TradeActionState> {
  const session = await getSession();
  const { data, error } = parseFields(formData);
  if (error) return { status: "error", message: error };
  try {
    await updateTrade(session.user.id, tradeId, data);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to save trade. Please try again.") };
  }
}

/** Move a trade along its lifecycle. An illegal transition comes back named, never as a no-op. */
export async function setTradeStatusAction(
  tradeId: string,
  status: TradeStatus
): Promise<TradeActionState> {
  const session = await getSession();
  if (!isTradeStatus(status)) {
    return { status: "error", message: "Unknown trade status." };
  }
  try {
    await setTradeStatus(session.user.id, tradeId, status);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to update status. Please try again.") };
  }
}

/**
 * Record that a parcel went out, or that one arrived — or take the mark back.
 *
 * `null` clears the timestamp and `undefined` leaves it alone, which is why the two arrive as
 * explicit optional fields rather than as a date each: "not sent yet" and "don't touch sent" are
 * different instructions and a single nullable argument could only say one of them.
 */
export async function setTradeShippingAction(
  tradeId: string,
  shipping: { sentAt?: string | null; receivedAt?: string | null }
): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await setTradeShipping(session.user.id, tradeId, {
      ...(shipping.sentAt !== undefined ? { sentAt: parseStamp(shipping.sentAt) } : {}),
      ...(shipping.receivedAt !== undefined
        ? { receivedAt: parseStamp(shipping.receivedAt) }
        : {}),
    });
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to record shipping. Please try again.") };
  }
}

/** A yyyy-mm-dd from a date input, read at UTC midnight so the stored day is the day picked
 * whatever the server's timezone — the same rule `purchasedAt` follows. `null` clears the mark. */
function parseStamp(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date.");
  return d;
}

export async function deleteTradeAction(tradeId: string): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await deleteTrade(session.user.id, tradeId);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to delete trade. Please try again.") };
  }
}

// ── Sections ─────────────────────────────────────────────────────────────────────────────────────

/** A section's balance rule from a form: `balanceMode` is `inherit` (the whole rule comes from the
 * trade) or `own` (this section states all four). Never a per-field fallback — see
 * `resolveBalanceRule`. */
function parseSectionFields(formData: FormData): { data: TradeSectionInput; error?: string } {
  const name = str(formData, "name");
  if (!name) return { data: {} as TradeSectionInput, error: "A section name is required." };

  if (str(formData, "balanceMode") !== "own") {
    return { data: { name, balanceByValue: null } };
  }
  return {
    data: {
      name,
      balanceByValue: str(formData, "balanceByValue") === "true",
      countTolerance: parseCount(str(formData, "countTolerance"), 0),
      valueTolerancePct: parsePercent(str(formData, "valueTolerancePct"), 0),
      ownValueWarnPct: str(formData, "ownValueWarnPct")
        ? parsePercent(str(formData, "ownValueWarnPct"), 0)
        : null,
    },
  };
}

export async function createTradeSectionAction(
  tradeId: string,
  formData: FormData
): Promise<TradeActionState> {
  const session = await getSession();
  const { data, error } = parseSectionFields(formData);
  if (error) return { status: "error", message: error };
  try {
    await createTradeSection(session.user.id, tradeId, data);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to add section. Please try again.") };
  }
}

export async function updateTradeSectionAction(
  sectionId: string,
  formData: FormData
): Promise<TradeActionState> {
  const session = await getSession();
  const { data, error } = parseSectionFields(formData);
  if (error) return { status: "error", message: error };
  try {
    await updateTradeSection(session.user.id, sectionId, data);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to save section. Please try again.") };
  }
}

/** In-place rename from the section's own heading. Deliberately not `updateTradeSectionAction`:
 *  that one rewrites the balance override as a unit, and a rename must not touch it. */
export async function renameTradeSectionAction(
  sectionId: string,
  name: string
): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await renameTradeSection(session.user.id, sectionId, name);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to rename section. Please try again.") };
  }
}

export async function reorderTradeSectionsAction(
  tradeId: string,
  orderedIds: string[]
): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await reorderTradeSections(session.user.id, tradeId, orderedIds);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to reorder sections. Please try again.") };
  }
}

export async function deleteTradeSectionAction(sectionId: string): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await deleteTradeSection(session.user.id, sectionId);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to delete section. Please try again.") };
  }
}

// ── Lines (#637) ─────────────────────────────────────────────────────────────────────────────────
//
// Two shapes, because the sides are two shapes: the give side takes a list of copy ids from a
// checkbox picker, the receive side takes `Want`'s key from a form. Everything they appear to
// enforce — the `agreed` lock, what may be promised, which side may be restated — lives in
// `lib/trade-lines.ts`.

/** What a bulk add of copies came to. Refusals are **named, not counted**: "already promised to
 *  trade #4" is something the collector can act on, where "3 skipped" is not. */
export type AddGiveLinesActionState =
  | { status: "success"; added: number; refused: GiveLineRefusal[] }
  | { status: "error"; message: string };

export async function addTradeGiveLinesAction(
  sectionId: string,
  itemIds: string[]
): Promise<AddGiveLinesActionState> {
  const session = await getSession();
  try {
    const result = await addTradeGiveLines(session.user.id, sectionId, itemIds);
    return { status: "success", ...result };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to add copies. Please try again.") };
  }
}

/** The receive line as its dialog submits it — the auction lot line's shape, because it is the same
 *  question asked of the same kind of material: a blank certificate is *no certificate* (ADR-0006
 *  §2) and a blank format is the single (ADR-0020). */
export interface TradeReceiveLineRaw {
  stampId: string;
  /** A **whole checklist** picked instead of a single stamp, as the auction lot line offers: it
   *  expands into one line per stamp on it. Blank for a plain pick, and never set when editing — an
   *  edit that turned one line into twelve is not an edit. */
  checklistId?: string;
  conditionId: string;
  certificateStatusId: string;
  formatId: string;
  quantity: string;
}

function parseReceiveLine(
  raw: TradeReceiveLineRaw
): { data: TradeReceiveLineInput & { checklistId?: string }; error?: string } {
  const stampId = raw.stampId.trim();
  const checklistId = raw.checklistId?.trim() ?? "";
  if (!stampId && !checklistId) {
    return { data: {} as TradeReceiveLineInput, error: "Pick the stamp this line is about." };
  }
  if (!raw.conditionId.trim()) {
    return {
      data: {} as TradeReceiveLineInput,
      error: "Pick the condition this line is described in.",
    };
  }
  const quantity = Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { data: {} as TradeReceiveLineInput, error: "Quantity must be at least 1." };
  }
  return {
    data: {
      stampId,
      ...(checklistId ? { checklistId } : {}),
      conditionId: raw.conditionId.trim(),
      certificateStatusId: raw.certificateStatusId.trim() || null,
      formatId: raw.formatId.trim() || null,
      quantity: Math.trunc(quantity),
    },
  };
}

/** One stamp gives one line; a whole checklist gives one per stamp on it. */
export async function addTradeReceiveLineAction(
  sectionId: string,
  raw: TradeReceiveLineRaw
): Promise<TradeActionState> {
  const session = await getSession();
  const { data, error } = parseReceiveLine(raw);
  if (error) return { status: "error", message: error };
  try {
    await addTradeReceiveLines(session.user.id, sectionId, data);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to add line. Please try again.") };
  }
}

export async function updateTradeReceiveLineAction(
  lineId: string,
  raw: TradeReceiveLineRaw
): Promise<TradeActionState> {
  const session = await getSession();
  const { data, error } = parseReceiveLine(raw);
  if (error) return { status: "error", message: error };
  try {
    await updateTradeReceiveLine(session.user.id, lineId, data);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to save line. Please try again.") };
  }
}

export async function deleteTradeLineAction(lineId: string): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await deleteTradeLine(session.user.id, lineId);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to remove line. Please try again.") };
  }
}
