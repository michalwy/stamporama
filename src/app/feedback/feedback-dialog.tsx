"use client";

import { useState, type CSSProperties } from "react";
import { baseBtn } from "@/app/button-style";
import { formControl, multiLineFormControl } from "@/app/control-style";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  FEEDBACK_CONTACT_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  type FeedbackKind,
} from "@/lib/feedback-rules";
import type { FeedbackLabels } from "@/lib/feedback-labels";
import { collectFeedbackContext } from "./feedback-context";

// "Report a problem" (#2720): one dialog for both places it is opened from — a collection's
// sidebar, signed in, and the foot of a page shared with a customer, anonymous. The only
// differences are the words (the shared page's language) and the optional contact field, which is
// offered only to somebody who has no account to be reached through.

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
  fontSize: "0.875rem",
  color: "var(--color-text-secondary)",
};

export function FeedbackDialog({
  labels,
  collectionSlug,
  anonymous,
  onClose,
}: {
  labels: FeedbackLabels;
  /** The collection the report is sent from, inside the app. */
  collectionSlug?: string;
  /** Sent from a shared page by somebody with no account: offer the contact field. */
  anonymous: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<FeedbackKind>("problem");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending || message.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          message,
          contact: anonymous ? contact : undefined,
          collectionSlug,
          website,
          ...collectFeedbackContext(),
        }),
      });
      if (response.ok) {
        toast({ message: labels.sent });
        onClose();
        return;
      }
      setError(response.status === 429 ? labels.tooMany : labels.failed);
    } catch {
      setError(labels.failed);
    }
    setPending(false);
  }

  return (
    <DialogShell title={labels.entry} onClose={onClose} dismissable={!pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogBody>
          <div role="radiogroup" aria-label={labels.entry} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            {FEEDBACK_KINDS.map((option) => {
              const chosen = option === kind;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => setKind(option)}
                  style={{
                    ...baseBtn,
                    cursor: "pointer",
                    background: chosen ? "var(--color-accent-soft)" : "transparent",
                    color: chosen ? "var(--color-accent)" : "var(--color-text-secondary)",
                    border: `1px solid ${chosen ? "var(--color-accent-border)" : "var(--color-border-strong)"}`,
                  }}
                >
                  {labels.kind[option]}
                </button>
              );
            })}
          </div>

          <label htmlFor="feedback-message" style={label}>
            {labels.message}
          </label>
          <TextArea
            id="feedback-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={labels.messagePlaceholder}
            maxLength={FEEDBACK_MESSAGE_MAX}
            rows={7}
            data-autofocus=""
            style={{
              ...field,
              ...multiLineFormControl,
              padding: "0.5rem 0.625rem",
              minHeight: "9rem",
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.5,
            }}
          />

          {anonymous && (
            <div style={{ marginTop: "1rem" }}>
              <label htmlFor="feedback-contact" style={label}>
                {labels.contact}
              </label>
              <TextInput
                id="feedback-contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder={labels.contactPlaceholder}
                maxLength={FEEDBACK_CONTACT_MAX}
                autoComplete="email"
                style={field}
              />
            </div>
          )}

          {/* Never seen and never reached by a person; a script that fills every field fills it,
              and the server then stores nothing. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" }}>
            <TextInput
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>

          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{labels.attached}</p>
        </DialogBody>
        <DialogActions
          actionLabel={pending ? labels.sending : labels.send}
          cancelLabel={labels.cancel}
          disabled={pending || message.trim().length === 0}
          cancelDisabled={pending}
          onCancel={onClose}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
