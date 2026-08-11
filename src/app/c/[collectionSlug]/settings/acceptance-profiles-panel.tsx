"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createAcceptanceProfileAction,
  updateAcceptanceProfileAction,
  deleteAcceptanceProfileAction,
  reorderAcceptanceProfilesAction,
  type AcceptanceProfileActionState,
} from "@/app/actions/acceptance-profiles";
import type { AcceptanceProfileData } from "@/lib/acceptance-profiles";
import type { WantAcceptanceInput } from "@/lib/wants";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  useReorderList,
  InsertionLine,
  DragGrip,
  showLineAt,
  dragStyle,
} from "@/app/c/[collectionSlug]/shared/reorder-list";
import { WantAcceptanceFields } from "@/app/c/[collectionSlug]/wants/want-acceptance-fields";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useAcceptanceProfiles } from "@/app/c/[collectionSlug]/shared/use-acceptance-profiles";

// The collection's named acceptance profiles (#533; ADR-0032 §9), edited beside the three
// dictionaries they are built from.
//
// Applying one **seeds** a want — the sets are copied and the link ends there — so there is no
// in-use check on delete and no warning on edit: nothing already written can be affected. That is
// said once here, on the panel, rather than in a dialog each act has to apologise through.

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

/** Above the dialog's own panel, or an acceptance menu opens behind it — the want form's note. */
const MENU_Z_INDEX = 200;

const EMPTY: WantAcceptanceInput = {
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
};

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; profile: AcceptanceProfileData }
  | { kind: "delete"; profile: AcceptanceProfileData };

/**
 * One axis in words, on the row: `Any condition` or `MNG, MH, MNH`.
 *
 * Spelled out rather than counted (`3 conditions`), because the row is the only place a profile's
 * terms are visible without opening it, and "any mint" has to be checkable at a glance — a count
 * would send you into the dialog to find out what it counted.
 */
function axisSummary(
  ids: (string | null)[],
  anyLabel: string,
  label: (id: string | null) => string
): string {
  if (ids.length === 0) return anyLabel;
  return ids.map(label).join(", ");
}

