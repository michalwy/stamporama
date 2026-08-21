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
import {
  refreshTradeRates,
  setTradeLineValue,
  type TradeLineValueInput,
} from "@/lib/trade-valuation";
import {
  createTradeShareToken,
  revokeTradeShareToken,
  setTradeShareOptions,
} from "@/lib/trade-share";
import { resolveTradeFeedback } from "@/lib/trade-feedback";
import { setTradeCopyBlock } from "@/lib/trade-candidates";
import {
  addTradeGiveLinesFromRequirement,
  type GiveRequirementReport,
} from "@/lib/trade-give-resolution";
import { parseGiveAxis, type GiveRequirement } from "@/lib/trade-give-resolution-rules";
import { setTradeLineFulfillment } from "@/lib/trade-realisation";
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

/** A **give** requirement as its dialog submits it (#659): what the partner asked for, not which
 *  copy answers it. The two optional axes carry three states, not two — see `GIVE_AXIS_ANY` and
 *  `GIVE_AXIS_NONE`: a wish list says nothing about a certificate, and reading that silence as *no
 *  certificate* would refuse the collector's only copy over a requirement nobody stated. */
export interface TradeGiveRequirementRaw {
  stampId: string;
  /** A **whole checklist** picked instead of a single stamp, as the receive side offers: it expands
   *  into one requirement per stamp on it, each resolved or reported as a gap of its own. */
  checklistId?: string;
  conditionId: string;
  certificateStatusId: string;
  formatId: string;
  quantity: string;
}

/** What the resolver came to, for the dialog's report. Gaps are carried, not thrown: *you do not
 *  hold this in this condition* is what the collector has to send back to the partner. */
export type AddGiveRequirementActionState =
  | ({ status: "success" } & GiveRequirementReport)
  | { status: "error"; message: string };

function parseGiveRequirement(
  raw: TradeGiveRequirementRaw
): { data: GiveRequirement & { checklistId?: string }; error?: string } {
  const stampId = raw.stampId.trim();
  const checklistId = raw.checklistId?.trim() ?? "";
  const blank = {} as GiveRequirement;
  if (!stampId && !checklistId) return { data: blank, error: "Pick the stamp you are giving." };
  if (!raw.conditionId.trim()) {
    return { data: blank, error: "Pick the condition the partner asked for." };
  }
  const quantity = Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { data: blank, error: "Quantity must be at least 1." };
  }
  return {
    data: {
      stampId,
      ...(checklistId ? { checklistId } : {}),
      conditionId: raw.conditionId.trim(),
      certificateStatusId: parseGiveAxis(raw.certificateStatusId),
      formatId: parseGiveAxis(raw.formatId),
      quantity: Math.trunc(quantity),
    },
  };
}

/**
 * Add give lines from a requirement (#659) — the resolver's screen half.
 *
 * A success can still be a list of gaps: nothing was served, nothing failed, and what the collector
 * needed to learn is that they do not hold it. Only a request that could not be *understood* — no
 * stamp, no condition, a locked trade — comes back as an error.
 */
export async function addTradeGiveLinesByStampAction(
  sectionId: string,
  raw: TradeGiveRequirementRaw
): Promise<AddGiveRequirementActionState> {
  const session = await getSession();
  const { data, error } = parseGiveRequirement(raw);
  if (error) return { status: "error", message: error };
  try {
    const report = await addTradeGiveLinesFromRequirement(session.user.id, sectionId, data);
    return { status: "success", ...report };
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

// ── The line's own figure (#638) ─────────────────────────────────────────────────────────────────

/** What the value dialog sends. Both fields are **explicitly optional**, so that "clear the manual
 *  value" (`null`) and "leave it alone" (absent) stay different instructions — the split
 *  `setTradeShipping` makes for the same reason. */
export interface TradeLineValueRaw {
  manualValue?: string | null;
  catalogVendorId?: string | null;
}

export async function setTradeLineValueAction(
  lineId: string,
  raw: TradeLineValueRaw
): Promise<TradeActionState> {
  const session = await getSession();
  const input: TradeLineValueInput = {};
  if (raw.manualValue !== undefined) {
    const typed = normalizeDecimalInput(raw.manualValue ?? "");
    if (!typed) {
      input.manualValue = null;
    } else {
      const value = Number(typed);
      if (!Number.isFinite(value)) {
        return { status: "error", message: "That is not a number I can read as a value." };
      }
      input.manualValue = value;
    }
  }
  if (raw.catalogVendorId !== undefined) input.catalogVendorId = raw.catalogVendorId;
  try {
    await setTradeLineValue(session.user.id, lineId, input);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to save the value. Please try again.") };
  }
}

// ── What actually happened (#642) ────────────────────────────────────────────────────────────────

/**
 * Record what became of one line — sent, arrived, withdrawn or never arrived, with the collector's
 * own words for why.
 *
 * The verdict and the note travel **together**, always both, which is the opposite of the value
 * action above: a note is why a line was struck off, so leaving one in place while the verdict
 * changed would be an explanation of something nobody is claiming any more.
 */
export async function setTradeLineFulfillmentAction(
  lineId: string,
  fulfillment: string,
  note: string | null
): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await setTradeLineFulfillment(session.user.id, lineId, { fulfillment, note });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: message(e, "Failed to record what happened. Please try again."),
    };
  }
}

