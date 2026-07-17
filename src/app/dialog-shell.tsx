"use client";

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

// ── Shell ────────────────────────────────────────────────────────────────────

export interface DialogShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function DialogShell({ title, onClose, children }: DialogShellProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const explicit = el.querySelector<HTMLElement>("[data-autofocus]");
    if (explicit) { explicit.focus(); return; }
    const first =
      el.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]), textarea, select') ??
      el.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
    first?.focus();
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgb(0 0 0 / 0.4)",
          zIndex: 100,
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 101,
          width: "100%",
          maxWidth: "32rem",
          maxHeight: "calc(100vh - 4rem)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          boxShadow: "0 8px 32px rgb(0 0 0 / 0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <h2
            id={headingId}
            style={{
              margin: 0,
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: "1.25rem",
              lineHeight: 1,
              padding: "0.25rem",
              borderRadius: "0.25rem",
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

// ── Layout sections ───────────────────────────────────────────────────────────

export function DialogBody({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "1.5rem",
      }}
    >
      {children}
    </div>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "0.75rem",
        padding: "1rem 1.5rem",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {children}
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────

const baseBtn: React.CSSProperties = {
  minHeight: "2.25rem",
  padding: "0.375rem 1rem",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
  border: "none",
};

export function DialogPrimaryButton({
  type = "submit",
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      style={{
        ...baseBtn,
        background: "var(--color-action-primary)",
        color: "#fff",
        fontWeight: 600,
        opacity: props.disabled ? 0.6 : 1,
        cursor: props.disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      {...props}
    />
  );
}

export function DialogSecondaryButton({
  type = "button",
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      style={{
        ...baseBtn,
        background: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border-strong)",
        opacity: props.disabled ? 0.6 : 1,
        cursor: props.disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      {...props}
    />
  );
}

export function DialogDestructiveButton({
  type = "button",
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      style={{
        ...baseBtn,
        background: "var(--color-bg-elevated)",
        color: "var(--color-error)",
        border: "1px solid var(--color-error-border)",
        opacity: props.disabled ? 0.6 : 1,
        cursor: props.disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      {...props}
    />
  );
}

// ── DialogActions (shorthand footer) ─────────────────────────────────────────

type DialogActionsProps = {
  actionLabel: string;
  cancelLabel?: string;
  variant?: "primary" | "destructive";
  disabled?: boolean;
  error?: ReactNode;
  onCancel?: () => void;
  onAction?: () => void;
};

export function DialogActions({
  actionLabel,
  cancelLabel = "Cancel",
  variant = "primary",
  disabled,
  error,
  onCancel,
  onAction,
}: DialogActionsProps) {
  const ActionButton = variant === "destructive" ? DialogDestructiveButton : DialogPrimaryButton;
  return (
    <DialogFooter>
      <DialogSecondaryButton onClick={onCancel} disabled={disabled}>
        {cancelLabel}
      </DialogSecondaryButton>
      <div style={{ position: "relative" }}>
        <ErrorBubble>{error}</ErrorBubble>
        <ActionButton
          type={onAction ? "button" : "submit"}
          onClick={onAction}
          disabled={disabled}
        >
          {actionLabel}
        </ActionButton>
      </div>
    </DialogFooter>
  );
}

// ── Form helpers ──────────────────────────────────────────────────────────────

type LabelWithErrorProps = {
  htmlFor?: string;
  error?: ReactNode;
  children: ReactNode;
};

export function LabelWithError({ htmlFor, error, children }: LabelWithErrorProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "0.5rem",
        minHeight: "1.25rem",
        marginBottom: "0.375rem",
        fontSize: "0.875rem",
        fontWeight: 500,
        color: "var(--color-text-secondary)",
      }}
    >
      {htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span>{children}</span>}
      {error ? (
        <span style={{ fontSize: "0.75rem", color: "var(--color-error)", lineHeight: "1.25rem" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ErrorBubble({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: "100%",
        right: 0,
        marginBottom: "0.5rem",
        padding: "0.25rem 0.5rem",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-error-border)",
        borderRadius: "0.375rem",
        color: "var(--color-error)",
        fontSize: "0.75rem",
        fontWeight: 500,
        whiteSpace: "nowrap",
        maxWidth: "16rem",
        boxShadow: "0 2px 8px rgb(0 0 0 / 0.1)",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {children}
    </div>
  );
}
