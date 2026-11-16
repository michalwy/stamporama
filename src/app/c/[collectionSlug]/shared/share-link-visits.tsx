"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogBody, DialogFooter, DialogPrimaryButton, DialogSecondaryButton, DialogShell } from "@/app/dialog-shell";
import { Tooltip } from "./tooltip";
import {
  currentShareLink,
  describeUserAgent,
  hasShareLinkVisits,
  SHARE_LINK_VISIT_RETENTION_DAYS,
  summarizeShareLinkVisits,
  visitCountText,
  type ShareLinkHistory,
  type ShareLinkHistoryEntry,
  type ShareLinkKind,
  type ShareLinkStatus,
} from "@/lib/share-link-visit-rules";

// **Who opened a share link** (#2557) — one component for the five links' dialogs (a post's preview,
// an offer's specification, a proposal, a sale and a trade): the line *Created … · last opened … ·
// 7 visits* and, beside it, *Visit history*, which opens every visit in its own window. The history
// is not drawn in the link's dialog because it can be long.
//
// It reads `GET …/share-links/[kind]/[subjectId]/visits` itself, so the five dialogs only say which
// link this is. Fresh on every focus of the window: the collector's usual check is *Open as the buyer
// sees it* in another tab and back.

/** Date and time to the minute, in the collector's own zone and the browser's own words. */
export function visitTimeText(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function visitsKey(kind: ShareLinkKind, subjectId: string) {
  return ["share-link-visits", kind, subjectId] as const;
}

function useShareLinkHistory(collectionId: string, kind: ShareLinkKind, subjectId: string, version: string) {
  return useQuery<ShareLinkHistory>({
    // `version` (the current link's creation, or none) refetches once a link is made or withdrawn.
    queryKey: [...visitsKey(kind, subjectId), version],
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/share-links/${kind}/${encodeURIComponent(subjectId)}/visits`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ShareLinkHistory;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

const META: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  margin: 0,
  lineHeight: 1.5,
};

/**
 * The link's line in its dialog, and the *Visit history* button. `createdAt` is the current link's,
 * from the dialog's own read — null when the subject has no link now, and then only the button is
 * drawn, while there are old links' visits to show.
 */
export function ShareLinkVisitsLine({
  collectionId,
  kind,
  subjectId,
  createdAt,
  style,
}: {
  collectionId: string;
  kind: ShareLinkKind;
  subjectId: string;
  createdAt: string | null;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useShareLinkHistory(collectionId, kind, subjectId, createdAt ?? "none");
  const current = data ? currentShareLink(data) : null;
  const summary = summarizeShareLinkVisits(current?.visits ?? []);
  const showHistory = !!data && hasShareLinkVisits(data);

  if (!createdAt && !showHistory) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", ...style }}>
      {createdAt && (
        <p style={META}>
          Created {visitTimeText(createdAt)}
          {summary.lastOpenedAt ? ` · last opened ${visitTimeText(summary.lastOpenedAt)}` : " · not opened yet"}
          {data && (
            <Tooltip
              content={`Openings of this link in the last ${SHARE_LINK_VISIT_RETENTION_DAYS} days. Your own, while signed in, are counted apart.`}
            >
              <span> · {visitCountText(summary)}</span>
            </Tooltip>
          )}
        </p>
      )}
      {showHistory && (
        <DialogSecondaryButton type="button" onClick={() => setOpen(true)}>
          Visit history
        </DialogSecondaryButton>
      )}
      {open && (
        <ShareLinkVisitHistoryDialog
          collectionId={collectionId}
          kind={kind}
          subjectId={subjectId}
          version={createdAt ?? "none"}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

const STATUS_HEADING: Record<ShareLinkStatus, string> = {
  current: "Current link",
  replaced: "Replaced link",
  withdrawn: "Withdrawn link",
};

function linkSubheading(link: ShareLinkHistoryEntry): string {
  const created = `created ${visitTimeText(link.createdAt)}`;
  if (link.status === "current" || !link.endedAt) return created;
  return `${created} · ${link.status} ${visitTimeText(link.endedAt)}`;
}

const CELL: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  textAlign: "left",
  verticalAlign: "top",
};

const HEAD_CELL: React.CSSProperties = {
  ...CELL,
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
};

const YOU_CHIP: React.CSSProperties = {
  display: "inline-block",
  marginLeft: "0.5rem",
  padding: "0 0.375rem",
  borderRadius: "0.25rem",
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-subtle)",
  border: "1px solid var(--color-border)",
};

/** Every visit of every link the subject has had, one row each, newest first, grouped by link. */
export function ShareLinkVisitHistoryDialog({
  collectionId,
  kind,
  subjectId,
  version,
  onClose,
}: {
  collectionId: string;
  kind: ShareLinkKind;
  subjectId: string;
  version: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useShareLinkHistory(collectionId, kind, subjectId, version);

  return (
    <DialogShell title="Visit history" onClose={onClose} maxWidth="48rem" zIndexBase={200}>
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <p style={META}>
            Every opening of the page, a reload included, kept for {SHARE_LINK_VISIT_RETENTION_DAYS} days. The
            address is shown as it arrived. Times are in your time zone.
          </p>
          {isLoading && <p style={META}>Loading…</p>}
          {isError && <p style={{ ...META, color: "var(--color-error)" }}>Could not read the visits. Please try again.</p>}
          {data?.links.map((link) => (
            <section key={link.id}>
              <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {STATUS_HEADING[link.status]}
                <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}> · {linkSubheading(link)}</span>
              </h3>
              {link.visits.length === 0 ? (
                <p style={{ ...META, marginTop: "0.375rem" }}>Not opened yet.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.375rem", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr>
                      <th style={HEAD_CELL}>When</th>
                      <th style={HEAD_CELL}>IP address</th>
                      <th style={HEAD_CELL}>Browser</th>
                    </tr>
                  </thead>
                  <tbody>
                    {link.visits.map((visit) => (
                      <tr key={visit.id}>
                        <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                          {visitTimeText(visit.at)}
                          {visit.own && <span style={YOU_CHIP}>You</span>}
                        </td>
                        <td style={{ ...CELL, fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
                          {visit.ipAddress ?? "—"}
                        </td>
                        <td style={CELL}>
                          {visit.userAgent ? (
                            <Tooltip content={visit.userAgent} maxWidth="28rem">
                              <span>{describeUserAgent(visit.userAgent)}</span>
                            </Tooltip>
                          ) : (
                            describeUserAgent(null)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogPrimaryButton type="button" onClick={onClose}>
          Close
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}
