"use client";

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";

import { useEscapeLayer } from "@/app/escape-stack";
import { Icon } from "@/app/icons";

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * The two `aside` props on their own (#592), so a dialog that merely **forwards** a companion
 * column to its shell says so in one line instead of restating the contract. `StampPickerBrowser`,
 * `IssueDialog` and `StampFormDialog` all do exactly that: the chain of dialogs identifying a scan
 * tile has to carry the piece's picture through every one of them, and none of them has any
 * business knowing what it is looking at.
 */
export interface DialogAsideProps {
  aside?: ReactNode;
  asideWidth?: string;
}

export interface DialogShellProps {
  title: string;
  onClose: () => void;
  minHeight?: string;
  /** Overrides the default 32rem cap for wide dialogs. */
  maxWidth?: string;
  /** Fixes the panel height so its content scrolls internally instead of resizing the dialog. */
  height?: string;
  /** Base stacking order (overlay = base, panel = base + 1). Default 100. Raise it for a dialog
   * stacked on top of another so it paints above the one beneath (e.g. a picker opened from
   * inside another dialog). */
  zIndexBase?: number;
  /** Whether pressing Escape or clicking the backdrop closes this dialog (default true). Nested
   * dialogs already take Escape for themselves through the shared layer stack (#361); set this
   * false while a surface that is *not* a layer owns the key (a popover with its own listener),
   * or to keep a backdrop click from dismissing the dialog. */
  dismissable?: boolean;
  /**
   * A column drawn to the **left of the dialog's own content**, under the shared header (#592).
   *
   * It exists because *the subject of a question can outlive the dialog asking it*: identifying a
   * scan tile walks through the picker, sometimes a create-issue and a create-stamp dialog, and
   * then the condition step, and the piece being identified has to be visible at every one of them.
   * A slot here rather than a two-column body hand-rolled in each of those dialogs, for the reason
   * the header and the footer are shared: four of them would be four layouts to keep in step, and
   * the two that are shared across the app (`IssueDialog`, `StampFormDialog`) would each grow a
   * private notion of what sits beside their form.
   *
   * It is a `ReactNode` and nothing more specific on purpose — the shell must not learn what a scan
   * tile is, and the purchases screen keeps its viewer.
   */
  aside?: ReactNode;
  /** Width of the `aside` column; ignored without one. The aside is fixed and the dialog's own
   * content flexes, which is what lets one dialog put a picker's whole browser beside it and
   * another a narrow form. */
  asideWidth?: string;
  children: ReactNode;
}

export function DialogShell({
  title,
  onClose,
  minHeight,
  maxWidth,
  height,
  zIndexBase = 100,
  dismissable = true,
  aside,
  asideWidth = "24rem",
  children,
}: DialogShellProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEscapeLayer(onClose, dismissable);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    // Opt-in: focus AND select the field's text, so a remembered value (e.g. a picker's last
    // search term) is overwritten by the first keystroke instead of appended to (#183).
    const selectTarget = el.querySelector<HTMLElement>("[data-autofocus-select]");
    if (selectTarget) {
      selectTarget.focus();
      if (
        selectTarget instanceof HTMLInputElement ||
        selectTarget instanceof HTMLTextAreaElement
      ) {
        selectTarget.select();
      }
      return;
    }
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
        onClick={dismissable ? onClose : undefined}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgb(0 0 0 / 0.4)",
          zIndex: zIndexBase,
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
          zIndex: zIndexBase + 1,
          width: "100%",
          maxWidth: maxWidth ?? "32rem",
          maxHeight: "calc(100vh - 4rem)",
          height,
          minHeight,
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
              display: "inline-flex",
              alignItems: "center",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: "0.25rem",
              borderRadius: "0.25rem",
            }}
          >
            <Icon name="close" size="lg" />
          </button>
        </div>
        {aside ? (
          // The header spans both columns and the footer stays inside the dialog's own content, so
          // an aside changes what is *beside* the form and nothing about the form itself. Padded on
          // its own three sides only: `DialogBody`'s left padding is the gap between the two, so a
          // dialog reads the same whether it has an aside or not.
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <div
              style={{
                width: asideWidth,
                flexShrink: 0,
                display: "flex",
                minWidth: 0,
                minHeight: 0,
                padding: "1.5rem 0 1.5rem 1.5rem",
              }}
            >
              {aside}
            </div>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {children}
            </div>
          </div>
        ) : (
          children
        )}
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

