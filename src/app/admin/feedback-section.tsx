"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { baseBtn } from "@/app/button-style";
import { formControl, multiLineFormControl } from "@/app/control-style";
import { DialogActions, DialogBody, DialogFormColumns, DialogShell, FORM_DIALOG_COLUMNS_WIDTH } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  FEEDBACK_ISSUE_URL_MAX,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_NOTE_MAX,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  feedbackExcerpt,
  isFeedbackKind,
  isFeedbackStatus,
  type FeedbackStatus,
} from "@/lib/feedback-rules";
import { updateFeedbackReportAction } from "@/app/actions/admin";

// The reports sent with "Report a problem", in the administrator's panel (#2720): the list, narrowed
// by status, and one report opened with everything sent with it and the three things an
// administrator sets — its status, the issue it became, a note.

export interface PanelReport {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  kind: string;
  message: string;
  status: string;
  issueUrl: string | null;
  adminNote: string | null;
  contact: string | null;
  route: string;
  sharedPage: string | null;
  appVersion: string;
  userAgent: string | null;
  viewport: string | null;
  language: string | null;
  timeZone: string | null;
  theme: string | null;
  recentErrors: string | null;
  user: { name: string; email: string } | null;
  collection: { name: string; slug: string } | null;
}

const card: CSSProperties = {
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  padding: "1.25rem 1.5rem",
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  borderBottom: "1px solid var(--color-border)",
};

const td: CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};

const field: CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.875rem",
};

const label: CSSProperties = {
  display: "block",
  margin: "0 0 0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function statusLabel(status: string): string {
  return isFeedbackStatus(status) ? FEEDBACK_STATUS_LABELS[status] : status;
}

function kindLabel(kind: string): string {
  return isFeedbackKind(kind) ? FEEDBACK_KIND_LABELS[kind] : kind;
}

function sender(report: PanelReport): string {
  if (report.user) return report.user.email;
  if (report.contact) return `${report.contact} (visitor)`;
  return report.source === "shared" ? "Visitor of a shared page" : "Deleted account";
}

function chip(active: boolean): CSSProperties {
  return {
    ...baseBtn,
    cursor: "pointer",
    minHeight: "2rem",
    padding: "0.25rem 0.75rem",
    background: active ? "var(--color-accent-soft)" : "transparent",
    color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
    border: `1px solid ${active ? "var(--color-accent-border)" : "var(--color-border-strong)"}`,
  };
}

