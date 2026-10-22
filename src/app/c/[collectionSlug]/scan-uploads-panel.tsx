"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { IndeterminateBar, ProgressBar } from "@/app/progress-bar";
import type { ScanInPreparation } from "@/lib/scan-notices";
import {
  scanCardTitle,
  scanProgressSummary,
  scanUploadStatusText,
} from "@/lib/scan-upload-status-rules";
import {
  discardQueuedScan,
  onScanSent,
  retryQueuedScan,
  sentScanFileName,
  useCollectionQueuedScans,
  useUploadRound,
  type QueuedScan,
} from "./shared/scan-upload-queue";
import { usePersistedFlag } from "./shared/use-persisted-flag";

/**
 * The card scans being added, on every screen (#2099, reversing #1826's place for them at the foot of
 * Card scans).
 *
 * A batch of scans carries on while the collector goes about the app — the files this tab is sending
 * live as long as the tab (`scan-upload-queue.ts`), and preparing them runs on the server (#1567) — so
 * their progress is drawn here, over the page in the bottom right corner and not displacing it,
 * rather than in a section that is out of sight the moment they leave the order.
 *
 * Two sources, one list. **The files this tab is still sending** — waiting, uploading with the bar,
 * failed with *Try again* / *Discard*, refused with *Dismiss* — and **the collection's scans in the
 * server's hands**, waiting their turn to be prepared or being prepared, read from the server so a
 * reload or another tab still shows them. Server rows come first: they are older, and a sent file
 * joins their queue behind them.
 *
 * **What leaves it.** A scan ready to cut is a batch card in the Card scans section, and the editor
 * opens on it there as before; a scan that could not be prepared, or that a closed page never sent,
 * is a lasting state of the order and stays in the section (and the bell) — not progress. With
 * nothing left the panel goes away by itself.
 *
 * **Folding is remembered** for the collector — every later appearance opens the way it was left,
 * across screens, reloads and batches (settled with the collector on 2026-10-22).
 *
 * Below the dialogs (the cut editor's footer is in this corner) and below the toasts, which stand
 * above it while it is up: it publishes its height as `--scan-uploads-panel-height`.
 */

/** How often the panel asks again while a scan is waiting or being prepared — the section's pace. */
const PREPARING_POLL_MS = 2_000;

const FOLDED_KEY = "stamporama:scan-uploads-panel:folded";

/** Under the dialog shell's base (100), over sticky toolbars and the page. */
const Z_INDEX = 90;

/** The CSS variable the toast stack reads to stand above the panel. */
const HEIGHT_VAR = "--scan-uploads-panel-height";

function scansInPreparationKey(collectionId: string) {
  return ["scans-in-preparation", collectionId] as const;
}

