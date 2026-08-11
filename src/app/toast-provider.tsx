"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon, type IconName } from "@/app/icons";

/**
 * Confirmation toasts (#541) — the app's one way of saying an action landed, and of handing back a
 * link to what it landed on.
 *
 * Why a toast at all
 * ------------------
 * The app already had two confirmations, and neither answers this question. The **just-added flash**
 * (#158) tints the row that appeared, which works only where the new record is on screen — it says
 * nothing when a dialog created something that belongs on another list. And an **inline error strip**
 * is what a dialog shows when something went *wrong*; success has never had a voice, so an action
 * that closed its dialog and changed a list somewhere else simply happened silently.
 *
 * What earns a toast is therefore a **completed action whose result the collector cannot see from
 * where they are standing** — and the link is the point of it: a copy created from the offer screen,
 * a sale recorded from the offer list, an issue split off a stamp. Where the result *is* on screen
 * and already flashes, a toast on top of it would be the same news twice.
 *
 * Why hand-written
 * ----------------
 * The same reason the tooltip, the multi-select filter and the dialog shell are: this is a few dozen
 * lines against a dependency, and every other overlay in the app already answers the questions a
 * toast library would answer for us — portal to `<body>`, colour tokens, reduced motion.
 *
 * Shape
 * -----
 * - **Bottom right**, above everything (`Z_INDEX`), portalled to `<body>` so no scrolling ancestor's
 *   `overflow` can clip it — the same call `MultiSelectFilter` makes.
 * - **`aria-live="polite"`**, on a region that exists before any toast does. A live region created at
 *   the same moment as its first message is a region screen readers do not announce.
 * - **Auto-dismissed**, and a toast carrying a link is given longer, because it is the only kind
 *   there is anything to *do* about. The timer **pauses on hover and on focus within**, so a link is
 *   never pulled out from under the pointer reaching for it.
 * - **Not an escape-stack layer** (#361). Nothing is trapped here and nothing is waiting on an
 *   answer, so a toast must not be what Escape closes while a dialog is open behind it — the same
 *   call the notification centre and the multi-select popover make for their own reasons.
 * - **Never used for errors that block.** A failure a dialog can show inline stays inline, where the
 *   form that caused it is: a toast is dismissed and gone, which is exactly wrong for something the
 *   collector has to act on. The `error` tone here is for a failure with **no form left on screen** —
 *   a row action that failed after its menu closed.
 */

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  /** What happened, in the collector's words. One sentence, no trailing full stop. */
  message: string;
  /** Defaults to `success` — the overwhelming case, and the one the component exists for. */
  tone?: ToastTone;
  /**
   * Where the affected entity lives. An **in-app path**, taken by `next/link`, so following it is a
   * client navigation and not a reload — the point is to get back to work, not to restart the app.
   */
  href?: string;
  /** The link's own words; defaults to a plain "View". Say what is being opened where it helps. */
  linkLabel?: string;
  /** Milliseconds on screen. Defaults to {@link LINGER_MS}, or {@link LINGER_WITH_LINK_MS} when the
   * toast carries a link. Pass one only where the default is genuinely wrong. */
  durationMs?: number;
}

interface Toast extends ToastInput {
  id: number;
}

const LINGER_MS = 4500;
/** A toast with something to click stays long enough to reach it, on a screen the collector may not
 * have been looking at when it appeared. */
const LINGER_WITH_LINK_MS = 9000;

/** Above the dialog shell's own base (100) and its overlay: an action taken *in* a dialog that
 * confirms while the dialog is still up must not confirm behind it. */
const Z_INDEX = 1000;

const TONE: Record<ToastTone, { icon: IconName; token: string }> = {
  success: { icon: "check", token: "success" },
  error: { icon: "warning", token: "error" },
  info: { icon: "suggestion", token: "info" },
};

