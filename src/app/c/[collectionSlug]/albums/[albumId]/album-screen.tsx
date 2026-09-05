"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  clearAlbumEntryStampOrderAction,
  gatherAlbumEntriesAction,
  removeAlbumEntryAction,
  reorderAlbumEntriesAction,
  type AlbumActionState,
} from "@/app/actions/albums";
import type { AlbumData, AlbumEntryData } from "@/lib/albums";
import type { AlbumPlanOverview } from "@/lib/album-plan";
import { languageLabel } from "@/lib/languages";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
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
// The only comparison anyone can act on is against paper, and that is #778's divergence report.

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

interface AlbumScreenProps {
  collectionSlug: string;
  album: AlbumData;
  entries: AlbumEntryData[];
  initialOverview: AlbumPlanOverview;
}

export function AlbumScreen({
  collectionSlug,
  album,
  entries,
  initialOverview,
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
  const [isPending, startTransition] = useTransition();

  if (syncedFrom !== entries) {
    setSyncedFrom(entries);
    setItems(entries);
  }

  // The whole album, or one sheet by its **position in the list below** (#768). A position is not a
  // sheet's identity — that is its catalog range, and it never becomes a number — but asking for a
  // sheet is a different act from naming one: this number is true for the listing on screen right
  // now, and it is never printed onto anything.
  function pdfHref(sheet?: number): string {
    const base = `/api/collections/${album.collectionId}/albums/${album.id}/pdf`;
    return sheet === undefined ? base : `${base}?sheets=${sheet}`;
  }

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
              {page.printedPageId && <span style={CHIP}>Printed</span>}
              {page.continued && <span style={CHIP}>Continued</span>}
              <span style={{ ...MUTED, marginLeft: "auto" }}>
                {page.boxCount === 1 ? "1 box" : `${page.boxCount} boxes`}
              </span>
              {!page.printedPageId && (
                <Tooltip content="This sheet on its own — reprinting one card after an insertion. Print at 100% / Actual size.">
                  <a
                    href={pdfHref(i + 1)}
                    download
                    style={{ ...CHIP, textDecoration: "none", cursor: "pointer" }}
                  >
                    PDF
                  </a>
                </Tooltip>
              )}
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
