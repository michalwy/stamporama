"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ConfirmDialog,
  DialogDestructiveButton,
  DialogError,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { languageLabel } from "@/lib/languages";
import { SETTINGS_ROW_PARAM } from "./settings-nav";
import { useLeaveGuard } from "./leave-guard";
import { SettingsPageAction } from "./settings-page-frame";
import {
  createdId,
  currentRow,
  moveItem,
  newRowKey,
  parseRowKey,
  type RowSelection,
} from "./list-detail-model";

/*
 * **List beside detail** — the first of ADR-0059's three body shapes (#1471), and the one every
 * Settings dictionary is built from: the list on the left, the selected row's fields on the right,
 * edited in place with Save and Delete. Adding a row happens in the same pane. The design rejected a
 * full-width table edited in a dialog, and a table edited in its cells (#1465).
 *
 * The pieces are separate so a page composes them rather than configuring one component through a
 * dozen props: a flat list, a grouped one (Multipliers) and a tree (Catalogs) all sit in the same
 * `ListDetail`, and each page's detail pane is its own form inside `DetailForm`.
 */

/** The list's column. Wide enough for a name, its badges and a grip; it never takes the window. */
const LIST_WIDTH = "24rem";

/**
 * The detail pane's column. **A single field never stretches across the window** — #691's reasoning,
 * which the shapes keep now that the page itself is uncapped (ADR-0059 §6).
 */
const DETAIL_WIDTH = "40rem";

/** Where the detail pane stays while a long list scrolls under the pointer — the navigation's top. */
const DETAIL_TOP = "2rem";

export function ListDetail({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `minmax(16rem, ${LIST_WIDTH}) minmax(0, ${DETAIL_WIDTH})`,
        gap: "2rem",
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0 }}>{list}</div>
      {/* Sticky, and never taller than the window: a row picked at the foot of a long list (a
          collection's colours) must not open its fields a screen above where the collector is. */}
      <div
        style={{
          position: "sticky",
          top: DETAIL_TOP,
          maxHeight: `calc(100vh - 2 * ${DETAIL_TOP})`,
          overflowY: "auto",
          minWidth: 0,
        }}
      >
        {detail}
      </div>
    </div>
  );
}

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * The selected row, **in the address** (`&row=`), so a link opens a given condition and a reload
 * keeps it. Written with `history.replaceState` rather than the router: the rows are already on the
 * page, and a router navigation would re-run the Settings loader — every dictionary the screen has —
 * on each click down a list. Next keeps `useSearchParams` in step with the native call. Replace, not
 * push, as the page's tabs do (#1430): Back leaves the page rather than stepping through its rows.
 *
 * Every change of row goes through the leave guard, so an unsaved edit is asked about first.
 */
export function useSettingsRow(): {
  selection: RowSelection;
  select: (key: string | null, opts?: { unguarded?: boolean }) => void;
} {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { guard } = useLeaveGuard();
  const selection = parseRowKey(searchParams.get(SETTINGS_ROW_PARAM));

  const select = useCallback(
    (key: string | null, opts?: { unguarded?: boolean }) => {
      const write = () => {
        const params = new URLSearchParams(window.location.search);
        if (key) params.set(SETTINGS_ROW_PARAM, key);
        else params.delete(SETTINGS_ROW_PARAM);
        const qs = params.toString();
        window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
      };
      if (opts?.unguarded) write();
      else guard(write);
    },
    [guard, pathname]
  );

  return { selection, select };
}

/**
 * Moves the pane onto the row an add created, once the refreshed list brings it (see `createdId`).
 * Call the returned function when a create succeeds, before refreshing.
 */
function useSelectCreated(
  ids: readonly string[],
  select: (key: string, opts?: { unguarded?: boolean }) => void
): () => void {
  const expecting = useRef<ReadonlySet<string> | null>(null);
  const latestIds = useRef(ids);

  useEffect(() => {
    latestIds.current = ids;
    if (!expecting.current) return;
    const created = createdId(expecting.current, ids);
    if (!created) return;
    expecting.current = null;
    // The pane that saved it has already lowered the dirty flag; nothing is left to ask about.
    select(created, { unguarded: true });
  }, [ids, select]);

  return useCallback(() => {
    expecting.current = new Set(latestIds.current);
  }, []);
}

