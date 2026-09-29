"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { markFailedMailSeenAction, sendTestMailAction } from "@/app/actions/mail";
import type { MailSettings, UndeliveredMail } from "@/lib/mail/messages";
import { ACTION_ITEMS_KEY } from "../action-items-bell";

// Settings → Email (#1372; ADR-0060). Mail is configured at deployment, not here, so this page
// only reads: which provider the instance sends through and from which address, where mail arrives, a
// test button, and what did not arrive. The API key never reaches this screen.

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  margin: 0,
};

const cardStyle: React.CSSProperties = {
  padding: "1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};

const termStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
};

const valueStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  margin: 0,
  overflowWrap: "anywhere",
};

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.8125rem",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  cursor: "pointer",
};

const NEVER_CHANGES = () => () => {};

/** Timestamps after mount only: the server's clock and zone are not the collector's, and a string
 * formatted on both sides is a hydration mismatch (the Allegro panel's reasoning). */
function useMounted(): boolean {
  return useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false
  );
}

type Notice = { tone: "ok" | "error"; message: string } | null;

export function EmailPanel({
  collectionId,
  settings,
}: {
  collectionId: string;
  settings: MailSettings;
}) {
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);

  // Opening this page **is** reading the notification about undelivered mail — the notification
  // centre pointed here, and a further click to say so would be a click for nothing (#481's rule).
  // Once per mount, silent on failure: the next visit tries again.
  const acknowledged = useRef(false);
  const unseen = settings.unseenFailures;
  useEffect(() => {
    if (unseen === 0 || acknowledged.current) return;
    acknowledged.current = true;
    void (async () => {
      const result = await markFailedMailSeenAction(collectionId);
      if (result.status === "success") {
        queryClient.invalidateQueries({ queryKey: [ACTION_ITEMS_KEY, collectionId] });
      }
    })();
  }, [unseen, collectionId, queryClient]);

  function sendTest() {
    setNotice(null);
    startTransition(async () => {
      const result = await sendTestMailAction(collectionId);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else setNotice({ tone: "ok", message: `Sent to ${result.to}. Check that it arrived.` });
    });
  }

  const { config } = settings;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={cardStyle}>
        {config.state === "off" && (
          <p style={helpTextStyle}>
            Mail is not configured on this instance, so it sends none. The operator chooses a mail
            provider when installing, in <code style={codeStyle}>.env</code>.
          </p>
        )}

        {config.state === "incomplete" && (
          <p style={{ ...helpTextStyle, color: "var(--color-error)" }}>
            <strong>Mail is not usable.</strong> {config.problem} Nothing is sent until the
            instance&rsquo;s <code style={codeStyle}>.env</code> is corrected and it is restarted.
          </p>
        )}

        {config.state === "ready" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "max-content 1fr",
                columnGap: "1.5rem",
                rowGap: "0.5rem",
                alignItems: "baseline",
                margin: 0,
              }}
            >
              <dt style={termStyle}>Provider</dt>
              <dd style={valueStyle}>{config.providerLabel}</dd>
              <dt style={termStyle}>Sent from</dt>
              <dd style={valueStyle}>{config.from}</dd>
              <dt style={termStyle}>Sent to</dt>
              <dd style={valueStyle}>
                {settings.recipient}
                <span style={{ ...helpTextStyle, display: "block" }}>Your account&rsquo;s address.</span>
              </dd>
            </dl>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={sendTest}
                disabled={isPending}
                style={{ ...secondaryButtonStyle, opacity: isPending ? 0.6 : 1 }}
              >
                {isPending ? "Sending…" : "Send a test message"}
              </button>
              {notice && (
                <p
                  role="status"
                  style={{
                    ...helpTextStyle,
                    color:
                      notice.tone === "error"
                        ? "var(--color-error)"
                        : "var(--color-success, var(--color-accent))",
                  }}
                >
                  {notice.message}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {settings.undelivered.length > 0 && (
        <UndeliveredList messages={settings.undelivered} />
      )}
    </div>
  );
}

function UndeliveredList({ messages }: { messages: UndeliveredMail[] }) {
  const mounted = useMounted();
  const when = (iso: string | null) => (iso ? (mounted ? new Date(iso).toLocaleString() : "…") : "");

  return (
    <div style={cardStyle}>
      <h3
        style={{
          fontSize: "0.9375rem",
          fontWeight: 600,
          margin: "0 0 0.75rem",
          color: "var(--color-text-primary)",
        }}
      >
        Not delivered
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
        {messages.map((m) => (
          <li key={m.id} style={{ display: "grid", gap: "0.125rem" }}>
            <span style={valueStyle}>{m.subject}</span>
            <span
              style={{
                ...helpTextStyle,
                color: m.status === "failed" ? "var(--color-error)" : "var(--color-warning)",
              }}
            >
              {m.status === "failed"
                ? `Gave up ${when(m.failedAt)} after ${m.attempts} attempts.`
                : `Still trying — ${m.attempts} ${m.attempts === 1 ? "attempt" : "attempts"} so far, next ${when(m.nextAttemptAt)}.`}
            </span>
            {m.lastError && <span style={helpTextStyle}>{m.lastError}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
