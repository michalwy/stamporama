"use client";

import { useEffect, useId, useRef } from "react";

export interface DialogShellProps {
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function DialogShell({
  title,
  onClose,
  footer,
  children,
}: DialogShellProps) {
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
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input, button, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
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

        <div
          style={{
            padding: "1.5rem",
            overflowY: "auto",
            flex: 1,
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              padding: "1rem 1.5rem",
              borderTop: "1px solid var(--color-border)",
              flexShrink: 0,
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