/**
 * Selection for a flat list: which row the pane edits, whether a row is being added, and the calls
 * that change either. `order` is the list as drawn, so the default is the first row the collector
 * sees.
 */
export function useListSelection<T extends { id: string }>(order: readonly T[]) {
  const { selection, select } = useSettingsRow();
  const ids = useMemo(() => order.map((i) => i.id), [order]);
  const expectCreated = useSelectCreated(ids, select);
  const current = currentRow(order, selection);
  return {
    selection,
    current,
    adding: selection.kind === "new",
    parentId: selection.kind === "new" ? selection.parentId : null,
    select: (id: string) => select(id),
    startAdding: (parentId?: string | null) => select(newRowKey(parentId)),
    /** Leave the add pane without adding — back to the page's default row. */
    cancelAdding: () => select(null, { unguarded: true }),
    /** After a delete: the row is gone, so the pane falls back to the default. */
    cleared: () => select(null, { unguarded: true }),
    expectCreated,
  };
}

/**
 * Selection for a tree (Catalogs). The page resolves what the pane shows itself (`catalogPane`),
 * since an add there names its parent and the parent's level decides what is being added; this
 * carries the calls and the created-row check over every id in the tree.
 */
export function useTreeSelection(allIds: readonly string[]) {
  const { selection, select } = useSettingsRow();
  const expectCreated = useSelectCreated(allIds, select);
  return {
    selection,
    select: (id: string) => select(id),
    startAdding: (parentId?: string | null) => select(newRowKey(parentId)),
    cancelAdding: () => select(null, { unguarded: true }),
    cleared: () => select(null, { unguarded: true }),
    expectCreated,
  };
}

// ── Reordering ───────────────────────────────────────────────────────────────

type ActionResult = { status: string; message?: string };

/**
 * Drag to reorder, where the order matters: an optimistic local order, sent to the server on drop
 * and reverted if it is refused. Re-synced from the server's list on refresh with the render-phase
 * "reset state when a prop changes" pattern the panels used before.
 */
export function useReorderable<T extends { id: string }>(
  initial: T[],
  commit: (orderedIds: string[]) => Promise<ActionResult>,
  onCommitted: () => void
) {
  const [items, setItems] = useState<T[]>(initial);
  const [syncedFrom, setSyncedFrom] = useState(initial);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (syncedFrom !== initial) {
    setSyncedFrom(initial);
    setItems(initial);
  }

  function drop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    const next = moveItem(
      items,
      items.findIndex((i) => i.id === sourceId),
      items.findIndex((i) => i.id === targetId)
    );
    setItems(next);
    setError(null);
    startTransition(async () => {
      const result = await commit(next.map((i) => i.id));
      if (result.status === "success") {
        onCommitted();
      } else {
        setItems(initial);
        setError(result.message ?? "Could not save the new order.");
      }
    });
  }

  function drag(id: string): RowDrag {
    return {
      dragging: draggingId === id,
      disabled: isPending,
      props: {
        draggable: !isPending,
        onDragStart: () => setDraggingId(id),
        onDragEnd: () => setDraggingId(null),
        onDragOver: (e) => e.preventDefault(),
        onDrop: () => drop(id),
      },
    };
  }

  return { items, drag, error };
}

export interface RowDrag {
  dragging: boolean;
  disabled: boolean;
  props: React.LiHTMLAttributes<HTMLLIElement> & { draggable: boolean };
}

// ── The list ─────────────────────────────────────────────────────────────────

/**
 * The page's main action on a dictionary: *Add …*, at the header's right. It opens the add form in
 * the detail pane; a `disabledHint` says why it cannot (Multipliers before any format exists).
 */
