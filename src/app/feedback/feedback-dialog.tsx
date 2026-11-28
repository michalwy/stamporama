"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  MAX_FEEDBACK_ATTACHMENTS,
  checkFeedbackFiles,
  looksLikeFeedbackPicture,
} from "@/lib/feedback-attachment-rules";
import { formatAttachmentSize } from "@/lib/conversation-attachment-rules";
import { Icon } from "@/app/icons";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { collectFeedbackContext } from "./feedback-context";

// "Report a problem" (#2720): one dialog for both places it is opened from — a collection's
// sidebar, signed in, and the foot of a page shared with a customer, anonymous. The only
// differences are the words (the shared page's language) and the optional contact field, which is
// offered only to somebody who has no account to be reached through.
//
// **Pictures go with it** (#2727): up to five PNG, JPEG or WebP images of 10 MB each, picked or —
// the case that matters most — pasted as a screenshot anywhere in the dialog. They are checked here
// by count, size and declared type so a mistake is said at once; the server reads the bytes again.

/** A picture chosen for the report, with the address its preview is drawn from. */
interface ChosenPicture {
  key: number;
  file: File;
  preview: string;
}

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
  const [pictures, setPictures] = useState<ChosenPicture[]>([]);
  const nextKey = useRef(0);
  const previews = useRef<string[]>([]);

  // Every preview address is released when the dialog goes.
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function addPictures(files: readonly File[]) {
    if (files.length === 0) return;
    if (files.some((file) => !looksLikeFeedbackPicture(file.type))) {
      setError(labels.pictureNotPicture);
      return;
    }
    const checked = checkFeedbackFiles([...pictures.map((picture) => picture.file), ...files]);
    if (!checked.ok) {
      setError(checked.problem === "too_many" ? labels.pictureTooMany : checked.problem === "too_large" ? labels.pictureTooLarge : labels.pictureNotPicture);
      return;
    }
    setError(null);
    const added = files.map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { key: nextKey.current++, file, preview };
    });
    setPictures((current) => [...current, ...added]);
  }

  function removePicture(key: number) {
    setPictures((current) => current.filter((picture) => picture.key !== key));
  }

  async function submit() {
    if (pending || message.trim().length === 0) return;
    setPending(true);
    setError(null);
    const report = {
      kind,
      message,
      contact: anonymous ? contact : undefined,
      collectionSlug,
      website,
      ...collectFeedbackContext(),
    };
    let body: BodyInit;
    const headers: Record<string, string> = {};
    if (pictures.length > 0) {
      const form = new FormData();
      form.append("report", JSON.stringify(report));
      for (const picture of pictures) form.append("file", picture.file, picture.file.name || "screenshot.png");
      body = form;
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify(report);
    }
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers, body });
      if (response.ok) {
        toast({ message: labels.sent });
        onClose();
        return;
      }
      setError(
        response.status === 429
          ? labels.tooMany
          : response.status === 413
            ? labels.pictureTooLarge
            : response.status === 422
              ? labels.pictureNotPicture
              : labels.failed
      );
    } catch {
      setError(labels.failed);
    }
    setPending(false);
  }

  // Portalled to <body> (#2725): the sidebar that opens it is `position: sticky`, its own stacking
  // context, so drawn in place the shell's z-index ranked it only within the sidebar and the stamp
  // cards of the main column painted over it. Only ever drawn once opened, so `document` exists.
  return createPortal(
    <DialogShell title={labels.entry} onClose={onClose} dismissable={!pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onPaste={(event) => {
          // A screenshot pasted anywhere in the dialog — the message field included — is attached.
          const files = Array.from(event.clipboardData.files);
          if (files.length === 0 || pending) return;
          if (!event.clipboardData.types.includes("text/plain")) event.preventDefault();
          addPictures(files);
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

          <Pictures
            labels={labels}
            pictures={pictures}
            disabled={pending}
            onAdd={addPictures}
            onRemove={removePicture}
          />

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
    </DialogShell>,
    document.body
  );
}

/** The pictures chosen so far, each with its remove button, and the button that picks more. */
function Pictures({
  labels,
  pictures,
  disabled,
  onAdd,
  onRemove,
}: {
  labels: FeedbackLabels;
  pictures: readonly ChosenPicture[];
  disabled: boolean;
  onAdd: (files: readonly File[]) => void;
  onRemove: (key: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginTop: "1rem" }}>
      {pictures.length > 0 && (
        <ul style={{ listStyle: "none", margin: "0 0 0.5rem", padding: 0, display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {pictures.map((picture) => (
            <li
              key={picture.key}
              style={{
                position: "relative",
                width: "6rem",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                overflow: "hidden",
                background: "var(--color-bg-muted)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of a chosen file */}
              <img src={picture.preview} alt={picture.file.name} style={{ display: "block", width: "100%", height: "4.5rem", objectFit: THUMB_OBJECT_FIT }} />
              <div style={{ padding: "0.125rem 0.375rem", fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                {formatAttachmentSize(picture.file.size)}
              </div>
              <button
                type="button"
                onClick={() => onRemove(picture.key)}
                disabled={disabled}
                aria-label={`${labels.removePicture} ${picture.file.name}`}
                style={{
                  position: "absolute",
                  top: "0.25rem",
                  right: "0.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "1.5rem",
                  height: "1.5rem",
                  padding: 0,
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "999px",
                  background: "var(--color-bg-elevated)",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                <Icon name="close" size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || pictures.length >= MAX_FEEDBACK_ATTACHMENTS}
          style={{
            ...baseBtn,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            background: "transparent",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border-strong)",
          }}
        >
          <Icon name="attachment" size="sm" />
          {labels.attach}
        </button>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{labels.attachHint}</span>
      </div>
      <input
        ref={input}
        type="file"
        accept={FEEDBACK_ATTACHMENT_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          onAdd(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