export function AcceptanceProfilesPanel({ collectionId }: { collectionId: string }) {
  const queryClient = useQueryClient();
  // The same query the want form reads (#533), so saving here refreshes the picker there without a
  // page reload — this panel and that dialog are the two halves of one dictionary.
  const { data: profiles } = useAcceptanceProfiles(collectionId);
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<AcceptanceProfileActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  // An acceptance menu is a popover stacked above this dialog; while one is up the dialog must stop
  // dismissing itself, or one Esc would close both (#361).
  const [menuOpen, setMenuOpen] = useState(false);

  const [name, setName] = useState("");
  const [acceptance, setAcceptance] = useState<WantAcceptanceInput>(EMPTY);

  // Local ordering for optimistic drag-and-drop, re-synced whenever the server list changes — the
  // render-phase "reset state when a prop changes" pattern, over a query rather than a prop.
  const [items, setItems] = useState<AcceptanceProfileData[]>(profiles ?? []);
  const [syncedFrom, setSyncedFrom] = useState(profiles);

  if (syncedFrom !== profiles) {
    setSyncedFrom(profiles);
    setItems(profiles ?? []);
  }

  function conditionLabel(id: string | null): string {
    const row = (conditions ?? []).find((c) => c.id === id);
    return row ? row.abbreviation || row.name : "—";
  }
  function certificateLabel(id: string | null): string {
    if (id === null) return "No certificate";
    return (certificateStatuses ?? []).find((c) => c.id === id)?.name ?? "—";
  }
  function formatLabel(id: string | null): string {
    if (id === null) return "Single";
    return (formats ?? []).find((f) => f.id === id)?.name ?? "—";
  }

  function openAdd() {
    setActionState({ status: "idle" });
    setName("");
    setAcceptance(EMPTY);
    setDialog({ kind: "add" });
  }

  function openEdit(profile: AcceptanceProfileData) {
    setActionState({ status: "idle" });
    setName(profile.name);
    setAcceptance({
      conditionIds: [...profile.conditionIds],
      certificateStatusIds: [...profile.certificateStatusIds],
      formatIds: [...profile.formatIds],
    });
    setDialog({ kind: "edit", profile });
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["acceptance-profiles", collectionId] });
  }

  function run(action: () => Promise<AcceptanceProfileActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") {
        setDialog({ kind: "none" });
        refresh();
      }
    });
  }

  function move(from: number, to: number) {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    const orderedIds = next.map((p) => p.id);
    startTransition(async () => {
      const result = await reorderAcceptanceProfilesAction(collectionId, orderedIds);
      if (result.status === "success") {
        refresh();
      } else {
        // Revert on failure.
        setItems(profiles ?? []);
        setActionState(result);
      }
    });
  }

  // The shared kit: the **container** is the drop target, and `handleOnly` keeps a stray press on
  // the row body from starting a drag — these rows carry a menu button and two lines of text.
  const drag = useReorderList(items.length > 1 && !isPending, move, { handleOnly: true });

  const error = actionState.status === "error" ? actionState.message : undefined;
  const reorderError =
    actionState.status === "error" && dialog.kind === "none" ? actionState.message : undefined;

  const form = (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-profile-name">Name</LabelWithError>
        <input
          id="f-profile-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          placeholder="e.g. Any mint"
          style={INPUT_STYLE}
        />
      </div>
      {/* The very editor the want form uses, with its own profile picker off: seeding a profile
          from a profile is a question that answers itself. */}
      <WantAcceptanceFields
        collectionId={collectionId}
        value={acceptance}
        onChange={setAcceptance}
        disabled={isPending}
        profiles={false}
        menuZIndex={MENU_Z_INDEX}
        onPopoverOpenChange={setMenuOpen}
      />
    </>
  );

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={openAdd}
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
          + Add profile
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        A profile is a set of terms you can apply to a want in one pick, instead of re-choosing the
        same conditions every time. Applying one <strong>copies</strong> its terms onto the want, so
        editing or deleting a profile here never changes wants already saved. Drag a row by its ⠿
        grip to change the order they are offered in.
      </p>

      {reorderError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {reorderError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No profiles yet. Wants are entered by picking their terms directly until you add one.
        </p>
      )}

      <div
        {...(drag?.containerProps ?? {})}
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((profile, i) => (
          <div key={profile.id}>
            {showLineAt(drag, i) && <InsertionLine />}
            <div
              {...(drag?.itemProps(i) ?? {})}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
                ...dragStyle(drag, i),
              }}
            >
              {drag && (
                <span {...drag.handleProps(i)}>
                  <DragGrip label="Reorder profile" />
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.9375rem",
                    color: "var(--color-text-primary)",
                    fontWeight: 500,
                  }}
                >
                  {profile.name}
                </div>
                <div
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--color-text-muted)",
                    marginTop: "0.125rem",
                  }}
                >
                  {axisSummary(profile.conditionIds, "Any condition", conditionLabel)}
                  {" · "}
                  {axisSummary(profile.certificateStatusIds, "Any certificate", certificateLabel)}
                  {" · "}
                  {axisSummary(profile.formatIds, "Any format", formatLabel)}
                </div>
              </div>
              <RowActionsMenu
                ariaLabel="Profile actions"
                actions={[
                  { key: "edit", label: "Edit", icon: "edit", onSelect: () => openEdit(profile) },
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "delete",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => {
                      setActionState({ status: "idle" });
                      setDialog({ kind: "delete", profile });
                    },
                  },
                ]}
              />
            </div>
          </div>
        ))}
        {showLineAt(drag, items.length) && <InsertionLine />}
      </div>

      {/* ── Dialogs ── */}

      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <DialogShell
          title={dialog.kind === "add" ? "Add profile" : "Edit profile"}
          onClose={closeDialog}
          maxWidth="34rem"
          dismissable={!menuOpen}
        >
          <form
            style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              const input = { name: trimmed, ...acceptance };
              run(() =>
                dialog.kind === "add"
                  ? createAcceptanceProfileAction(collectionId, input)
                  : updateAcceptanceProfileAction(dialog.profile.id, input)
              );
            }}
          >
            <DialogBody>{form}</DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending || !name.trim()}
              cancelDisabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete profile"
          message={
            <>
              Delete <strong>{dialog.profile.name}</strong>? Wants already added on these terms keep
              them — a profile is copied when it is applied, never pointed at.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => run(() => deleteAcceptanceProfileAction(dialog.profile.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