interface ToastApi {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Show a confirmation.
 *
 * Returns a no-op outside the provider rather than throwing. The provider sits in the root layout so
 * that is not a state the app reaches, but a component that toasts must be usable in isolation — a
 * dialog rendered by a test or a screen mounted outside the shell should not crash over feedback.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NO_TOASTS;
}

const NO_TOASTS: ToastApi = { toast: () => {} };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic, so two identical messages are two toasts and React keys them apart. A counter rather
  // than a timestamp: two calls in the same millisecond are perfectly ordinary here.
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    // Newest first, and capped: an action taken in a loop (a bulk add, a run of row actions) must
    // not stack a column of toasts up the screen. What is dropped is the oldest, which is the one
    // whose link the collector has already had the chance to follow.
    setToasts((current) => [{ ...input, id }, ...current].slice(0, MAX_VISIBLE));
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const MAX_VISIBLE = 4;

/** The store that never changes: mounted-ness is a one-way answer, so there is nothing to notify. */
const subscribeNever = () => () => {};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  // Portalled after hydration, never during the first render: `document` does not exist on the
  // server, and portalled content is not in the HTML the server sent — so rendering it in the
  // pre-hydration pass is exactly the mismatch that makes React throw the tree away.
  //
  // `useSyncExternalStore` with a **null server snapshot** rather than a `useState` flipped in an
  // effect: it is the house rule for anything the server cannot know (`usePersistedFlag`), and it
  // says "this value differs between server and client" instead of causing a second render to say
  // it. Nothing is subscribed to — the answer never changes again once the client is running.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  if (!mounted) return null;

  return createPortal(
    <div
      // The region exists whether or not anything is in it, so the first toast is an *update* to a
      // live region rather than the arrival of one — which is what makes it announced at all.
      aria-live="polite"
      aria-atomic="false"
      className="no-print"
      style={{
        position: "fixed",
        right: "1.25rem",
        bottom: "1.25rem",
        zIndex: Z_INDEX,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        // The stack is only as wide as its widest toast and never intercepts a click beside one:
        // it covers a corner of every screen in the app.
        alignItems: "flex-end",
        pointerEvents: "none",
        maxWidth: "min(26rem, calc(100vw - 2.5rem))",
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TONE[toast.tone ?? "success"];
  const duration = toast.durationMs ?? (toast.href ? LINGER_WITH_LINK_MS : LINGER_MS);
  // Paused while the pointer is over the toast or the keyboard is inside it — a link that vanishes
  // as it is being reached for is worse than no link.
  const [paused, setPaused] = useState(false);

  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismiss.current(), duration);
    return () => clearTimeout(timer);
  }, [paused, duration]);

  return (
    <div
      // `status`, not `alert`: nothing here interrupts, and an alert role would talk over whatever
      // the collector is doing for what is by definition news they already expected.
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="toast-card"
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.5rem",
        padding: "0.625rem 0.75rem",
        borderRadius: "0.5rem",
        border: `1px solid var(--color-${tone.token}-border, var(--color-border))`,
        background: "var(--color-bg-elevated)",
        // The tint is a stripe rather than the whole surface: a toast is read against the screen
        // behind it, and a filled panel of colour in the corner of every action is shouting.
        borderLeft: `3px solid var(--color-${tone.token})`,
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.18)",
        fontSize: "0.8125rem",
        lineHeight: 1.5,
        color: "var(--color-text-primary)",
      }}
    >
      <span aria-hidden style={{ color: `var(--color-${tone.token})`, marginTop: "0.0625rem" }}>
        <Icon name={tone.icon} size="sm" />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {toast.message}
        {toast.href && (
          <>
            {" "}
            <Link
              href={toast.href}
              onClick={onDismiss}
              style={{
                color: "var(--color-accent)",
                fontWeight: 600,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {toast.linkLabel ?? "View"} →
            </Link>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          padding: "0 0 0 0.25rem",
          cursor: "pointer",
          color: "var(--color-text-muted)",
          lineHeight: 1,
        }}
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}