export function AddRowAction({
  label,
  onAdd,
  disabledHint,
}: {
  label: string;
  onAdd: () => void;
  disabledHint?: string;
}) {
  const button = (
    <DialogPrimaryButton type="button" onClick={onAdd} disabled={!!disabledHint}>
      <Icon name="add" size="sm" />
      &nbsp;{label}
    </DialogPrimaryButton>
  );
  return (
    <SettingsPageAction>
      {disabledHint ? <Tooltip content={disabledHint}>{button}</Tooltip> : button}
    </SettingsPageAction>
  );
}

/**
 * The list column: an optional caption line with its ⓘ hint (*drag a row to change the order*), a
 * failure from a reorder, and the rows — or, with none, what an empty list means.
 */
export function ListPane({
  caption,
  hint,
  error,
  empty,
  children,
}: {
  caption?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Shown instead of the rows when there are none. */
  empty?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      {(caption || hint) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginBottom: "0.5rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          {caption && <span>{caption}</span>}
          {hint && <InfoHint>{hint}</InfoHint>}
        </div>
      )}
      {error && <DialogError style={{ marginBottom: "0.75rem" }}>{error}</DialogError>}
      {empty ? (
        <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>{empty}</p>
      ) : (
        children
      )}
    </div>
  );
}

/** One run of rows in a bordered card. A grouped list draws several, each under its heading. */
export function ListRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul
      aria-label={label}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        overflow: "hidden",
        background: "var(--color-bg-elevated)",
      }}
    >
      {children}
    </ul>
  );
}

/** A heading above one run of rows in a grouped list — a format's multipliers. */
export function ListGroupHeading({ first, children }: { first?: boolean; children: ReactNode }) {
  return (
    <h3
      style={{
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        color: "var(--color-text-muted)",
        margin: `${first ? 0 : "1.25rem"} 0 0.5rem`,
      }}
    >
      {children}
    </h3>
  );
}

/**
 * One row. The whole row selects it — a button over its content, so it is a tab stop and Enter
 * opens it — with anything that has its own click (the subtypes' default radio) as `leading`,
 * outside the button. The selected row carries the accent's plate and edge, the Settings
 * navigation's own marking of *this one*.
 */
export function ListRow({
  selected,
  onSelect,
  drag,
  depth = 0,
  leading,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  drag?: RowDrag;
  /** Indentation in a tree (Catalogs): 0 for a vendor, 1 for a catalog name, 2 for an edition. */
  depth?: number;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      {...drag?.props}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        paddingLeft: `${0.75 + depth * 1.25}rem`,
        paddingRight: "0.75rem",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: "-1px",
        background: selected ? "var(--color-accent-soft)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 var(--color-accent)" : undefined,
        opacity: drag?.dragging ? 0.5 : 1,
        cursor: drag && !drag.disabled ? "grab" : undefined,
      }}
    >
      {drag && (
        <span aria-hidden style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
          <Icon name="dragGrip" size="sm" />
        </span>
      )}
      {leading}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          padding: "0.625rem 0",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          fontSize: "0.9375rem",
          color: "var(--color-text-primary)",
        }}
      >
        {children}
      </button>
    </li>
  );
}

/** A row's name: it takes the room, and yields — ellipsised — before any badge beside it does. */
export function RowName({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontWeight: strong ? 600 : 500,
      }}
    >
      {children}
    </span>
  );
}

/** `4 conditions`, `1 condition` — the list's caption. */
export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A small muted tag on a row — *Default*, a currency, a percentage. */
export function RowTag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: "0.6875rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        color: tone === "accent" ? "var(--color-accent)" : "var(--color-text-muted)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.25rem",
        padding: "0.05rem 0.35rem",
      }}
    >
      {children}
    </span>
  );
}

// ── The detail pane ──────────────────────────────────────────────────────────

const PANE_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};

/** What the pane says with no row to show — an empty list, typically. */
export function DetailPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        ...PANE_STYLE,
        padding: "2rem 1.5rem",
        fontSize: "0.875rem",
        color: "var(--color-text-muted)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

