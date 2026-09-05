"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog } from "@/app/dialog-shell";
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
  reprintAlbumPageAction,
  unprintAlbumPageAction,
  type AlbumActionState,
} from "@/app/actions/albums";
import type { AlbumData, AlbumEntryData } from "@/lib/albums";
import type { AlbumPlanOverview } from "@/lib/album-plan";
import type { AlbumPrintedReport } from "@/lib/album-printing";
import type { AlbumDivergenceKind } from "@/lib/album-divergence";
import { languageLabel } from "@/lib/languages";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// One album (#767): what it prints, in what order, and how that falls onto sheets.
//
// Two lists, and they are two different questions. **Entries** is the order the album reads in and
// is edited here. **Sheets** is what the plan makes of it and is edited nowhere — a page is a
// derivation of current data, re-planned whenever anything it reads changes, and only a page marked
// printed (#778) ever stops being one. The page editor with its relative corrections is #769.
//
// There is deliberately **no "what changed since last time"** here. A live page reshuffling harms
// nothing — that is exactly what makes it live — so a live-versus-previous-live diff has no customer.
// The only comparison anyone can act on is against paper, and that is the third list: **Printed
// cards** (#778), which reports how each card in the binder differs from what the data would now
// produce and never resolves any of it.
//
// Two rules the screen has to keep, because both are easy to lose in a component:
//
// - **Marking a sheet printed is its own gesture.** Downloading the PDF marks nothing; an album that
//   froze itself on the first preview would be a trap.
// - **A card may state only what stays true of the objects it describes.** The flags on a live sheet
//   below — *N in a pocket*, *N sized from a neighbour* — are exactly the staleness-prone kind that
//   may not be printed, and they are shown here deliberately: they are shown *about* a sheet, on
//   screen, before it is printed, and never go onto the paper.

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
const DIVERGENCE_LABEL: Record<AlbumDivergenceKind, string> = {
  stamps: "Stamps",
  size: "Size",
  text: "Text",
  template: "Template",
  photo: "Picture",
};

interface AlbumScreenProps {
  collectionSlug: string;
  album: AlbumData;
  entries: AlbumEntryData[];
  initialOverview: AlbumPlanOverview;
  printedReport: AlbumPrintedReport;
}

