"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog, DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import {
  ALBUM_PRESET_DIALOG_HEIGHT,
  ALBUM_PRESET_DIALOG_WIDTH,
  AlbumPresetForm,
} from "@/app/c/[collectionSlug]/settings/album-templates-panel";
import {
  cancelAlbumReprintAction,
  clearAlbumEntryStampOrderAction,
  closeAlbumContinuationAction,
  describeAlbumUnprintAction,
  gatherAlbumEntriesAction,
  markAlbumPagesPrintedAction,
  openAlbumContinuationAction,
  removeAlbumEntryAction,
  reorderAlbumEntriesAction,
  setAlbumEntryLayoutAction,
  reprintAlbumPageAction,
  unprintAlbumPageAction,
  updateAlbumPresetAction,
  type AlbumActionState,
} from "@/app/actions/albums";
import type { AlbumData, AlbumEntryData } from "@/lib/albums";
import type { AlbumPlanOverview } from "@/lib/album-plan";
import type { AlbumSheetSketch, AlbumSheetSummary } from "@/lib/album-editor";
import {
  ALBUM_VIEW_PARAM,
  albumChapterRuns,
  albumScreenSummary,
  albumScreenViewQuery,
  cardMatchesFilter,
  entryChapterKey,
  needsAttention,
  NO_ATTENTION,
  parseAlbumScreenView,
  sheetMatchesFilter,
  type AlbumCardFilter,
  type AlbumChapterRun,
  type AlbumScreenView,
  type AlbumSheetAttention,
  type AlbumSheetFilter,
} from "@/lib/album-screen-view";
import type { AlbumPrintedReport } from "@/lib/album-printing";
import type { AlbumDivergenceKind } from "@/lib/album-divergence";
import { languageLabel } from "@/lib/languages";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { AlbumNameSuggestion } from "./album-name-suggestion";
import { MarkPrintedDialog } from "./mark-printed-dialog";
import { ALBUM_PRINT_MODE_DEFAULTS_HINT, PrintModeSelect } from "./print-mode-select";
import {
  albumEffectivePrintModes,
  albumPrintModeOffered,
  type AlbumPrintMode,
} from "@/lib/album-print-mode";
import { albumYearAloneName } from "@/lib/album-print-rules";
import { CELL_GLYPH } from "@/app/c/[collectionSlug]/shared/cell-target";

// One album (#767): what it prints, in what order, and how that falls onto sheets.
//
// Laid out across the whole window (#1430): a **summary strip** saying where the album stands, the
// album's actions in the header, and three tabs. **Sheets** (the default) is what the plan makes of
// the entries and is edited nowhere — a page is a derivation of current data, re-planned whenever
// anything it reads changes, and only a page marked printed (#778) ever stops being one. **Entries**
// is the order the album reads in and is edited here. **Printed cards** (#778) reports how each card
// in the binder differs from what the data would now produce and never resolves any of it. Sheets and
// entries are grouped into the plan's chapters (`album-screen-view.ts` says why those are runs, not
// year buckets); the tab, the filters and the folded chapters live in the address.
//
// Every figure on the strip is a sum of the per-sheet numbers the rows show, and those are the page
// editor's own flags counted off the sheet as the editor draws it (`albumSheetSummaries`) — so the
// strip, a row and the editor cannot disagree. The printed-card figure is the report's.
//
// There is deliberately **no "what changed since last time"** here. A live page reshuffling harms
// nothing — that is exactly what makes it live — so a live-versus-previous-live diff has no customer.
// The only comparison anyone can act on is against paper, and that is the Printed cards tab.
//
// Two rules the screen has to keep, because both are easy to lose in a component:
//
// - **Marking a sheet printed is its own gesture.** Downloading the PDF marks nothing; an album that
//   froze itself on the first preview would be a trap.
// - **A card may state only what stays true of the objects it describes.** The flags on a live sheet
//   — *N in a pocket*, *N sized from a neighbour* — are exactly the staleness-prone kind that may not
//   be printed, and they are shown here deliberately: they are shown *about* a sheet, on screen,
//   before it is printed, and never go onto the paper.
//
// The standing explanations this screen used to print as paragraphs are hints beside what they
// explain now, and the user guide carries them in full. The one that stays in plain sight is *print at
// 100 %* beside Download PDF, because getting that wrong ruins a card and nothing on it shows.

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  overflow: "hidden",
};

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const DOWNLOAD_BTN: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  background: "transparent",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

/** The print mode in an entry row (#1509) — the page editor's field, sized for a row. */
const PRINT_MODE_SELECT: React.CSSProperties = {
  padding: "0.1875rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  maxWidth: "18rem",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

/** The divergence kinds, in the words the collector reads them in. Ranked in
 *  `ALBUM_DIVERGENCE_KINDS`; a picture arriving after the fact is last there and last here. */
const PRIMARY_BTN: React.CSSProperties = {
  ...DOWNLOAD_BTN,
  background: "var(--color-action-primary)",
  borderColor: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};

const WARN_CHIP: React.CSSProperties = {
  ...CHIP,
  borderColor: "var(--color-warning-border)",
  background: "var(--color-warning-soft)",
  color: "var(--color-warning)",
};

/** A standing explanation, one hover away (#1430): muted, dotted, beside what it explains. */
const HINT: React.CSSProperties = {
  ...MUTED,
  fontSize: "0.75rem",
  textDecoration: "underline dotted",
  textUnderlineOffset: "0.2em",
  cursor: "help",
};

/** A figure on the summary strip — it opens the tab and filter that shows what it counts. */
const FIGURE_BTN: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--color-accent)",
  fontSize: "0.875rem",
  cursor: "pointer",
  textAlign: "left",
};

/** Paper is paper in either theme — the page editor's canvas draws it the same way. */
const THUMB_PAPER = "#ffffff";
const THUMB_EDGE = "#c9c9c9";
const THUMB_INK = "#111111";
const THUMB_TEXT = "#a3a3a3";
const THUMB_FLAG = "#b45309";
const THUMB_WIDTH_PX = 56;