/** A form's entries as one comparable string: what *unsaved* is measured against. */
function serializeForm(form: HTMLFormElement): string {
  return JSON.stringify(
    [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name])
  );
}

/** How a row is taken out of the list: the pane's destructive action and the question before it. */
export interface RemoveRow {
  title: string;
  message: ReactNode;
  run: () => Promise<ActionResult>;
  onDone: () => void;
  /** The verb on the button and the dialog — *Delete*, unless a row ends another way (a token is
   *  revoked). */
  label?: string;
  pendingLabel?: string;
  /** Why the row cannot go yet (a scanner still in use): the button is shown, disabled, with this
   *  as its tooltip — the refusal is visible before anything is clicked. */
  disabledHint?: string;
}

/** The pane's header: where the row sits, its name, and a secondary action at the right. */
function DetailHeader({
  title,
  context,
  headerAction,
}: {
  title: ReactNode;
  context?: ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "1rem 1.5rem",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        {context && (
          <p style={{ margin: "0 0 0.125rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {context}
          </p>
        )}
        <h3
          style={{
            margin: 0,
            fontSize: "1rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </h3>
      </div>
      {headerAction && <div style={{ flexShrink: 0 }}>{headerAction}</div>}
    </div>
  );
}

/**
 * The pane's destructive button and its confirmation. The confirmation **portals to `<body>`**: the
 * pane is sticky, which makes it a stacking context of its own, and a dialog left inside it would
 * rank only within the pane — the app's header painting over it.
 */
function RemoveButton({
  remove,
  disabled,
  onRemoved,
}: {
  remove: RemoveRow;
  disabled: boolean;
  /** Before the page moves on: the pane that goes takes its unsaved flag with it. */
  onRemoved?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const label = remove.label ?? "Delete";

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await remove.run();
      if (result.status !== "success") {
        setError(result.message ?? `Could not ${label.toLowerCase()}.`);
        return;
      }
      setConfirming(false);
      onRemoved?.();
      remove.onDone();
    });
  }

  const button = (
    <DialogDestructiveButton
      onClick={() => {
        setError(null);
        setConfirming(true);
      }}
      disabled={disabled || isPending || !!remove.disabledHint}
    >
      <Icon name="delete" size="sm" />
      &nbsp;{label}
    </DialogDestructiveButton>
  );

  return (
    <>
      {remove.disabledHint ? <Tooltip content={remove.disabledHint}>{button}</Tooltip> : button}
      {confirming &&
        createPortal(
          <ConfirmDialog
            title={remove.title}
            message={remove.message}
            actionLabel={label}
            pendingLabel={remove.pendingLabel ?? "Deleting…"}
            isPending={isPending}
            error={error}
            onClose={() => {
              if (!isPending) setConfirming(false);
            }}
            onConfirm={confirm}
          />,
          document.body
        )}
    </>
  );
}

/**
 * The selected row's fields, edited in place (#1471). One form, one Save — the fields are the
 * page's `children` — with Delete beside it behind a confirmation, since that one cannot be undone.
 *
 * **What is unsaved is measured, not tracked**: the form's entries when it opened, against its
 * entries after every change. So typing a name and typing it back is not a change, and a field
 * that keeps its value in state (a colour, a translation) is compared exactly like a plain one. It
 * is what the leave guard asks about, and what *Revert* undoes — by remounting the fields, which
 * reads every default again.
 */
export function DetailForm({
  title,
  context,
  isNew,
  headerAction,
  saveLabel,
  savingLabel,
  onSave,
  onSaved,
  onCancelNew,
  remove,
  children,
}: {
  title: string;
  /** A line above the title — where the row sits (a catalog name's vendor). */
  context?: ReactNode;
  isNew: boolean;
  /** A secondary action in the pane's header — *Add catalog name* on a vendor. */
  headerAction?: ReactNode;
  /** The submit button's words when *Add* / *Save* do not say it — a token is *Generate*d. */
  saveLabel?: string;
  savingLabel?: string;
  onSave: (formData: FormData) => Promise<ActionResult>;
  /** After a successful save: refresh what the page shows. */
  onSaved: () => void;
  /** Leave an add without adding. */
  onCancelNew?: () => void;
  remove?: RemoveRow;
  children: ReactNode;
}) {
  const { setDirty: setGuardDirty } = useLeaveGuard();
  const formRef = useRef<HTMLFormElement>(null);
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const markDirty = useCallback(
    (next: boolean) => {
      setDirty(next);
      setGuardDirty(next);
    },
    [setGuardDirty]
  );

  // The baseline is the form as it opened — and again after each revert, which remounts it.
  useEffect(() => {
    if (formRef.current) baseline.current = serializeForm(formRef.current);
  }, [revision]);

  // A pane that goes — another row, another page — takes its flag with it.
  useEffect(() => () => setGuardDirty(false), [setGuardDirty]);

  function measure() {
    // After the event: a field kept in state has re-rendered by then, so the form holds its value.
    setTimeout(() => {
      const form = formRef.current;
      if (!form || baseline.current === null) return;
      markDirty(serializeForm(form) !== baseline.current);
    }, 0);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await onSave(data);
      if (result.status !== "success") {
        setError(result.message ?? "Could not save.");
        return;
      }
      // What was saved is the new baseline; the flag goes down before the page moves anywhere.
      baseline.current = serializeForm(form);
      markDirty(false);
      onSaved();
    });
  }

  function revert() {
    setError(null);
    markDirty(false);
    setRevision((r) => r + 1);
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onChange={measure}
      onInput={measure}
      onBlur={measure}
      style={PANE_STYLE}
    >
      <DetailHeader title={title} context={context} headerAction={headerAction} />

      <fieldset
        disabled={isPending}
        style={{ border: 0, margin: 0, minWidth: 0, padding: "1.25rem 1.5rem" }}
      >
        <Fragment key={revision}>{children}</Fragment>
      </fieldset>

      <div style={{ padding: "0 1.5rem 1.25rem" }}>
        {error && <DialogError style={{ marginBottom: "0.75rem" }}>{error}</DialogError>}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {remove && !isNew && (
            <RemoveButton remove={remove} disabled={isPending} onRemoved={() => markDirty(false)} />
          )}
          <div style={{ flex: 1 }} />
          {isNew ? (
            <DialogSecondaryButton onClick={onCancelNew} disabled={isPending}>
              Cancel
            </DialogSecondaryButton>
          ) : (
            dirty && (
              <DialogSecondaryButton onClick={revert} disabled={isPending}>
                <Icon name="revert" size="sm" />
                &nbsp;Revert
              </DialogSecondaryButton>
            )
          )}
          <DialogPrimaryButton disabled={isPending}>
            {isPending
              ? (savingLabel ?? "Saving…")
              : (saveLabel ?? (isNew ? "Add" : "Save"))}
          </DialogPrimaryButton>
        </div>
      </div>
    </form>
  );
}