/**
 * Every dialog button, so the three variants are the same shape and only their colours differ.
 *
 * Two details exist to keep a footer's buttons the **same height**, which they were not:
 *
 * - `inline-flex` centring rather than the default inline layout. `Icon` is an inline-block with a
 *   `vertical-align` below the baseline, so an icon inside a button stretches its line box and the
 *   button grows — leaving *Discard* and *Assign…* a couple of pixels taller than a plain-text
 *   primary beside them. Laid out as a centred flex row, the icon no longer participates in a line
 *   box at all. Deliberately **no `gap`**: call sites write `<Icon /> Label`, and that literal space
 *   is their spacing — adding a gap would silently widen every one of them.
 * - a **transparent** border rather than none. The secondary and destructive variants draw a 1px
 *   border; without a placeholder here the primary would be 2px shorter whenever the content
 *   exceeds `minHeight`.
 */
const baseBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "2.25rem",
  padding: "0.375rem 1rem",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid transparent",
};

/** `ComponentPropsWithRef` rather than plain attributes so a `ref` reaches the button: a grid whose
 *  Tab walk ends at Save (#726) has to be able to put focus on it. */
export function DialogPrimaryButton({
  type = "submit",
  style,
  ...props
}: ComponentPropsWithRef<"button">) {
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

/**
 * A footer action that **goes somewhere** — the secondary button's shape, drawn as a real `<a>`.
 *
 * The same rule row menus follow (#557): an entry with an address carries `href` rather than an
 * `onClick` calling `router.push`, because a push navigates on a plain left click and on nothing
 * else — cmd/ctrl+click opens the destination in the same tab, the middle button does nothing, and
 * the browser's context menu has no *Open link in new tab* to offer. On a dialog that is the way
 * *out* of a screen being worked through, that matters more than anywhere: opening the destination
 * beside the work is the whole reason to leave (a consumed scan tile's copy, #584).
 */
export function DialogLinkButton({
  href,
  style,
  children,
}: {
  href: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        ...baseBtn,
        background: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border-strong)",
        textDecoration: "none",
        ...style,
      }}
    >
      {children}
    </a>
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
  /** Disabled state for the Cancel button. Defaults to `disabled`. Set this separately
   *  when Save is gated by form validity but Cancel should stay clickable (typically only
   *  blocked while a mutation is in flight) — cancelling never needs valid input (#240). */
  cancelDisabled?: boolean;
  error?: ReactNode;
  onCancel?: () => void;
  onAction?: () => void;
  /** Content pinned to the left of the footer, opposite the buttons — its own group, laid out as a
   *  row so several items in it read as one set rather than as loose buttons.
   *
   *  Two things belong here. A control that **qualifies the action** — "regenerate photos after
   *  saving" (#328) — because it belongs beside the button it changes rather than at the end of the
   *  form. And the **other ways out**: a step back, or an alternative outcome (#567's *Discard*),
   *  which are neither the action nor cancelling and would otherwise crowd them. */
  leading?: ReactNode;
};

export function DialogActions({
  actionLabel,
  cancelLabel = "Cancel",
  variant = "primary",
  disabled,
  cancelDisabled,
  error,
  onCancel,
  onAction,
  leading,
}: DialogActionsProps) {
  const ActionButton = variant === "destructive" ? DialogDestructiveButton : DialogPrimaryButton;
  // Two groups, by role: the other ways out on the left, cancel and the action on the right. Each
  // group is spaced tightly within itself and pushed apart by the gap between them, so a footer of
  // four buttons reads as two decisions rather than as four unrelated ones. Grouping this way is
  // also what stops `leading` from setting the spacing by accident, which is what it did when it
  // was a bare `margin-right: auto` and its content sat in the same run as the buttons.
  return (
    <DialogFooter>
      {leading != null && (
        <div
          style={{
            marginRight: "auto",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {leading}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <DialogSecondaryButton onClick={onCancel} disabled={cancelDisabled ?? disabled}>
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

// ── ConfirmDialog ────────────────────────────────────────────────────────────

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  actionLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "destructive";
  isPending?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  actionLabel,
  pendingLabel,
  variant = "destructive",
  isPending,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <DialogShell title={title} onClose={onClose}>
      <DialogBody>
        <p
          style={{
            margin: 0,
            fontSize: "0.9375rem",
            color: "var(--color-text-primary)",
            lineHeight: 1.6,
          }}
        >
          {message}
        </p>
      </DialogBody>
      <DialogActions
        actionLabel={isPending && pendingLabel ? pendingLabel : actionLabel}
        variant={variant}
        onCancel={onClose}
        onAction={onConfirm}
        disabled={isPending}
        error={error}
      />
    </DialogShell>
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