export function AlbumScreen({
  collectionSlug,
  album,
  entries,
  initialOverview,
  printedReport,
}: AlbumScreenProps) {
  const router = useRouter();
  // Local ordering for optimistic drag-and-drop, re-synced from the server on refresh — the hawid
  // stock panel's pattern, and the plan comes back with it.
  const [items, setItems] = useState(entries);
  const [syncedFrom, setSyncedFrom] = useState(entries);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AlbumEntryData | null>(null);
  const [markPrinted, setMarkPrinted] = useState<{ sheets: number[]; label: string } | null>(null);
  const [unprint, setUnprint] = useState<{ id: string; range: string } | null>(null);
  // Keyed by the card it describes rather than cleared when the dialog closes: what is being thrown
  // away is what *that* card kept, and a stale account of a different one is exactly the sentence a
  // collector would act on without reading.
  const [unprintSays, setUnprintSays] = useState<{ id: string; says: string[] } | null>(null);
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
        onSelect: () => setUnprint({ id: sheet.id, range: sheet.range }),
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

  return (
    <div style={{ padding: "2rem", maxWidth: "64rem" }}>
      <Link
        href={`/c/${collectionSlug}/albums`}
        style={{ ...MUTED, textDecoration: "none", display: "inline-block", marginBottom: "0.5rem" }}
      >
        ← Albums
      </Link>
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
      <p style={{ ...MUTED, margin: "0 0 1.5rem" }}>
        Printed in {languageLabel(album.language)} · {album.pageWidthMm} × {album.pageHeightMm} mm ·{" "}
        {album.blocksPerBand === 1
          ? "one checklist per band"
          : `up to ${album.blocksPerBand} checklists per band`}
      </p>

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
            marginBottom: "1.5rem",
            padding: "0.75rem 1rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            lineHeight: 1.6,
          }}
        >
          This collection has no hawid stock, so every box below is planned as a pocket. That is what
          an undescribed drawer honestly comes to — add the strips you own in Settings → Albums and
          the boxes will be cut from them.
        </p>
      )}

      {/* ── Entries ── */}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Entries</h3>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => gatherAlbumEntriesAction(album.id))}
          style={{
            padding: "0.375rem 0.75rem",
            background: "transparent",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-primary)",
            cursor: isPending ? "default" : "pointer",
          }}
        >
          Gather new checklists
        </button>
      </div>
      <p style={{ ...MUTED, margin: "0 0 1rem", lineHeight: 1.6, maxWidth: "42rem" }}>
        Gathered from {album.name}&apos;s area and everything under it, in catalog order. Drag to
        change the order the album prints them in. A checklist that spans several issues has no area
        and cannot be gathered — add one of those from its own screen.
      </p>

      <div style={{ ...CARD_STYLE, marginBottom: "2rem" }}>
        {items.length === 0 && (
          <p style={{ ...MUTED, padding: "1rem" }}>
            Nothing to print yet: this area has no checklists.
          </p>
        )}
        {items.map((entry, i) => (
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
              background:
                draggingId === entry.id ? "var(--color-bg-page)" : "var(--color-bg-elevated)",
              borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === entry.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
              <Icon name="dragGrip" size="sm" />
            </span>
            <span style={{ ...MUTED, width: "3rem" }}>{entry.year ?? "—"}</span>
            <span
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
              }}
            >
              {entry.checklistName}
            </span>
            {entry.ordersItsOwn && (
              <Tooltip content="This album prints these stamps in its own order, not the checklist's">
                <span style={CHIP}>Own order</span>
              </Tooltip>
            )}
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
                        onSelect: () =>
                          run(() => clearAlbumEntryStampOrderAction(entry.id)),
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
        ))}
      </div>

      {/* ── Sheets ── */}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Sheets</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {livePositions.length > 0 && (
            <Tooltip content="Say that every unprinted sheet below has gone onto paper. The album stores what was on each of them; nothing is frozen by downloading a draft.">
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
              <Link
                href={`/c/${collectionSlug}/albums/${album.id}/cutting-list`}
                style={DOWNLOAD_BTN}
              >
                Cutting list
              </Link>
            </Tooltip>
          )}
          {initialOverview.pages.length > 0 && (
            <Tooltip content="Compose the whole album as a PDF. Print it at 100% / Actual size — Fit to page silently shrinks the sheet and the boxes stop being true.">
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
          )}
        </div>
      </div>
      <p style={{ ...MUTED, margin: "0 0 1rem", lineHeight: 1.6, maxWidth: "42rem" }}>
        Planned from the entries above, fresh every time you open this screen — there is nothing to
        refresh and nothing stored. A sheet is named by the catalog numbers on it, not by a page
        number: a number is a position, and a position moves when the collection grows, so one added
        stamp would invalidate every card already in the binder.
      </p>
      <p style={{ ...MUTED, margin: "0 0 1rem", lineHeight: 1.6, maxWidth: "42rem" }}>
        The PDF is composed here rather than printed from the browser, so a box on the paper measures
        what the cutting list says. That only holds if you print it at <strong>100% / Actual
        size</strong> — the print dialog defaults to <em>Fit to page</em>, which shrinks the sheet by
        a few percent, and nothing on the card shows it except a ruler.
      </p>

      <div style={CARD_STYLE}>
        {initialOverview.pages.length === 0 && (
          <p style={{ ...MUTED, padding: "1rem" }}>No sheets: there is nothing to lay out yet.</p>
        )}
        {initialOverview.pages.map((page, i) => (
          <div
            key={i}
            style={{
              padding: "0.75rem 1rem",
              background: "var(--color-bg-elevated)",
              borderBottom: i < initialOverview.pages.length - 1 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span
                style={{
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                }}
              >
                {page.range || "(no catalog numbers on this sheet)"}
              </span>
              {page.chapterKey && <span style={CHIP}>{page.chapterKey}</span>}
              {page.printedPageId && (
                <Tooltip
                  content={
                    page.printedAt
                      ? `Printed on ${new Date(page.printedAt).toLocaleDateString()}. This sheet is a stored result: it draws what went onto the paper, whatever has changed since.`
                      : "A stored sheet: it draws what went onto the paper, whatever has changed since."
                  }
                >
                  <span style={CHIP}>Printed</span>
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
              <span style={{ ...MUTED, marginLeft: "auto" }}>
                {page.printedPageId
                  ? "on paper"
                  : page.boxCount === 1
                    ? "1 box"
                    : `${page.boxCount} boxes`}
              </span>
              <RowActionsMenu
                ariaLabel="Sheet actions"
                actions={
                  page.printedPageId
                    ? [
                        {
                          key: "pdf",
                          label: "Download this card",
                          icon: "print",
                          href: pdfHref(i + 1),
                          hint: "Drawn from what was stored when it was printed",
                        },
                        {
                          key: "unprint",
                          label: "Un-print this sheet",
                          icon: "revert",
                          danger: true,
                          separatorBefore: true,
                          onSelect: () =>
                            setUnprint({ id: page.printedPageId!, range: page.range }),
                        },
                      ]
                    : [
                        {
                          key: "pdf",
                          label: "Download this sheet",
                          icon: "print",
                          href: pdfHref(i + 1),
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
                                  : page.range || "this sheet",
                            }),
                        },
                      ]
                }
              />
            </div>
            {page.headings.length > 0 && (
              <div style={{ ...MUTED, marginTop: "0.25rem", lineHeight: 1.5 }}>
                {page.headings.join(" · ")}
              </div>
            )}
            {(page.oversizeCount > 0 ||
              page.inheritedSizeCount > 0 ||
              page.unmeasuredCount > 0) && (
              <div
                style={{ display: "flex", gap: "0.375rem", marginTop: "0.375rem", flexWrap: "wrap" }}
              >
                {page.oversizeCount > 0 && (
                  <span style={CHIP}>
                    {page.oversizeCount} in a pocket — no strip is tall enough
                  </span>
                )}
                {page.inheritedSizeCount > 0 && (
                  <span style={CHIP}>
                    {page.inheritedSizeCount} sized from a neighbour, not measured
                  </span>
                )}
                {page.unmeasuredCount > 0 && (
                  <span style={CHIP}>{page.unmeasuredCount} with no size at all</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* -- Printed cards (#778) -- */}

      {printedReport.sheets.length > 0 && (
        <>
          <h3 style={{ margin: "2rem 0 0.75rem", fontSize: "1rem", fontWeight: 600 }}>
            Printed cards
          </h3>
          <p style={{ ...MUTED, margin: "0 0 1rem", lineHeight: 1.6, maxWidth: "42rem" }}>
            What each card in the binder no longer says. A card is <strong>reported</strong>, never
            put right on its own: it can be out of date for a good reason for years. Where you do want
            to act there are two answers and you pick each time — a <strong>continuation page</strong>
            {" "}carrying the new stamps with a range of its own, filed after the card it continues, or
            a <strong>reprint</strong> of the whole card.
          </p>
          <div style={CARD_STYLE}>
            {printedReport.sheets.map((sheet, i) => (
              <div
                key={sheet.id}
                style={{
                  padding: "0.75rem 1rem",
                  background: "var(--color-bg-elevated)",
                  borderBottom:
                    i < printedReport.sheets.length - 1 ? "1px solid var(--color-border)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span
                    style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}
                  >
                    {sheet.range || "(no catalog numbers on this card)"}
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
                    A continuation sheet is waiting in the plan above for{" "}
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
                      <li
                        key={n}
                        style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}
                      >
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
        </>
      )}

      {markPrinted && (
        <ConfirmDialog
          title="Mark printed"
          message={`Say that ${markPrinted.label} went onto paper? The album stores everything that was on ${markPrinted.sheets.length === 1 ? "it" : "them"} — the texts as they read now, every box's size in millimetres, the strip each was cut from and the pictures — and draws that from then on, whatever changes in the collection. It can be undone, loudly.`}
          actionLabel="These went onto paper"
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