/**
 * A pane with **nothing to save** — a row that is read, not edited (an uploaded ornament, a token):
 * the same header and card as `DetailForm`, the page's content, and the row's own actions at the
 * foot, Delete (or Revoke) on the left as in the form.
 */
export function DetailCard({
  title,
  context,
  headerAction,
  actions,
  remove,
  children,
}: {
  title: ReactNode;
  context?: ReactNode;
  headerAction?: ReactNode;
  /** The row's other actions, at the foot's right. */
  actions?: ReactNode;
  remove?: RemoveRow;
  children: ReactNode;
}) {
  return (
    <div style={PANE_STYLE}>
      <DetailHeader title={title} context={context} headerAction={headerAction} />
      <div style={{ padding: "1.25rem 1.5rem" }}>{children}</div>
      {(remove || actions) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0 1.5rem 1.25rem",
          }}
        >
          {remove && <RemoveButton remove={remove} disabled={false} />}
          <div style={{ flex: 1 }} />
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * What a row *is*, as label and value down the pane — the facts shown rather than edited (a token's
 * reach, a scanner's calibration).
 */
export function DetailFacts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(8rem, auto) minmax(0, 1fr)",
        columnGap: "1rem",
        rowGap: "0.5rem",
        margin: 0,
        fontSize: "0.875rem",
      }}
    >
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt style={{ color: "var(--color-text-muted)" }}>{r.label}</dt>
          <dd style={{ margin: 0, color: "var(--color-text-primary)", minWidth: 0 }}>{r.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

// ── Fields ───────────────────────────────────────────────────────────────────

export const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

/** Spacing between the fields of a detail pane. */
export function Fields({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem" }}>{children}</div>;
}

/**
 * An ⓘ with its explanation in a tooltip — where a page's standing paragraphs went (#1430, #1460):
 * beside the field or the list they explain, and in the user guide.
 */
export function InfoHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip content={children} maxWidth="22rem">
      <span
        role="img"
        aria-label={typeof children === "string" ? children : "More about this"}
        style={{
          display: "inline-flex",
          color: "var(--color-text-muted)",
          cursor: "help",
          verticalAlign: "middle",
        }}
      >
        <Icon name="info" size="sm" />
      </span>
    </Tooltip>
  );
}

