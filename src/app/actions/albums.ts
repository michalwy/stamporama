"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  addAlbumEntry,
  addAlbumTextBlock,
  clearAlbumBoxAdjustments,
  clearAlbumEntryStampOrder,
  createAlbum,
  deleteAlbum,
  deleteAlbumTextBlock,
  gatherAlbumEntries,
  getAlbumEntries,
  removeAlbumEntry,
  reorderAlbumEntries,
  reorderAlbumTextBlocks,
  reseedAlbumFromTemplate,
  setAlbumBoxAdjustment,
  setAlbumEntryLayout,
  setAlbumEntryStampOrder,
  updateAlbum,
  updateAlbumTextBlock,
  AlbumNameTakenError,
  type AlbumBlockLayoutInput,
  type AlbumEntryData,
} from "@/lib/albums";
import {
  asAlbumBlockBreak,
  asAlbumTextBlockSide,
  asAlbumTextRole,
  parseAlbumCorrectionMm,
  ALBUM_BOX_DELTA_MAX_MM,
  ALBUM_BOX_DELTA_MIN_MM,
  ALBUM_SPACE_MAX_MM,
  ALBUM_SPACE_MIN_MM,
} from "@/lib/album-corrections";
import {
  cancelAlbumReprint,
  closeAlbumContinuation,
  describeAlbumUnprint,
  markAlbumPagesPrinted,
  openAlbumContinuation,
  reprintAlbumPage,
  unprintAlbumPage,
  AlbumPrintError,
} from "@/lib/album-printing";

// Server actions for albums (#767), `actions/hawid-stock.ts`'s shape: `FormData` in, a state out,
// every rule in the library beneath.

export type AlbumActionState =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** A duplicate name is reported in its own words — an album is printed by name, so two of one name
 *  is worth a sentence rather than a "please try again". */
function toErrorState(err: unknown, fallback: string): AlbumActionState {
  if (err instanceof AlbumNameTakenError) return { status: "error", message: err.message };
  // A printing refusal always says something the collector has to act on — a stale listing, half a
  // checklist chosen, a sheet already on paper — so its own words reach them rather than a "please
  // try again" they cannot act on.
  if (err instanceof AlbumPrintError) return { status: "error", message: err.message };
  return { status: "error", message: fallback };
}

function readAlbumForm(formData: FormData) {
  const str = (key: string) => ((formData.get(key) as string | null) ?? "").trim();
  return {
    name: str("name"),
    collectionAreaId: str("collectionAreaId"),
    language: str("language"),
    templateId: str("templateId") || null,
  };
}

export async function createAlbumAction(
  collectionId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const input = readAlbumForm(formData);
  if (!input.name) return { status: "error", message: "Name is required." };
  if (!input.collectionAreaId) return { status: "error", message: "An area is required." };
  if (!input.language) return { status: "error", message: "A language is required." };
  try {
    await createAlbum(
      session.user.id,
      collectionId,
      { name: input.name, collectionAreaId: input.collectionAreaId, language: input.language },
      input.templateId
    );
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to create the album. Please try again.");
  }
}

export async function updateAlbumAction(
  albumId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const input = readAlbumForm(formData);
  if (!input.name) return { status: "error", message: "Name is required." };
  if (!input.language) return { status: "error", message: "A language is required." };
  try {
    await updateAlbum(session.user.id, albumId, {
      name: input.name,
      language: input.language,
    });
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the album. Please try again.");
  }
}

/** Re-seed the album's render values from a template — a **copy**, again (#308): nothing links back,
 *  and the album stays free to be edited away from where it started. */
export async function reseedAlbumAction(
  albumId: string,
  templateId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await reseedAlbumFromTemplate(session.user.id, albumId, templateId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to apply the template. Please try again." };
  }
}

export async function deleteAlbumAction(albumId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await deleteAlbum(session.user.id, albumId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the album. Please try again." };
  }
}

/** Pick up checklists that have appeared in the area since the album was made. Additive: nothing an
 *  entry says is removed, because an entry is a decision about a card. */
export async function gatherAlbumEntriesAction(albumId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    const added = await gatherAlbumEntries(session.user.id, albumId);
    return {
      status: "success",
      message:
        added === 0
          ? "No new checklists in this area."
          : added === 1
            ? "One checklist added."
            : `${added} checklists added.`,
    };
  } catch {
    return { status: "error", message: "Failed to gather entries. Please try again." };
  }
}

export async function addAlbumEntryAction(
  albumId: string,
  checklistId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await addAlbumEntry(session.user.id, albumId, checklistId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to add the checklist. Please try again." };
  }
}

export async function removeAlbumEntryAction(entryId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await removeAlbumEntry(session.user.id, entryId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to remove the entry. Please try again." };
  }
}

export async function reorderAlbumEntriesAction(
  albumId: string,
  orderedIds: string[]
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await reorderAlbumEntries(session.user.id, albumId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder the entries. Please try again." };
  }
}

/** Give one entry an order of its own. Written whole — a partial override cannot define an order. */
export async function setAlbumEntryStampOrderAction(
  entryId: string,
  orderedStampIds: string[]
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await setAlbumEntryStampOrder(session.user.id, entryId, orderedStampIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the order. Please try again." };
  }
}