export function ScanUploadsPanel({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ scans: ScanInPreparation[] }>({
    queryKey: scansInPreparationKey(collectionId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/scan-sheets/uploads`);
      if (!res.ok) throw new Error("Failed to read the scans being prepared");
      return res.json();
    },
    // Asked again only while something is listed: a screen with nothing on its way costs one read.
    refetchInterval: (query) => ((query.state.data?.scans.length ?? 0) > 0 ? PREPARING_POLL_MS : false),
  });
  // A file just sent is in the server's queue now: read it at once rather than at the next tick,
  // which, with nothing listed before it, would never come.
  useEffect(
    () =>
      onScanSent((sent) => {
        if (sent.collectionId !== collectionId) return;
        void queryClient.invalidateQueries({ queryKey: scansInPreparationKey(collectionId) });
      }),
    [collectionId, queryClient]
  );

  const preparing = data?.scans ?? [];
  const queued = useCollectionQueuedScans(collectionId);
  const round = useUploadRound();
  const [folded, setFolded] = usePersistedFlag(FOLDED_KEY);

  const shown = preparing.length > 0 || queued.length > 0;
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = panelRef.current;
    if (!shown || !el) {
      root.style.removeProperty(HEIGHT_VAR);
      return;
    }
    const observer = new ResizeObserver(() => {
      root.style.setProperty(HEIGHT_VAR, `calc(${el.offsetHeight}px + 0.5rem)`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [shown]);

  if (!shown) return null;

  const uploading = queued.find((q) => q.state === "uploading");
  const summary = scanProgressSummary({
    uploading: uploading ? { position: round.sent + 1, of: Math.max(round.total, round.sent + 1) } : null,
    waiting: queued.filter((q) => q.state === "opening" || q.state === "waiting").length,
    notUploaded: queued.filter((q) => q.state === "failed" || q.state === "refused").length,
    preparing: preparing.length,
  });
  const documentHref = (purchaseId: string) => `/c/${collectionSlug}/purchases/${purchaseId}`;

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Card scans being added"
      className="no-print"
      style={{
        position: "fixed",
        right: "1.25rem",
        bottom: "1.25rem",
        zIndex: Z_INDEX,
        width: "min(26rem, calc(100vw - 2.5rem))",
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-elevated)",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.18)",
      }}
    >
      <button
        type="button"
        onClick={() => setFolded(!folded)}
        aria-expanded={!folded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          border: "none",
          background: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "0.8125rem",
          color: "var(--color-text-primary)",
        }}
      >
        <Icon name="scan" size="sm" />
        <strong style={{ flex: 1, minWidth: 0 }}>{summary}</strong>
        <Icon name={folded ? "expand" : "collapse"} size="sm" />
      </button>
      {folded && uploading && (
        <div style={{ padding: "0 0.75rem 0.5rem" }}>
          <ProgressBar fraction={uploading.fraction} />
        </div>
      )}
      {!folded && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: "50vh",
            overflowY: "auto",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          {preparing.map((scan) => (
            <PanelRow
              key={scan.id}
              title={scan.title}
              fileName={sentScanFileName(scan.id)}
              documentName={scan.documentName}
              href={documentHref(scan.purchaseId)}
              stage={`${scanUploadStatusText(scan.status)}${
                scan.status === "queued" && scan.ahead != null && scan.ahead > 0
                  ? ` · ${scan.ahead} ${scan.ahead === 1 ? "scan" : "scans"} ahead`
                  : ""
              }`}
              bar={scan.status === "preparing" ? <IndeterminateBar /> : null}
            />
          ))}
          {queued.map((scan) => (
            <QueuedRow key={scan.key} scan={scan} href={documentHref(scan.purchaseId)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a file this tab is sending says it is doing (#1568). */
function queuedScanText(scan: QueuedScan): string {
  switch (scan.state) {
    case "opening":
    case "waiting":
      return "Waiting to upload";
    case "uploading":
      return `Uploading… ${Math.round(scan.fraction * 100)}%`;
    case "failed":
      return "Upload failed";
    case "refused":
      return "Not accepted";
  }
}

/**
 * A file this tab is sending (#1568), before its bytes are all in: waiting its turn, going up with
 * the share the server has acknowledged (#590), failed part-way — with the reason and a retry that
 * resumes from what the server holds — or refused outright, with the reason and nothing to retry,
 * since the same file would be refused again.
 */
function QueuedRow({ scan, href }: { scan: QueuedScan; href: string }) {
  const failed = scan.state === "failed" || scan.state === "refused";
  return (
    <PanelRow
      title={scanCardTitle(scan)}
      fileName={scan.fileName}
      documentName={scan.documentName}
      href={href}
      stage={queuedScanText(scan)}
      failed={failed}
      error={failed ? scan.error : null}
      bar={scan.state === "uploading" ? <ProgressBar fraction={scan.fraction} /> : null}
      actions={
        <>
          {scan.state === "failed" && (
            <PanelButton onClick={() => retryQueuedScan(scan.key)}>Try again</PanelButton>
          )}
          {scan.state === "failed" && (
            <PanelButton danger onClick={() => void discardQueuedScan(scan.key)}>
              <Icon name="delete" size="sm" /> Discard
            </PanelButton>
          )}
          {scan.state === "refused" && (
            <PanelButton onClick={() => void discardQueuedScan(scan.key)}>Dismiss</PanelButton>
          )}
        </>
      }
    />
  );
}

/** One file: its name, the order it belongs to, its stage, and the bar and actions where they apply. */
function PanelRow({
  title,
  fileName,
  documentName,
  href,
  stage,
  failed = false,
  error = null,
  bar,
  actions,
}: {
  title: string;
  fileName: string | null;
  documentName: string;
  href: string;
  stage: string;
  failed?: boolean;
  error?: string | null;
  bar: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        padding: "0.5rem 0.75rem",
        borderBottom: "1px solid var(--color-border)",
        fontSize: "0.8125rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", minWidth: 0 }}>
        <strong
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {fileName ?? title}
        </strong>
        <Link href={href} style={{ flexShrink: 0, color: "var(--color-accent)" }}>
          {documentName}
        </Link>
      </div>
      {fileName && <span style={{ color: "var(--color-text-muted)" }}>{title}</span>}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span
          style={{ flex: 1, minWidth: 0, color: failed ? "var(--color-error)" : "var(--color-text-muted)" }}
        >
          {stage}
        </span>
        {actions}
      </div>
      {error && <span style={{ color: "var(--color-error)" }}>{error}</span>}
      {bar}
    </li>
  );
}

function PanelButton({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...baseBtn,
        minHeight: undefined,
        padding: "0.25rem 0.5rem",
        fontSize: "0.8125rem",
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-bg-elevated)",
        color: danger ? "var(--color-error)" : "var(--color-text-secondary)",
      }}
    >
      {children}
    </button>
  );
}
