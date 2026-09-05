"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createHawidStripAction,
  updateHawidStripAction,
  deleteHawidStripAction,
  reorderHawidStripsAction,
  type HawidStripActionState,
} from "@/app/actions/hawid-stock";
import type { HawidStripData } from "@/lib/hawid-stock";
import {
  DEFAULT_STOCK_LENGTH_MM,
  HAWID_MM_STEP,
  hawidStripLabel,
  MAX_STOCK_LENGTH_MM,
  MAX_STRIP_HEIGHT_MM,
  MIN_STOCK_LENGTH_MM,
  MIN_STRIP_HEIGHT_MM,
} from "@/lib/hawid";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Icon } from "@/app/icons";

// The hawid stock (#765) — the ref-card panel's list-and-dialog scaffolding with the formats
// panel's drag order, because both apply here: it is a dictionary of millimetres, and its order is
// the collector's.
//
// The paragraph at the top is doing real work. A collector who leaves this empty gets pages where
// every stamp is drawn as a pocket, and that has to read as *you have not described your drawer*
// rather than as a bug.

const INPUT_STYLE: React.CSSProperties = {
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

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const HINT_STYLE: React.CSSProperties = {
  display: "block",
  marginTop: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

interface HawidStockPanelProps {
  collectionId: string;
  initialStrips: HawidStripData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; strip: HawidStripData }
  | { kind: "delete"; strip: HawidStripData };

function StripForm({ strip, isPending }: { strip?: HawidStripData; isPending: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <LabelWithError htmlFor="f-hawid-height">Strip height (mm)</LabelWithError>
          <input
            id="f-hawid-height"
            name="heightMm"
            type="number"
            step={HAWID_MM_STEP}
            min={MIN_STRIP_HEIGHT_MM}
            max={MAX_STRIP_HEIGHT_MM}
            defaultValue={strip?.heightMm}
            disabled={isPending}
            style={INPUT_STYLE}
          />
          <span style={HINT_STYLE}>
            The height printed on the packet — the axis you do not cut.
          </span>
        </div>
        <div>
          <LabelWithError htmlFor="f-hawid-length">Stock length (mm)</LabelWithError>
          <input
            id="f-hawid-length"
            name="stockLengthMm"
            type="number"
            step={HAWID_MM_STEP}
            min={MIN_STOCK_LENGTH_MM}
            max={MAX_STOCK_LENGTH_MM}
            defaultValue={strip?.stockLengthMm ?? DEFAULT_STOCK_LENGTH_MM}
            disabled={isPending}
            style={INPUT_STYLE}
          />
          <span style={HINT_STYLE}>How long one strip is as sold. Usually 210 mm.</span>
        </div>
      </div>

      <div>
        <LabelWithError htmlFor="f-hawid-label">Label (optional)</LabelWithError>
        <input
          id="f-hawid-label"
          name="label"
          type="text"
          defaultValue={strip?.label ?? ""}
          disabled={isPending}
          placeholder="e.g. Hawid 264"
          style={INPUT_STYLE}
        />
        <span style={HINT_STYLE}>
          What you call this one. The height is already the identity — the label is for the packet
          you reach for.
        </span>
      </div>
    </div>
  );
}

export function HawidStockPanel({ collectionId, initialStrips }: HawidStockPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<HawidStripActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  // Local ordering for optimistic drag-and-drop, re-synced from the server on refresh — the
  // formats panel's pattern.
  const [items, setItems] = useState<HawidStripData[]>(initialStrips);
  const [syncedFrom, setSyncedFrom] = useState(initialStrips);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialStrips) {
    setSyncedFrom(initialStrips);
    setItems(initialStrips);
  }

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<HawidStripActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<HawidStripActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;

    const from = items.findIndex((s) => s.id === sourceId);
    const to = items.findIndex((s) => s.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    startTransition(async () => {
      const result = await reorderHawidStripsAction(
        collectionId,
        next.map((s) => s.id)
      );
      if (result.status === "success") {
        router.refresh();
      } else {
        setItems(initialStrips);
        setActionState(result);
      }
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const listError =
    actionState.status === "error" && dialog.kind === "none" ? actionState.message : undefined;

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add" })}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--color-action-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add strip
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        The hawid strips you actually own. An album page&apos;s box is a piece cut from one of these,
        not the stamp plus a margin: the height is whichever strip the stamp fits into, and only the
        width is cut. A stamp taller than every strip here is drawn at its own size with no strip —
        a block or a cover goes in a pocket, and the cutting list says so. Drag rows to change the
        order; where two strips are equally short, the one nearer the top is used.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No strips yet. Until you add one, every box on an album page is planned as a pocket — which
          is what an undescribed drawer honestly comes to, rather than a size nobody chose.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((strip, i) => (
          <div
            key={strip.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(strip.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(strip.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === strip.id ? "var(--color-bg-page)" : "var(--color-bg-elevated)",
              borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === strip.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
            >
              <Icon name="dragGrip" size="sm" />
            </span>
            <span
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {hawidStripLabel(strip)}
            </span>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {strip.stockLengthMm} mm long
            </span>
            <RowActionsMenu
              ariaLabel="Hawid strip actions"
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit",
                  onSelect: () => openDialog({ kind: "edit", strip }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", strip }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add hawid strip" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createHawidStripAction(collectionId, fd), e)}
          >
            <DialogBody>
              <StripForm isPending={isPending} />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit hawid strip" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateHawidStripAction(dialog.strip.id, fd), e)}
          >
            <DialogBody>
              <StripForm strip={dialog.strip} isPending={isPending} />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete hawid strip"
          message={
            <>
              Delete the <strong>{hawidStripLabel(dialog.strip)}</strong> strip? Pages you have
              already printed are unaffected; boxes planned from now on will use whatever else is in
              the stock, or be drawn as pockets.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteHawidStripAction(dialog.strip.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