export function FeedbackSection({ reports, total }: { reports: PanelReport[]; total: number }) {
  const [status, setStatus] = useState<FeedbackStatus | "all">("new");
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = status === "all" ? reports : reports.filter((report) => report.status === status);
  const open = reports.find((report) => report.id === openId) ?? null;
  const counts = new Map<string, number>();
  for (const report of reports) counts.set(report.status, (counts.get(report.status) ?? 0) + 1);

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.0625rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
        Feedback reports
      </h2>
      <div role="radiogroup" aria-label="Status" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {(["new", "triaged", "resolved", "dismissed"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={status === option}
            onClick={() => setStatus(option)}
            style={chip(status === option)}
          >
            {FEEDBACK_STATUS_LABELS[option]} ({counts.get(option) ?? 0})
          </button>
        ))}
        <button type="button" role="radio" aria-checked={status === "all"} onClick={() => setStatus("all")} style={chip(status === "all")}>
          All ({reports.length})
        </button>
      </div>
      {total > reports.length && (
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Showing the newest {reports.length} of {total}.
        </p>
      )}
      {shown.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          {status === "all" ? "No reports yet." : `No ${FEEDBACK_STATUS_LABELS[status].toLowerCase()} reports.`}
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Sent</th>
              <th style={th}>Kind</th>
              <th style={th}>Report</th>
              <th style={th}>From</th>
              <th style={th}>Page</th>
              <th style={th}>Status</th>
              <th style={th}>Issue</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((report) => (
              <tr key={report.id}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{when(report.createdAt)}</td>
                <td style={td}>{kindLabel(report.kind)}</td>
                <td style={td}>
                  <button
                    type="button"
                    onClick={() => setOpenId(report.id)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      textAlign: "left",
                      color: "var(--color-accent)",
                      cursor: "pointer",
                    }}
                  >
                    {feedbackExcerpt(report.message)}
                  </button>
                </td>
                <td style={td}>{sender(report)}</td>
                <td style={{ ...td, color: "var(--color-text-muted)", wordBreak: "break-all" }}>{report.route}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{statusLabel(report.status)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {report.issueUrl ? (
                    <a href={report.issueUrl} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>
                      #{report.issueUrl.split("/").pop()}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <ReportDialog key={open.id} report={open} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function Fact({ name, value }: { name: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt style={{ color: "var(--color-text-muted)" }}>{name}</dt>
      <dd style={{ margin: 0, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{value}</dd>
    </>
  );
}

function ReportDialog({ report, onClose }: { report: PanelReport; onClose: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(report.status);
  const [issueUrl, setIssueUrl] = useState(report.issueUrl ?? "");
  const [adminNote, setAdminNote] = useState(report.adminNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateFeedbackReportAction(report.id, { status, issueUrl, adminNote });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      toast({ message: "Report updated" });
      onClose();
    });
  }

  return (
    <DialogShell
      title={`${kindLabel(report.kind)} · ${when(report.createdAt)}`}
      onClose={onClose}
      maxWidth={FORM_DIALOG_COLUMNS_WIDTH}
      dismissable={!isPending}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <DialogBody>
          <DialogFormColumns>
            <div>
              <span style={label}>Report</span>
              <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-primary)" }}>
                {report.message}
              </p>
              <span style={label}>Sent with it</span>
              <dl
                style={{
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns: "max-content 1fr",
                  gap: "0.25rem 1rem",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-primary)",
                }}
              >
                <Fact name="From" value={sender(report)} />
                <Fact name="Account" value={report.user ? `${report.user.name} <${report.user.email}>` : null} />
                <Fact name="Collection" value={report.collection ? `${report.collection.name} (/c/${report.collection.slug})` : null} />
                <Fact name="Page" value={report.route} />
                <Fact name="Shared page" value={report.sharedPage} />
                <Fact name="Version" value={report.appVersion} />
                <Fact name="Browser" value={report.userAgent} />
                <Fact name="Window" value={report.viewport} />
                <Fact name="Language" value={report.language} />
                <Fact name="Time zone" value={report.timeZone} />
                <Fact name="Theme" value={report.theme} />
                <Fact name="Recent errors" value={report.recentErrors} />
              </dl>
            </div>
            <div>
              <label htmlFor="feedback-status" style={label}>
                Status
              </label>
              <select
                id="feedback-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                style={{ ...field, marginBottom: "1rem" }}
              >
                {FEEDBACK_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {FEEDBACK_STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
              <label htmlFor="feedback-issue" style={label}>
                GitHub issue
              </label>
              <TextInput
                id="feedback-issue"
                type="url"
                value={issueUrl}
                onChange={(event) => setIssueUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/issues/123"
                maxLength={FEEDBACK_ISSUE_URL_MAX}
                style={{ ...field, marginBottom: "1rem" }}
              />
              <label htmlFor="feedback-note" style={label}>
                Note
              </label>
              <TextArea
                id="feedback-note"
                value={adminNote}
                onChange={(event) => setAdminNote(event.target.value)}
                maxLength={FEEDBACK_NOTE_MAX}
                rows={5}
                style={{
                  ...field,
                  ...multiLineFormControl,
                  padding: "0.5rem 0.625rem",
                  minHeight: "7rem",
                  resize: "vertical",
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                }}
              />
            </div>
          </DialogFormColumns>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          disabled={isPending}
          onCancel={onClose}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