/** The one short line a field may carry (#1460) — only where its name does not already say it. */
export function FieldNote({ children }: { children: ReactNode }) {
  // A span drawn as a block, so it can sit inside a checkbox's label as well as under a field.
  return (
    <span
      style={{
        display: "block",
        marginTop: "0.375rem",
        fontSize: "0.75rem",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

export interface TranslatedField {
  /** The column the action reads — the inputs are named `<key>:<lang>`. */
  key: string;
  label: string;
  /** The default-language text a blank entry falls back to — shown as the placeholder. */
  fallback: string;
  /** Stored per-language values for this field; absent when adding. */
  stored?: Record<string, string>;
  /** Narrow columns for short values (an abbreviation). */
  narrow?: boolean;
}

/**
 * **Translations in the pane, not in a dialog over it** (#1471). The 🌐 dialog kept a form of three
 * fields short (#293); a detail pane has the room, and one field per language beside the default
 * text is fewer steps than a dialog per field. Each language is a row, each translatable field a
 * column — so a condition's name and its abbreviation stay separate answers, as #294 wanted, and a
 * blank entry still falls back to the default text shown as its placeholder.
 *
 * The inputs are the ones the 🌐 field submitted as hidden values (`<field>:<lang>`), so the actions
 * read them unchanged; a cleared one submits blank, which drops that language's row.
 */
export function TranslationRows({
  languages,
  fields,
  hint,
}: {
  /** Languages needing a translation. Empty draws nothing. */
  languages: string[];
  fields: TranslatedField[];
  hint?: ReactNode;
}) {
  if (languages.length === 0) return null;
  const columns = fields.map((f) => (f.narrow ? "minmax(0, 8rem)" : "minmax(0, 1fr)")).join(" ");
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          marginBottom: "0.5rem",
          fontSize: "0.875rem",
          fontWeight: 500,
          color: "var(--color-text-secondary)",
        }}
      >
        <Icon name="translations" size="sm" />
        In other languages
        <InfoHint>
          {hint ??
            "One entry per language your platforms list in. Leave one blank to use the default text above. Saved together with the rest."}
        </InfoHint>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(6rem, auto) ${columns}`,
          columnGap: "0.75rem",
          rowGap: "0.5rem",
          alignItems: "center",
        }}
      >
        {fields.length > 1 && (
          <>
            <span />
            {fields.map((f) => (
              <span key={f.key} style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                {f.label}
              </span>
            ))}
          </>
        )}
        {languages.map((lang) => (
          <Fragment key={lang}>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
              {languageLabel(lang)}
            </span>
            {fields.map((f) => (
              <TextInput
                key={f.key}
                name={`${f.key}:${lang}`}
                defaultValue={f.stored?.[lang] ?? ""}
                placeholder={f.fallback || undefined}
                aria-label={`${f.label} — ${languageLabel(lang)}`}
                style={INPUT_STYLE}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