const TAB_LABEL = { sheets: "Sheets", entries: "Entries", printed: "Printed cards" } as const;

const SHEET_FILTER_LABEL: Record<AlbumSheetFilter, string> = {
  all: "All",
  attention: "Needs attention",
  live: "Live",
  printed: "Printed",
};

const DIVERGENCE_LABEL: Record<AlbumDivergenceKind, string> = {
  stamps: "Stamps",
  size: "Size",
  text: "Text",
  page: "Page",
  template: "Template",
  photo: "Picture",
};

interface AlbumScreenProps {
  collectionSlug: string;
  album: AlbumData;
  entries: AlbumEntryData[];
  initialOverview: AlbumPlanOverview;
  /** One per sheet of `initialOverview.pages`, in the same order: its thumbnail and its flags. */
  sheets: AlbumSheetSummary[];
  printedReport: AlbumPrintedReport;
  /** The area's name in the album's language, offered in place of the default-language name (#1311). */
  nameSuggestion: string | null;
}

export function AlbumScreen({
  collectionSlug,
  album,
  entries,
  initialOverview,
  sheets,
  printedReport,
  nameSuggestion,
}: AlbumScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseAlbumScreenView(searchParams);
  // Local ordering for optimistic drag-and-drop, re-synced from the server on refresh — the hawid
  // stock panel's pattern, and the plan comes back with it.
  const [items, setItems] = useState(entries);
  const [syncedFrom, setSyncedFrom] = useState(entries);
  // What each entry prints as with nothing chosen (#1509), which the row's select names as the
  // default. The rule is pure and reads the whole album, so the screen asks it rather than the server.
  const defaultPrintModes = albumEffectivePrintModes(
    entries.map((e) => ({ ...e, printMode: null }))
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AlbumEntryData | null>(null);
  const [markPrinted, setMarkPrinted] = useState<{
    sheets: number[];
    label: string;
    together?: boolean;
    /** The year's own sheet ahead of the run, left live by this mark (#1498). */
    yearApart?: string | null;
  } | null>(null);
  const [unprint, setUnprint] = useState<{ id: string; range: string } | null>(null);
  // Keyed by the card it describes rather than cleared when the dialog closes: what is being thrown
  // away is what *that* card kept, and a stale account of a different one is exactly the sentence a
  // collector would act on without reading.
  const [unprintSays, setUnprintSays] = useState<{ id: string; says: string[] } | null>(null);
  // The album's own template values (#1215). The form stays uncontrolled, as the template's does, so
  // the save and the preview read one `FormData`; `presetConfirm` is the count the server asked about.
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetConfirm, setPresetConfirm] = useState<number | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const presetFormRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  if (syncedFrom !== entries) {
    setSyncedFrom(entries);
    setItems(entries);
  }

  // The whole album, or one sheet by its **position in the list below** (#768). A position is not a
  // sheet's identity — that is its catalog range, and it never becomes a number — but asking for a
  // sheet is a different act from naming one: this number is true for the listing on screen right
  // now, and it is never printed onto anything.
  /**
   * What can be done to one card in the binder.
   *
   * The two answers to a divergence are here side by side and neither is a default: **a continuation
   * page** for one of its checklists, or **a reprint** of the whole card. Un-printing is a third
   * thing and sits below a divider — it throws the stored sheet away rather than replacing it.
   */
  function printedCardActions(sheet: AlbumPrintedReport["sheets"][number]): RowAction[] {
    return [
      sheet.reprinting
        ? {
            key: "cancel",
            label: "Keep the card in the binder",
            icon: "revert",
            hint: "Its checklists leave the plan again; nothing was discarded",
            onSelect: () => run(() => cancelAlbumReprintAction(sheet.id)),
          }
        : {
            key: "reprint",
            label: "Reprint this card",
            icon: "print",
            hint: "Re-planned in full; this card is replaced when the new sheet is marked printed",
            onSelect: () => run(() => reprintAlbumPageAction(sheet.id)),
          },
      ...sheet.entries.flatMap<RowAction>((entry) => {
        if (entry.continuationOpen) {
          return [
            {
              key: `close-${entry.entryId}`,
              label: `Withdraw the continuation for "${entry.checklistName}"`,
              icon: "revert",
              hint: "Its stamps go back to appearing nowhere until you answer again",
              onSelect: () => run(() => closeAlbumContinuationAction(entry.entryId)),
            },
          ];
        }
        if (entry.waiting === 0) return [];
        return [
          {
            key: `continue-${entry.entryId}`,
            label: `Continuation page for "${entry.checklistName}"`,
            icon: "add",
            hint: `${entry.waiting === 1 ? "1 stamp" : `${entry.waiting} stamps`} with nowhere to go`,
            onSelect: () => run(() => openAlbumContinuationAction(entry.entryId, sheet.id)),
          },
        ];
      }),
      {
        key: "unprint",
        label: "Un-print this card",
        icon: "delete",
        danger: true,
        separatorBefore: true,
        onSelect: () =>
          setUnprint({
            id: sheet.id,
            range: sheet.range || (sheet.yearAlone !== null ? albumYearAloneName(sheet.yearAlone) : ""),
          }),
      },
    ];
  }

  // The positions of every sheet not yet on paper, for the gesture that says the whole album has
  // been printed — which is what a first print actually is.
  const livePositions = initialOverview.pages
    .map((page, i) => (page.printedPageId ? null : i + 1))
    .filter((n): n is number => n !== null);

  function pdfHref(sheet?: number): string {
    const base = `/api/collections/${album.collectionId}/albums/${album.id}/pdf`;
    return sheet === undefined ? base : `${base}?sheets=${sheet}`;
  }

  // Un-printing is loud: it says what it will throw away **before** it does. The dialog opens on the
  // server's own account of the stored sheet rather than on a sentence written here, because what is
  // lost is what that particular card kept.
  useEffect(() => {
    if (!unprint) return;
    const id = unprint.id;
    let open = true;
    void describeAlbumUnprintAction(id).then((says) => {
      if (open) setUnprintSays({ id, says });
    });
    return () => {
      open = false;
    };
  }, [unprint]);
  const unprintText = unprint && unprintSays?.id === unprint.id ? unprintSays.says : null;

  function run(action: () => Promise<AlbumActionState>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setNotice(result.status === "success" ? (result.message ?? null) : null);
      setConfirm(null);
      setMarkPrinted(null);
      setUnprint(null);
      router.refresh();
    });
  }

  /**
   * Save the album's own values. The first press sends no acknowledgement; if printed sheets that
   * match today would stop matching, the server answers with how many and nothing is written until
   * that exact figure is confirmed. The count is the server's, not worked out here.
   */
  function savePreset(acknowledged: number | null) {
    const form = presetFormRef.current;
    if (!form) return;
    setPresetError(null);
    startTransition(async () => {
      const result = await updateAlbumPresetAction(album.id, new FormData(form), acknowledged);
      if (result.status === "confirm") {
        setPresetConfirm(result.diverging);
        return;
      }
      setPresetConfirm(null);
      if (result.status === "error") {
        setPresetError(result.message);
        return;
      }
      setPresetOpen(false);
      setNotice(result.status === "success" ? (result.message ?? null) : null);
      router.refresh();
    });
  }

  function closePreset() {
    if (isPending) return;
    setPresetOpen(false);
    setPresetConfirm(null);
    setPresetError(null);
  }

  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    const from = items.findIndex((e) => e.id === sourceId);
    const to = items.findIndex((e) => e.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    startTransition(async () => {
      const result = await reorderAlbumEntriesAction(
        album.id,
        next.map((e) => e.id)
      );
      if (result.status === "success") {
        router.refresh();
        return;
      }
      setItems(entries);
      setError(result.status === "error" ? result.message : null);
    });
  }

  function setView(next: Partial<AlbumScreenView>) {
    const qs = albumScreenViewQuery({ ...view, ...next }, searchParams.toString());
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  /** The page editor, on one sheet or on its first, carrying this view so the editor's way back
   *  returns to it (#1489). */
  function editorHref(position?: number): string {
    const params = new URLSearchParams();
    if (position !== undefined) params.set("sheet", String(position));
    const carried = albumScreenViewQuery(view);
    if (carried) params.set(ALBUM_VIEW_PARAM, carried);
    const qs = params.toString();
    return `/c/${collectionSlug}/albums/${album.id}/pages${qs ? `?${qs}` : ""}`;
  }

  function toggleChapter(id: string) {
    const closed = new Set(view.closed);
    if (closed.has(id)) closed.delete(id);
    else closed.add(id);
    setView({ closed });
  }

  // The plan's sheets beside their rows' facts. Both lists come off one plan, in one order.
  const rows = initialOverview.pages.map((page, i) => ({
    page,
    position: i + 1,
    printed: page.printedPageId !== null,
    summary: sheets[i] ?? null,
    attention: sheets[i]?.attention ?? NO_ATTENTION,
  }));
  type SheetRow = (typeof rows)[number];
  const summary = albumScreenSummary(items, rows, printedReport.sheets);
  const cardById = new Map(printedReport.sheets.map((c) => [c.id, c]));

  const sheetChapters = albumChapterRuns(rows, (r) => r.page.chapterKey);
  const entryChapters = albumChapterRuns(items, entryChapterKey);
  const chapterAttention = new Map(
    sheetChapters.map((run) => [run.id, run.items.filter((r) => needsAttention(r.attention)).length])
  );
  const visibleSheetChapters = sheetChapters
    .map((run) => ({ ...run, items: run.items.filter((r) => sheetMatchesFilter(r, view.sheets)) }))
    .filter((run) => run.items.length > 0);
  const visibleCards = printedReport.sheets.filter((c) => cardMatchesFilter(c, view.cards));

  const sizesNotMeasured = summary.attention.inherited + summary.attention.unmeasured;

  function sheetActions(row: SheetRow): RowAction[] {
    const { page, position } = row;
    return page.printedPageId
      ? [
          {
            key: "editor",
            label: "Open in the page editor",
            icon: "open",
            href: editorHref(position),
            hint: "Read-only: it draws what went onto the paper, with what has changed since",
          },
          {
            key: "pdf",
            label: "Download this card",
            icon: "print",
            href: pdfHref(position),
            hint: "Drawn from what was stored when it was printed",
          },
          {
            key: "unprint",
            label: "Un-print this sheet",
            icon: "revert",
            danger: true,
            separatorBefore: true,
            onSelect: () => setUnprint({ id: page.printedPageId!, range: sheetName(page) }),
          },
        ]
      : [
          {
            key: "editor",
            label: "Open in the page editor",
            icon: "edit",
            href: editorHref(position),
            hint: "Correct it by hand, exact in millimetres",
          },
          {
            key: "pdf",
            label: "Download this sheet",
            icon: "print",
            href: pdfHref(position),
            hint: "Print at 100% / Actual size",
          },
          {
            key: "printed",
            label:
              page.runWith.length > 1
                ? `Mark sheets ${page.runWith.join(", ")} printed…`
                : "Mark printed…",
            icon: "check",
            separatorBefore: true,
            hint:
              page.runWith.length > 1
                ? "One checklist runs across them, so they go onto paper together"
                : undefined,
            onSelect: () =>
              setMarkPrinted({
                sheets: page.runWith,
                label:
                  page.runWith.length > 1
                    ? `sheets ${page.runWith.join(", ")}`
                    : sheetName(page) || "this sheet",
                together: page.runWith.length > 1,
                yearApart:
                  page.yearSheetApart !== null
                    ? `${albumYearAloneName(page.chapterKey)} (sheet ${page.yearSheetApart})`
                    : null,
              }),
          },
        ];
  }

  function renderSheetRow(row: SheetRow, last: boolean) {
    const { page, attention } = row;
    const card = page.printedPageId ? cardById.get(page.printedPageId) : undefined;
    return (
      <div
        key={row.position}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "1rem",
          padding: "0.625rem 1rem",
          background: "var(--color-bg-elevated)",
          borderBottom: last ? "none" : "1px solid var(--color-border)",
        }}
      >
        <SheetThumbnail
          sketch={row.summary?.sketch ?? null}
          range={page.range}
          href={editorHref(row.position)}
          printed={row.printed}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
              {sheetName(page) ||
                (page.free ? "A page without stamps" : "(no catalog numbers on this sheet)")}
            </span>
            {page.printedPageId ? (
              <Tooltip
                content={
                  page.printedAt
                    ? `Printed on ${new Date(page.printedAt).toLocaleDateString()}. This sheet is a stored result: it draws what went onto the paper, whatever has changed since.`
                    : "A stored sheet: it draws what went onto the paper, whatever has changed since."
                }
              >
                <span style={CHIP}>
                  Printed
                  {page.printedAt ? ` ${new Date(page.printedAt).toLocaleDateString()}` : ""}
                </span>
              </Tooltip>
            ) : (
              <Tooltip content="Not on paper yet: planned from your current data every time this screen opens, so it follows every change until you mark it printed.">
                <span style={CHIP}>Live</span>
              </Tooltip>
            )}
            {card && card.divergences.length > 0 && (
              <Tooltip content="The data has moved on since this card was printed. Printed cards says what differs.">
                <button
                  type="button"
                  onClick={() => setView({ tab: "printed", cards: "diverged" })}
                  style={{ ...WARN_CHIP, cursor: "pointer" }}
                >
                  Out of date
                </button>
              </Tooltip>
            )}
            {page.continued && <span style={CHIP}>Continued</span>}
            {page.runWith.length > 1 && (
              <Tooltip content={`One checklist runs across sheets ${page.runWith.join(", ")}; they go onto paper together.`}>
                <span style={CHIP}>
                  Sheets {page.runWith[0]}–{page.runWith[page.runWith.length - 1]}
                </span>
              </Tooltip>
            )}
          </div>
          {page.headings.length > 0 && (
            <div style={{ ...MUTED, marginTop: "0.25rem", lineHeight: 1.5 }}>
              {page.headings.join(" · ")}
            </div>
          )}
          {needsAttention(attention) && (
            <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.375rem", flexWrap: "wrap" }}>
              <AttentionChips attention={attention} />
            </div>
          )}
        </div>
        <span style={{ ...MUTED, whiteSpace: "nowrap", paddingTop: "0.125rem" }}>
          {page.printedPageId
            ? "on paper"
            : page.boxCount === 1
              ? "1 box"
              : `${page.boxCount} boxes`}
        </span>
        <RowActionsMenu ariaLabel="Sheet actions" actions={sheetActions(row)} />
      </div>
    );
  }

  /** How one checklist prints relative to its issue, or null to follow the default (#1509). One field,
   *  so nothing else about the entry rides along. */
  function setPrintMode(entryId: string, mode: AlbumPrintMode | null) {
    const form = new FormData();
    form.set("printMode", mode ?? "");
    run(() => setAlbumEntryLayoutAction(entryId, form));
  }

  function renderEntryRow(entry: AlbumEntryData, last: boolean) {
    return (
      <div
        key={entry.id}
        draggable={!isPending}
        onDragStart={() => setDraggingId(entry.id)}
        onDragEnd={() => setDraggingId(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => handleDrop(entry.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.625rem 1rem",
          background: draggingId === entry.id ? "var(--color-bg-page)" : "var(--color-bg-elevated)",
          borderBottom: last ? "none" : "1px solid var(--color-border)",
          opacity: draggingId === entry.id ? 0.5 : 1,
          cursor: isPending ? "default" : "grab",
        }}
      >
        <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
          <Icon name="dragGrip" size="sm" />
        </span>
        <span style={{ ...MUTED, width: "3rem" }}>{entry.year ?? "—"}</span>
        <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
          {entry.checklistName}
        </span>
        {entry.ordersItsOwn && (
          <Tooltip content="This album prints these stamps in its own order, not the checklist's">
            <span style={CHIP}>Own order</span>
          </Tooltip>
        )}
        {/* A select inside a draggable row: pressing it must not pick the row up. */}
        <span
          draggable={false}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{ flex: "0 0 auto" }}
        >
          <PrintModeSelect
            id={`print-mode-${entry.id}`}
            chosen={albumPrintModeOffered(entry) ? entry.printMode : null}
            defaultMode={defaultPrintModes.get(entry.id)?.mode ?? "own"}
            offered={albumPrintModeOffered(entry)}
            disabled={isPending}
            onChange={(mode) => setPrintMode(entry.id, mode)}
            style={PRINT_MODE_SELECT}
          />
        </span>
        <span style={MUTED}>
          {entry.stampIds.length === 1 ? "1 stamp" : `${entry.stampIds.length} stamps`}
        </span>
        <RowActionsMenu
          ariaLabel="Entry actions"
          actions={[
            ...(entry.ordersItsOwn
              ? [
                  {
                    key: "reset",
                    label: "Follow the checklist's order",
                    icon: "revert" as const,
                    onSelect: () => run(() => clearAlbumEntryStampOrderAction(entry.id)),
                  },
                ]
              : []),
            {
              key: "remove",
              label: "Remove from album",
              icon: "delete",
              danger: true,
              separatorBefore: entry.ordersItsOwn,
              onSelect: () => setConfirm(entry),
            },
          ]}
        />
      </div>
    );
  }

  function renderChapters<T>(
    runs: AlbumChapterRun<T>[],
    noun: [string, string],
    renderRow: (item: T, last: boolean) => ReactNode
  ) {
    return runs.map((run) => {
      const open = !view.closed.has(run.id);
      const attention = chapterAttention.get(run.id) ?? 0;
      return (
        <div key={run.id} style={{ ...CARD_STYLE, marginBottom: "0.75rem" }}>
          {/* The whole heading folds the chapter, and hovering it anywhere lights the caret (#1589). */}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggleChapter(run.id)}
            className="cell-target"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              width: "100%",
              padding: "0.5rem 1rem",
              border: "none",
              borderBottom: open ? "1px solid var(--color-border)" : "none",
              background: "var(--color-bg-page)",
              cursor: "pointer",
              textAlign: "left",
              color: "var(--color-text-primary)",
            }}
          >
            <span className="cell-target-glyph" style={{ ...CELL_GLYPH, color: "var(--color-text-muted)" }}>
              <Icon name={open ? "collapse" : "expand"} size="sm" />
            </span>
            <span style={{ fontSize: "0.9375rem", fontWeight: 600 }}>{run.key || "No year"}</span>
            <span style={MUTED}>
              {run.items.length} {run.items.length === 1 ? noun[0] : noun[1]}
            </span>
            {attention > 0 && (
              <span style={WARN_CHIP}>
                {attention === 1 ? "1 sheet needs attention" : `${attention} sheets need attention`}
              </span>
            )}
          </button>
          {open && run.items.map((item, i) => renderRow(item, i === run.items.length - 1))}
        </div>
      );
    });
  }

  const sheetFilterCount: Record<AlbumSheetFilter, number> = {
    all: summary.sheets,
    attention: summary.attentionSheets,
    live: summary.live,
    printed: summary.printed,
  };
  const tabCount = { sheets: summary.sheets, entries: summary.entries, printed: summary.cards };

  return (
    <div style={{ padding: "2rem" }}>
      <Link
        href={`/c/${collectionSlug}/albums`}
        style={{ ...MUTED, textDecoration: "none", display: "inline-block", marginBottom: "0.5rem" }}
      >
        ← Albums
      </Link>

      {/* ── Header: the album, and what can be done to all of it ── */}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1.5rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: "0 0 0.25rem",
              fontSize: "1.25rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {album.name}
          </h2>
          {nameSuggestion && (
            <AlbumNameSuggestion
              albumId={album.id}
              name={album.name}
              suggestion={nameSuggestion}
              language={album.language}
            />
          )}
          <p style={{ ...MUTED, margin: 0 }}>
            Printed in {languageLabel(album.language)} · {album.pageWidthMm} × {album.pageHeightMm} mm ·{" "}
            {album.blocksPerBand === 1
              ? "one checklist per band"
              : `up to ${album.blocksPerBand} checklists per band`}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {initialOverview.pages.length > 0 && (
            <Tooltip content="Draw a sheet at 1:1 and correct it by hand — extra space, a forced break, a box a couple of millimetres bigger, an order of your own. Every correction is a delta, so a stamp arriving later re-flows the page and keeps them.">
              <Link href={editorHref()} style={PRIMARY_BTN}>
                Page editor
              </Link>
            </Tooltip>
          )}
          {initialOverview.pages.length > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
              <Tooltip content="Compose the whole album as a PDF, drawn to size so a box on the paper measures what the cutting list says.">
                <a
                  href={pdfHref()}
                  // The file's own name comes from the server's Content-Disposition, which knows the
                  // album; the attribute only makes this a download rather than a navigation.
                  download
                  style={DOWNLOAD_BTN}
                >
                  ↓ Download PDF
                </a>
              </Tooltip>
              <Tooltip
                align="end"
                content="The print dialog defaults to Fit to page, which shrinks the sheet by a few percent — and nothing on the card shows it except a ruler. Set 100% / Actual size, and measure one box on the first sheet."
              >
                <span style={{ ...MUTED, fontSize: "0.75rem", color: "var(--color-warning)", whiteSpace: "nowrap" }}>
                  print at 100 %
                </span>
              </Tooltip>
            </span>
          )}
          {livePositions.length > 0 && (
            <Tooltip content="Say that every unprinted sheet has gone onto paper. The album stores what was on each of them; nothing is frozen by downloading a draft.">
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  setMarkPrinted({
                    sheets: livePositions,
                    label:
                      livePositions.length === 1
                        ? "this sheet"
                        : `all ${livePositions.length} unprinted sheets`,
                  })
                }
                style={{ ...DOWNLOAD_BTN, cursor: isPending ? "default" : "pointer" }}
              >
                Mark printed…
              </button>
            </Tooltip>
          )}
          {initialOverview.pages.length > 0 && (
            <Tooltip content="What to cut for every sheet, and what the album still needs bought. It is a list, so it prints from the browser — only the album's own pages have to be true to the millimetre.">
              <Link href={`/c/${collectionSlug}/albums/${album.id}/cutting-list`} style={DOWNLOAD_BTN}>
                Cutting list
              </Link>
            </Tooltip>
          )}
          <Tooltip
            align="end"
            content="This album's own page, spacing, hawid, type and text values, with its pages drawn beside them. Changes apply to this album only — the template it started from is not touched."
          >
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setPresetError(null);
                setPresetOpen(true);
              }}
              style={{ ...DOWNLOAD_BTN, cursor: isPending ? "default" : "pointer" }}
            >
              Page template…
            </button>
          </Tooltip>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {error}
        </p>
      )}
      {notice && <p style={{ ...MUTED, marginBottom: "1rem" }}>{notice}</p>}

      {initialOverview.emptyStock && (
        <p
          style={{
            ...MUTED,
            marginBottom: "1.25rem",
            padding: "0.75rem 1rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            lineHeight: 1.6,
          }}
        >
          This collection has no hawid stock, so every box is planned as a pocket. That is what an
          undescribed drawer honestly comes to — add the strips you own in Settings → Hawid stock and the
          boxes will be cut from them.
        </p>
      )}

      {/* ── Summary: where the album stands, each figure a way in ── */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <SummaryTile title="Entries">
          <button type="button" style={FIGURE_BTN} onClick={() => setView({ tab: "entries" })}>
            {summary.entries === 1 ? "1 entry" : `${summary.entries} entries`}
          </button>
          <span style={MUTED}>
            {summary.chapters === 1 ? "1 chapter" : `${summary.chapters} chapters`}
            {summary.years &&
              ` · ${summary.years.from === summary.years.to ? summary.years.from : `${summary.years.from}–${summary.years.to}`}`}
          </span>
        </SummaryTile>
        <SummaryTile title="Sheets">
          <button
            type="button"
            style={FIGURE_BTN}
            onClick={() => setView({ tab: "sheets", sheets: "all" })}
          >
            {summary.sheets === 1 ? "1 sheet" : `${summary.sheets} sheets`}
          </button>
          <span style={{ ...MUTED, display: "flex", gap: "0.375rem", alignItems: "baseline" }}>
            <button
              type="button"
              style={{ ...FIGURE_BTN, fontSize: "0.8125rem" }}
              onClick={() => setView({ tab: "sheets", sheets: "live" })}
            >
              {summary.live} live
            </button>
            ·
            <button
              type="button"
              style={{ ...FIGURE_BTN, fontSize: "0.8125rem" }}
              onClick={() => setView({ tab: "sheets", sheets: "printed" })}
            >
              {summary.printed} printed
            </button>
          </span>
        </SummaryTile>
        <SummaryTile title="Before printing">
          {summary.attentionSheets === 0 ? (
            <span style={MUTED}>Nothing to check</span>
          ) : (
            <>
              {sizesNotMeasured > 0 && (
                <Tooltip
                  align="start"
                  content={[
                    summary.attention.inherited > 0 &&
                      `${summary.attention.inherited} sized from a neighbour on the checklist`,
                    summary.attention.unmeasured > 0 &&
                      `${summary.attention.unmeasured} with no size anywhere on the checklist`,
                  ]
                    .filter(Boolean)
                    .join("; ")}
                >
                  <button type="button" style={FIGURE_BTN} onClick={() => setView({ tab: "sheets", sheets: "attention" })}>
                    {sizesNotMeasured === 1 ? "1 size not measured" : `${sizesNotMeasured} sizes not measured`}
                  </button>
                </Tooltip>
              )}
              {summary.attention.oversize > 0 && (
                <button type="button" style={FIGURE_BTN} onClick={() => setView({ tab: "sheets", sheets: "attention" })}>
                  {summary.attention.oversize === 1
                    ? "1 box in a pocket"
                    : `${summary.attention.oversize} boxes in a pocket`}
                </button>
              )}
              {summary.attention.untranslated > 0 && (
                <button type="button" style={FIGURE_BTN} onClick={() => setView({ tab: "sheets", sheets: "attention" })}>
                  {summary.attention.untranslated === 1
                    ? "1 untranslated text"
                    : `${summary.attention.untranslated} untranslated texts`}
                </button>
              )}
              <span style={MUTED}>
                on {summary.attentionSheets === 1 ? "1 sheet" : `${summary.attentionSheets} sheets`}
              </span>
            </>
          )}
        </SummaryTile>
        <SummaryTile title="Printed cards">
          {summary.cards === 0 ? (
            <span style={MUTED}>None yet</span>
          ) : (
            <>
              {summary.divergedCards > 0 ? (
                <button
                  type="button"
                  style={FIGURE_BTN}
                  onClick={() => setView({ tab: "printed", cards: "diverged" })}
                >
                  {summary.divergedCards === 1 ? "1 out of date" : `${summary.divergedCards} out of date`}
                </button>
              ) : (
                <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                  All still match
                </span>
              )}
              <button
                type="button"
                style={{ ...FIGURE_BTN, fontSize: "0.8125rem" }}
                onClick={() => setView({ tab: "printed", cards: "all" })}
              >
                of {summary.cards === 1 ? "1 card" : `${summary.cards} cards`}
              </button>
            </>
          )}
        </SummaryTile>
      </div>

      {/* ── Tabs ── */}

      <div
        role="tablist"
        style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginBottom: "1rem" }}
      >
        {(["sheets", "entries", "printed"] as const).map((tab) => {
          const active = view.tab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView({ tab })}
              style={{
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: active ? 600 : 400,
                color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: "-1px",
              }}
            >
              {TAB_LABEL[tab]}{" "}
              <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>{tabCount[tab]}</span>
            </button>
          );
        })}
      </div>

      {/* ── Sheets ── */}

      {view.tab === "sheets" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {(["all", "attention", "live", "printed"] as const).map((filter) => (
              <FilterChip
                key={filter}
                label={SHEET_FILTER_LABEL[filter]}
                count={sheetFilterCount[filter]}
                active={view.sheets === filter}
                onClick={() => setView({ sheets: filter })}
              />
            ))}
            <span style={{ marginLeft: "auto", display: "flex", gap: "1rem" }}>
              <Tooltip
                align="end"
                content="Planned from the entries, fresh every time you open this screen — there is nothing to refresh and nothing stored until a sheet is marked printed."
              >
                <span style={HINT}>Live sheets</span>
              </Tooltip>
              <Tooltip
                align="end"
                content="A sheet is named by the catalog numbers on it, not by a page number: a number is a position, and a position moves when the collection grows, so one added stamp would invalidate every card already in the binder."
              >
                <span style={HINT}>Why ranges, not page numbers</span>
              </Tooltip>
            </span>
          </div>
          {rows.length === 0 && (
            <p style={{ ...MUTED, ...CARD_STYLE, padding: "1rem" }}>
              No sheets: there is nothing to lay out yet.
            </p>
          )}
          {rows.length > 0 && visibleSheetChapters.length === 0 && (
            <p style={{ ...MUTED, ...CARD_STYLE, padding: "1rem" }}>
              No sheet is {SHEET_FILTER_LABEL[view.sheets].toLowerCase()}.
            </p>
          )}
          {renderChapters(visibleSheetChapters, ["sheet", "sheets"], renderSheetRow)}
        </>
      )}

      {/* ── Entries ── */}

      {view.tab === "entries" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
            <Tooltip content={`Picks up checklists that have appeared under ${album.name}'s area since you last looked. It only ever adds.`}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => gatherAlbumEntriesAction(album.id))}
                style={{ ...DOWNLOAD_BTN, cursor: isPending ? "default" : "pointer" }}
              >
                Gather new checklists
              </button>
            </Tooltip>
            <span style={{ marginLeft: "auto", display: "flex", gap: "1rem" }}>
              <Tooltip
                align="end"
                content="Gathered from the album's area and everything under it, in catalog order. Drag a row to change the order the album prints them in."
              >
                <span style={HINT}>Order</span>
              </Tooltip>
              <Tooltip align="end" content={ALBUM_PRINT_MODE_DEFAULTS_HINT}>
                <span style={HINT}>Several checklists of one issue</span>
              </Tooltip>
              <Tooltip
                align="end"
                content="A checklist that spans several issues has no area and cannot be gathered — add one of those from its own screen."
              >
                <span style={HINT}>A checklist is missing</span>
              </Tooltip>
            </span>
          </div>
          {items.length === 0 && (
            <p style={{ ...MUTED, ...CARD_STYLE, padding: "1rem" }}>
              Nothing to print yet: this area has no checklists.
            </p>
          )}
          {renderChapters(entryChapters, ["entry", "entries"], renderEntryRow)}
        </>
      )}

      {/* ── Printed cards (#778) ── */}

      {view.tab === "printed" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {(["all", "diverged"] as const satisfies readonly AlbumCardFilter[]).map((filter) => (
              <FilterChip
                key={filter}
                label={filter === "all" ? "All" : "Out of date"}
                count={filter === "all" ? summary.cards : summary.divergedCards}
                active={view.cards === filter}
                onClick={() => setView({ cards: filter })}
              />
            ))}
            <span style={{ marginLeft: "auto" }}>
              <Tooltip
                align="end"
                content="A card is reported, never put right on its own: it can be out of date for a good reason for years. Where you do want to act, pick per card from its ⋮ — a continuation page carrying the new stamps with a range of its own, filed after the card it continues, or a reprint of the whole card."
              >
                <span style={HINT}>What to do about a difference</span>
              </Tooltip>
            </span>
          </div>
          {printedReport.sheets.length === 0 && (
            <p style={{ ...MUTED, ...CARD_STYLE, padding: "1rem" }}>
              Nothing printed yet. Mark sheets printed once they have gone onto paper, and this tab
              reports what each card no longer says.
            </p>
          )}
          {printedReport.sheets.length > 0 && visibleCards.length === 0 && (
            <p style={{ ...MUTED, ...CARD_STYLE, padding: "1rem" }}>
              Every card still matches the album.
            </p>
          )}
          {visibleCards.length > 0 && (
            <div style={CARD_STYLE}>
              {visibleCards.map((sheet, i) => (
                <div
                  key={sheet.id}
                  style={{
                    padding: "0.75rem 1rem",
                    background: "var(--color-bg-elevated)",
                    borderBottom:
                      i < visibleCards.length - 1 ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span
                      style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}
                    >
                      {sheet.range ||
                        (sheet.free
                          ? "A page without stamps"
                          : sheet.yearAlone !== null
                            ? albumYearAloneName(sheet.yearAlone)
                            : "(no catalog numbers on this card)")}
                    </span>
                    <span style={MUTED}>
                      printed {new Date(sheet.printedAt).toLocaleDateString()}
                    </span>
                    {sheet.reprinting && (
                      <Tooltip content="Its checklists are back in the plan and will be re-planned in full. This stored card stands until the replacement is marked printed in its turn.">
                        <span style={CHIP}>Awaiting reprint</span>
                      </Tooltip>
                    )}
                    {sheet.divergences.length === 0 && !sheet.reprinting && (
                      <span style={CHIP}>Still matches</span>
                    )}
                    <span style={{ marginLeft: "auto" }} />
                    <RowActionsMenu
                      ariaLabel="Printed card actions"
                      actions={printedCardActions(sheet)}
                    />
                  </div>
                  {sheet.entries.some((e) => e.continuationOpen) && (
                    <div style={{ ...MUTED, marginTop: "0.375rem", lineHeight: 1.5 }}>
                      A continuation sheet is waiting in Sheets for{" "}
                      {sheet.entries
                        .filter((e) => e.continuationOpen)
                        .map((e) => e.checklistName)
                        .join(", ")}
                      .
                    </div>
                  )}
                  {sheet.divergences.length > 0 && (
                    <ul
                      style={{
                        listStyle: "none",
                        margin: "0.5rem 0 0",
                        padding: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.25rem",
                      }}
                    >
                      {sheet.divergences.map((d, n) => (
                        <li key={n} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                          <span style={{ ...CHIP, flexShrink: 0 }}>{DIVERGENCE_LABEL[d.kind]}</span>
                          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)", lineHeight: 1.5 }}>
                            {d.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {presetOpen && (
        <DialogShell
          title={`Page template — ${album.name}`}
          onClose={closePreset}
          maxWidth={ALBUM_PRESET_DIALOG_WIDTH}
          height={ALBUM_PRESET_DIALOG_HEIGHT}
        >
          <form
            ref={presetFormRef}
            style={FORM_STYLE}
            onSubmit={(e) => {
              e.preventDefault();
              savePreset(null);
            }}
          >
            <DialogBody>
              <AlbumPresetForm
                collectionId={album.collectionId}
                preset={album}
                name={null}
                isPending={isPending}
                formRef={presetFormRef}
                previewAlbumId={album.id}
                sampleLanguage={album.language}
                // In the fields' column, so the preview beside it keeps the dialog's whole height.
                intro={
                  <p style={{ ...MUTED, margin: "0 0 1rem", lineHeight: 1.6, flexShrink: 0 }}>
                    These are <strong>this album&apos;s own</strong> values, copied from a template when
                    it was made. Changing them here changes this album only: the template in Settings is
                    not touched, and no other album is. Unprinted sheets are re-planned under the new
                    values; printed cards stay exactly as printed and report the difference — you are
                    told how many before anything is saved.
                  </p>
                }
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closePreset}
              disabled={isPending}
              error={presetError ?? undefined}
            />
          </form>
        </DialogShell>
      )}

      {/* After the values dialog, so it paints over it. */}
      {presetOpen && presetConfirm !== null && (
        <ConfirmDialog
          title="Printed cards will report a difference"
          message={
            presetConfirm === 1
              ? "One printed card that matches this album today will stop matching: it stays exactly as printed, and Printed cards will say what differs. Save these values anyway?"
              : `${presetConfirm} printed cards that match this album today will stop matching: they stay exactly as printed, and Printed cards will say what differs on each. Save these values anyway?`
          }
          actionLabel="Save anyway"
          pendingLabel="Saving…"
          variant="primary"
          isPending={isPending}
          error={presetError ?? undefined}
          onClose={() => !isPending && setPresetConfirm(null)}
          onConfirm={() => savePreset(presetConfirm)}
        />
      )}

      {markPrinted && (
        <MarkPrintedDialog
          label={markPrinted.label}
          count={markPrinted.sheets.length}
          together={markPrinted.together}
          yearApart={markPrinted.yearApart}
          isPending={isPending}
          error={error ?? undefined}
          onClose={() => !isPending && setMarkPrinted(null)}
          onConfirm={() =>
            run(() =>
              markAlbumPagesPrintedAction(
                album.id,
                markPrinted.sheets,
                initialOverview.fingerprint
              )
            )
          }
        />
      )}

      {unprint && (
        <ConfirmDialog
          title={`Un-print ${unprint.range || "this card"}`}
          message={
            unprintText ? (
              <>
                {unprintText.map((line, n) => (
                  <span key={n} style={{ display: "block", marginBottom: "0.5rem" }}>
                    {line}
                  </span>
                ))}
              </>
            ) : (
              "Reading what this card holds…"
            )
          }
          actionLabel="Discard the stored sheet"
          variant="destructive"
          isPending={isPending || !unprintText}
          error={error ?? undefined}
          onClose={() => !isPending && setUnprint(null)}
          onConfirm={() => run(() => unprintAlbumPageAction(unprint.id))}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title="Remove from album"
          message={`Take "${confirm.checklistName}" out of this album? The checklist itself is untouched — this only says it is not in this binder.`}
          actionLabel="Remove"
          variant="destructive"
          isPending={isPending}
          error={error ?? undefined}
          onClose={() => !isPending && setConfirm(null)}
          onConfirm={() => run(() => removeAlbumEntryAction(confirm.id))}
        />
      )}
    </div>
  );
}

function SummaryTile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        ...CARD_STYLE,
        padding: "0.75rem 1rem",
        background: "var(--color-bg-elevated)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "0.25rem",
      }}
    >
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {title}
      </span>
      {children}
    </div>
  );
}

/** A live sheet's flags, in the page editor's words and order (`album-box-flag.ts`). */
function AttentionChips({ attention }: { attention: AlbumSheetAttention }) {
  return (
    <>
      {attention.unmeasured > 0 && (
        <span style={WARN_CHIP}>{attention.unmeasured} with no size at all</span>
      )}
      {attention.oversize > 0 && (
        <span style={WARN_CHIP}>{attention.oversize} in a pocket — no strip is tall enough</span>
      )}
      {attention.inherited > 0 && (
        <span style={WARN_CHIP}>{attention.inherited} sized from a neighbour, not measured</span>
      )}
      {attention.untranslated > 0 && (
        <Tooltip content="Texts that would print in the collection's default language. The page editor outlines them and fills the gap in place.">
          <span style={WARN_CHIP}>
            {attention.untranslated === 1
              ? "1 untranslated text"
              : `${attention.untranslated} untranslated texts`}
          </span>
        </Tooltip>
      )}
    </>
  );
}

/**
 * A sheet in miniature: where its text sits and where its boxes are, with a box the editor would flag
 * drawn in the warning colour. Every figure came from the server — this scales them, and measures
 * nothing (ADR-0045 §7).
 *
 * It is the sheet, so it opens the sheet (#1489): an ordinary link to the page editor on it, which
 * draws a printed card read-only as it always does, and which a new tab can take.
 */
function SheetThumbnail({
  sketch,
  range,
  href,
  printed,
}: {
  sketch: AlbumSheetSketch | null;
  range: string;
  href: string;
  printed: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  if (!sketch) {
    return <span aria-hidden style={{ width: THUMB_WIDTH_PX, flexShrink: 0 }} />;
  }
  const heightPx = Math.round((THUMB_WIDTH_PX * sketch.heightMm) / sketch.widthMm);
  const label = printed
    ? "Open this card in the page editor, read-only"
    : "Open this sheet in the page editor";
  return (
    <Tooltip content={label} style={{ flexShrink: 0 }}>
      <Link
        href={href}
        aria-label={range ? `${label}: ${range}` : label}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "block",
          borderRadius: "0.125rem",
          // Left unset at rest, so a keyboard's focus ring is the browser's own.
          outline: hovered ? "2px solid var(--color-accent)" : undefined,
          outlineOffset: "2px",
        }}
      >
        <svg
          aria-hidden
          width={THUMB_WIDTH_PX}
          height={heightPx}
          viewBox={`0 0 ${sketch.widthMm} ${sketch.heightMm}`}
          style={{ flexShrink: 0, display: "block" }}
        >
          <rect
            x={0}
            y={0}
            width={sketch.widthMm}
            height={sketch.heightMm}
            fill={THUMB_PAPER}
            stroke={THUMB_EDGE}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {sketch.lines.map((l, i) => (
            <rect key={`l${i}`} x={l.xMm} y={l.yMm} width={l.widthMm} height={l.heightMm} fill={THUMB_TEXT} />
          ))}
          {sketch.boxes.map((b, i) => (
            <rect
              key={`b${i}`}
              x={b.xMm}
              y={b.yMm}
              width={b.widthMm}
              height={b.heightMm}
              fill={b.flagged ? THUMB_FLAG : "none"}
              fillOpacity={b.flagged ? 0.25 : undefined}
              stroke={b.flagged ? THUMB_FLAG : THUMB_INK}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </Link>
    </Tooltip>
  );
}

/** A sheet's name on this screen: its range, or — for a sheet carrying only its chapter's year, which
 *  has none (#1498) — the year. Blank for anything else without a range, which each caller words. */
function sheetName(page: AlbumPlanOverview["pages"][number]): string {
  return page.range || (page.yearAlone ? albumYearAloneName(page.chapterKey) : "");
}