// ── The alternatives to a give line (#657) ───────────────────────────────────────────────────────

/**
 * Hold one copy back from this trade's candidate pools, or offer it again.
 *
 * A **trade** and a **copy**, not a line: what the collector means is "this one is not going to this
 * person", and two lines of one trade sharing a key would otherwise need the same decision taken
 * twice. Idempotent in both directions, so the toggle is a plain write — see `setTradeCopyBlock`.
 */
export async function setTradeCopyBlockAction(
  tradeId: string,
  itemId: string,
  blocked: boolean
): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await setTradeCopyBlock(session.user.id, tradeId, itemId, blocked);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: message(e, "Failed to change what is offered. Please try again."),
    };
  }
}

/** Take today's rates for a trade still being negotiated. Refused by name anywhere else in the
 *  lifecycle — see `refreshTradeRates`. */
export async function refreshTradeRatesAction(tradeId: string): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await refreshTradeRates(session.user.id, tradeId);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to refresh rates. Please try again.") };
  }
}

// ── The partner's link (#640) ────────────────────────────────────────────────────────────────────

/** Minting is the one action that returns something the collector must act on immediately: the raw
 *  token, which is not stored and cannot be shown a second time. */
export type TradeShareLinkActionState =
  | { status: "success"; token: string }
  | { status: "error"; message: string };

/**
 * A day from a date input → the moment that day ends.
 *
 * End of the day rather than its start, because a collector who types a date means "good through
 * then". Blank means no expiry, which is the default and the common case.
 */
function parseExpiry(raw: string): Date | null {
  if (!raw) return null;
  const parsed = new Date(`${raw}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseShareOptions(formData: FormData) {
  return {
    showValues: str(formData, "showValues") === "true",
    expiresAt: parseExpiry(str(formData, "expiresAt")),
  };
}

/** Generate the trade's link, replacing any it had. Regeneration is the same act, because a trade has
 *  one link and asking for a new one is asking for the old one to stop working. */
export async function createTradeShareLinkAction(
  tradeId: string,
  formData: FormData
): Promise<TradeShareLinkActionState> {
  const session = await getSession();
  try {
    const { token } = await createTradeShareToken(
      session.user.id,
      tradeId,
      parseShareOptions(formData)
    );
    return { status: "success", token };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to create the link. Please try again.") };
  }
}

/** Change what the existing link shows without changing the address — turning the figures off on a
 *  list the partner is already reading must not break their link. */
export async function setTradeShareOptionsAction(
  tradeId: string,
  formData: FormData
): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await setTradeShareOptions(session.user.id, tradeId, parseShareOptions(formData));
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to update the link. Please try again.") };
  }
}

export async function revokeTradeShareLinkAction(tradeId: string): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await revokeTradeShareToken(session.user.id, tradeId);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to withdraw the link. Please try again.") };
  }
}

// ── The partner's answers (#641) ─────────────────────────────────────────────────────────────────

/**
 * Deal with one thing the partner said: act on it, or decide against it.
 *
 * Accepting a **rejection** is the one act here that touches the list — the line comes off it — and
 * it is refused by name while the list is locked, with the step that would unlock it. Everything else
 * only records what the collector decided, which is what empties the inbox and, with it, clears the
 * derived *Partner has responded* badge.
 */
export async function resolveTradeFeedbackAction(
  feedbackId: string,
  action: "accept" | "dismiss"
): Promise<TradeActionState> {
  const session = await getSession();
  try {
    await resolveTradeFeedback(session.user.id, feedbackId, action);
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: message(e, "Failed to update the feedback. Please try again.") };
  }
}