/** Return an entry to the checklist's own order (#764). Deleting the rows *is* the reset. */
export async function clearAlbumEntryStampOrderAction(
  entryId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await clearAlbumEntryStampOrder(session.user.id, entryId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reset the order. Please try again." };
  }
}

export async function getAlbumEntriesAction(albumId: string): Promise<AlbumEntryData[]> {
  const session = await getSession();
  return getAlbumEntries(session.user.id, albumId);
}

// -- Printed sheets (#778) ----------------------------------------------------

/**
 * Say that these sheets went onto paper.
 *
 * **A deliberate act, never a side effect.** Downloading the PDF marks nothing: a draft is generated
 * to be looked at, and an album that froze itself on the first preview would be a trap.
 *
 * `sheets` are positions in the listing on screen and `fingerprint` is that listing's own — a
 * position means something only against the plan that produced it, and this is a write, so a plan
 * that has moved since is refused rather than frozen at the wrong places.
 */
export async function markAlbumPagesPrintedAction(
  albumId: string,
  sheets: number[],
  fingerprint: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    const { ranges } = await markAlbumPagesPrinted(session.user.id, albumId, sheets, fingerprint);
    return {
      status: "success",
      message:
        ranges.length === 1
          ? `${ranges[0] || "One sheet"} is now a printed card.`
          : `${ranges.length} sheets are now printed cards.`,
    };
  } catch (err) {
    return toErrorState(err, "Failed to mark the sheets printed. Please try again.");
  }
}

/** What un-printing will throw away, said **before** it is done. */
export async function describeAlbumUnprintAction(printedPageId: string): Promise<string[]> {
  const session = await getSession();
  try {
    return await describeAlbumUnprint(session.user.id, printedPageId);
  } catch {
    return ["This sheet cannot be read; un-printing it will discard whatever it holds."];
  }
}

export async function unprintAlbumPageAction(printedPageId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await unprintAlbumPage(session.user.id, printedPageId);
    return { status: "success", message: "The stored sheet is gone; its checklists are back in the plan." };
  } catch (err) {
    return toErrorState(err, "Failed to un-print the sheet. Please try again.");
  }
}

/** Answer a divergence with a reprint. Takes the card's **own identity**, never a position. */
export async function reprintAlbumPageAction(printedPageId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await reprintAlbumPage(session.user.id, printedPageId);
    return {
      status: "success",
      message:
        "This card is back in the plan and will be re-planned in full. The stored sheet stands until " +
        "the replacement is marked printed in its turn.",
    };
  } catch (err) {
    return toErrorState(err, "Failed to start the reprint. Please try again.");
  }
}

export async function cancelAlbumReprintAction(printedPageId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await cancelAlbumReprint(session.user.id, printedPageId);
    return { status: "success", message: "The card in the binder stands; nothing was discarded." };
  } catch (err) {
    return toErrorState(err, "Failed to cancel the reprint. Please try again.");
  }
}

/** Answer a divergence with a continuation page: the stamps on no sheet yet get one of their own. */
export async function openAlbumContinuationAction(
  entryId: string,
  printedPageId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await openAlbumContinuation(session.user.id, entryId, printedPageId);
    return {
      status: "success",
      message: "A continuation sheet is now in the plan, filed after the card it continues.",
    };
  } catch (err) {
    return toErrorState(err, "Failed to open a continuation page. Please try again.");
  }
}

export async function closeAlbumContinuationAction(entryId: string): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await closeAlbumContinuation(session.user.id, entryId);
    return { status: "success", message: "The continuation is withdrawn." };
  } catch (err) {
    return toErrorState(err, "Failed to withdraw the continuation. Please try again.");
  }
}

// ── The page editor's corrections (#769) ─────────────────────────────────────
//
// Every one of these stores a **delta** against what the automatic layout produced, never a
// position. That is what lets a correction survive the next stamp the collector buys, and it is why
// there is no "save the page" action anywhere below: a page is a derivation with no row (ADR-0045
// §3), so there is nothing to save.
//
// The millimetres arrive as **strings**, through the same parser the field uses, because a collector
// typing `2,5` means `2.5` everywhere else in this app and a `number` on the wire would have already
// lost that. Blank reads as zero: clearing the field is how a correction is taken back.

/** One millimetre field, parsed and bounded, or the message the collector reads. */
function readCorrectionMm(
  raw: string | null,
  label: string,
  min: number,
  max: number
): { ok: true; value: number | undefined } | { ok: false; message: string } {
  // Absent is **not** zero: a drag that moved one handle sends one field, and a whole-object save
  // would let an untouched field overwrite a correction made a second earlier on the canvas.
  if (raw === null) return { ok: true, value: undefined };
  const parsed = parseAlbumCorrectionMm(raw, label, min, max);
  return parsed.ok ? { ok: true, value: parsed.value } : parsed;
}

