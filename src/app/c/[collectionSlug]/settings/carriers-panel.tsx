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
  createCarrierAction,
  updateCarrierAction,
  deleteCarrierAction,
  type CarrierActionState,
} from "@/app/actions/carriers";
import type { CarrierData } from "@/lib/carriers";
import { TRACKING_CODE_TOKEN } from "@/lib/tracking-rules";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";

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

const EXAMPLE_TEMPLATE = `https://emonitoring.poczta-polska.pl/?numer=${TRACKING_CODE_TOKEN}`;

interface CarriersPanelProps {
  collectionId: string;
  initialCarriers: CarrierData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; carrier: CarrierData }
  | { kind: "delete"; carrier: CarrierData };

function CarrierForm({ carrier, isPending }: { carrier?: CarrierData; isPending: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <LabelWithError htmlFor="f-carrier-name">Name</LabelWithError>
        <input
          id="f-carrier-name"
          name="name"
          type="text"
          defaultValue={carrier?.name ?? ""}
          placeholder="e.g. Poczta Polska"
          disabled={isPending}
          required
          {...NO_AUTOFILL}
          style={INPUT_STYLE}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-carrier-template">Tracking address</LabelWithError>
        <input
          id="f-carrier-template"
          name="trackingUrlTemplate"
          type="text"
          defaultValue={carrier?.trackingUrlTemplate ?? ""}
          placeholder={EXAMPLE_TEMPLATE}
          disabled={isPending}
          {...NO_AUTOFILL}
          style={INPUT_STYLE}
        />
        <span style={HINT_STYLE}>
          Where this carrier looks a parcel up, with <code>{TRACKING_CODE_TOKEN}</code> standing in
          for the tracking number — e.g. <code>{EXAMPLE_TEMPLATE}</code>. Leave it blank if the
          carrier has no tracking page: sales still record the number, it just isn&apos;t a link.
        </span>
      </div>
    </div>
  );
}

/**
 * The collection's carriers (#491) — who actually moves the parcel, and where its consignments are
 * tracked.
 *
 * A dictionary of the collection's, not of a platform's, which is the whole reason it exists
 * separately from the [shipping methods](../contacts) that point at it: postage is priced by the
 * marketplace, but Poczta Polska tracks an Allegro parcel and a Delcampe one at the same address,
 * and a template kept per platform would be the same line typed twice and stale once.
 */
export function CarriersPanel({ collectionId, initialCarriers }: CarriersPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<CarrierActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

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
    action: (fd: FormData) => Promise<CarrierActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<CarrierActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
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
          + Add carrier
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        The post offices and couriers you send with. Each platform&apos;s shipping methods can name
        the carrier that posts by them, and a sale&apos;s tracking number then becomes a link to the
        carrier&apos;s own tracking page.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {initialCarriers.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No carriers yet. Add one to turn tracking numbers into links.
        </p>
      )}

      <div
        style={{
          border: initialCarriers.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {initialCarriers.map((carrier, i) => (
          <div
            key={carrier.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: "var(--color-bg-elevated)",
              borderBottom:
                i < initialCarriers.length - 1 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <span
              style={{
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {carrier.name}
            </span>

            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {carrier.trackingUrlTemplate ?? "no tracking page"}
            </span>

            <RowActionsMenu
              ariaLabel={`Actions for ${carrier.name}`}
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "✎",
                  onSelect: () => openDialog({ kind: "edit", carrier }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "✕",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", carrier }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add carrier" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createCarrierAction(collectionId, fd), e)}
          >
            <DialogBody>
              <CarrierForm isPending={isPending} />
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
        <DialogShell title="Edit carrier" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateCarrierAction(dialog.carrier.id, fd), e)}
          >
            <DialogBody>
              <CarrierForm carrier={dialog.carrier} isPending={isPending} />
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
          title="Delete carrier"
          message={
            <>
              Delete carrier <strong>{dialog.carrier.name}</strong>? A carrier a shipping method
              still posts with can&apos;t be deleted — detach it there first.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteCarrierAction(dialog.carrier.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