function readBlockLayout(
  formData: FormData
): { ok: true; value: AlbumBlockLayoutInput } | { ok: false; message: string } {
  const raw = (key: string) => formData.get(key) as string | null;
  const before = readCorrectionMm(
    raw("spaceBeforeMm"),
    "Space before",
    ALBUM_SPACE_MIN_MM,
    ALBUM_SPACE_MAX_MM
  );
  if (!before.ok) return before;
  const after = readCorrectionMm(
    raw("spaceAfterMm"),
    "Space after",
    ALBUM_SPACE_MIN_MM,
    ALBUM_SPACE_MAX_MM
  );
  if (!after.ok) return after;
  const breakRaw = raw("breakBefore");
  return {
    ok: true,
    value: {
      spaceBeforeMm: before.value,
      spaceAfterMm: after.value,
      breakBefore: breakRaw === null ? undefined : asAlbumBlockBreak(breakRaw),
    },
  };
}

/** Space before, space after, and where a page may break above one checklist. */
export async function setAlbumEntryLayoutAction(
  entryId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const layout = readBlockLayout(formData);
  if (!layout.ok) return { status: "error", message: layout.message };
  try {
    await setAlbumEntryLayout(session.user.id, entryId, layout.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Could not change how this block is laid out.");
  }
}

/**
 * Correct one box's size, or take the correction back with two blanks.
 *
 * The height moves in **strip steps** (#765): the figure typed here is millimetres on the piece, and
 * the box is still the shortest strip in the drawer that piece fits into. That is deliberate and is
 * why the screen redraws to something other than what was dragged — a box drawn at a height no strip
 * has is a page that disagrees with the hawid on the desk.
 */
export async function setAlbumBoxAdjustmentAction(
  entryId: string,
  stampId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const width = parseAlbumCorrectionMm(
    ((formData.get("widthDeltaMm") as string | null) ?? "").trim(),
    "Width",
    ALBUM_BOX_DELTA_MIN_MM,
    ALBUM_BOX_DELTA_MAX_MM
  );
  if (!width.ok) return { status: "error", message: width.message };
  const height = parseAlbumCorrectionMm(
    ((formData.get("heightDeltaMm") as string | null) ?? "").trim(),
    "Height",
    ALBUM_BOX_DELTA_MIN_MM,
    ALBUM_BOX_DELTA_MAX_MM
  );
  if (!height.ok) return { status: "error", message: height.message };
  try {
    await setAlbumBoxAdjustment(session.user.id, entryId, stampId, {
      widthDeltaMm: width.value,
      heightDeltaMm: height.value,
    });
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Could not correct that box.");
  }
}

export async function clearAlbumBoxAdjustmentsAction(
  entryId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await clearAlbumBoxAdjustments(session.user.id, entryId);
    return { status: "success", message: "Every box on that checklist is back to its cut size." };
  } catch (err) {
    return toErrorState(err, "Could not undo those corrections.");
  }
}

// ── The collector's own notes (#769) ─────────────────────────────────────────

export async function addAlbumTextBlockAction(
  albumId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const anchor = ((formData.get("anchorAlbumEntryId") as string | null) ?? "").trim();
  const text = ((formData.get("text") as string | null) ?? "").trim();
  if (!text) return { status: "error", message: "A note needs something in it." };
  try {
    await addAlbumTextBlock(session.user.id, albumId, {
      anchorAlbumEntryId: anchor || null,
      side: asAlbumTextBlockSide(((formData.get("side") as string | null) ?? "").trim()),
      role: asAlbumTextRole(((formData.get("role") as string | null) ?? "").trim()),
      text,
    });
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Could not add that note.");
  }
}

export async function updateAlbumTextBlockAction(
  textBlockId: string,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  const layout = readBlockLayout(formData);
  if (!layout.ok) return { status: "error", message: layout.message };
  const text = formData.get("text") as string | null;
  const role = formData.get("role") as string | null;
  const anchor = formData.get("anchorAlbumEntryId") as string | null;
  const side = formData.get("side") as string | null;
  if (text !== null && !text.trim()) {
    return { status: "error", message: "A note needs something in it." };
  }
  try {
    await updateAlbumTextBlock(session.user.id, textBlockId, {
      ...layout.value,
      ...(text === null ? {} : { text: text.trim() }),
      ...(role === null ? {} : { role: asAlbumTextRole(role.trim()) }),
      ...(anchor === null ? {} : { anchorAlbumEntryId: anchor.trim() || null }),
      ...(side === null ? {} : { side: asAlbumTextBlockSide(side.trim()) }),
    });
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Could not change that note.");
  }
}

export async function deleteAlbumTextBlockAction(
  textBlockId: string
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await deleteAlbumTextBlock(session.user.id, textBlockId);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Could not remove that note.");
  }
}

export async function reorderAlbumTextBlocksAction(
  albumId: string,
  anchorAlbumEntryId: string | null,
  side: string,
  orderedIds: string[]
): Promise<AlbumActionState> {
  const session = await getSession();
  try {
    await reorderAlbumTextBlocks(
      session.user.id,
      albumId,
      anchorAlbumEntryId,
      asAlbumTextBlockSide(side),
      orderedIds
    );
    return { status: "success" };
  } catch {
    return { status: "error", message: "Could not reorder those notes." };
  }
}
