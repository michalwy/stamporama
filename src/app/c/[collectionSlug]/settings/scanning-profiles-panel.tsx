"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ConfirmDialog,
  DialogActions,
  DialogBody,
  DialogShell,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  calibrateScanningProfileAction,
  createScanningProfileAction,
  deleteScanningProfileAction,
  setDefaultScanningProfileAction,
  updateScanningProfileAction,
  type ScanningProfileActionState,
} from "@/app/actions/scanning-profiles";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { DEFAULT_SCAN_DPI, parseScanDpi } from "@/lib/scan-measure";
import { formatCalibration, type ScanningProfileListRow } from "@/lib/scanning-profile";
import { ScanningCalibrationDialog } from "./scanning-calibration-dialog";

// Settings → Scanners (#1443): the scanners measurements are taken with.
//
// **One is the default** — what a new scan is offered and what a picture with no scan behind it opens
// on — and **a profile in use cannot be deleted** (collector's call, 2026-09-28). The row says what
// uses it, so the refusal is visible before the menu is opened; the server refuses again whatever the
// screen says.
//
// Editing the nominal resolution drops a calibration, which the edit dialog says: a calibration is a
// scanner's distance from the resolution it was set to, and set to another it is another measurement.

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

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; profile: ScanningProfileListRow }
  | { kind: "calibrate"; profile: ScanningProfileListRow }
  | { kind: "uncalibrate"; profile: ScanningProfileListRow }
  | { kind: "delete"; profile: ScanningProfileListRow };

/** What uses a profile, in words — or null when nothing does. */
function usesOf(profile: ScanningProfileListRow): string | null {
  const parts = [
    profile.isDefault ? "the default" : null,
    profile.scanCount > 0 ? `${profile.scanCount} ${profile.scanCount === 1 ? "scan" : "scans"}` : null,
    profile.stampSizeCount > 0
      ? `${profile.stampSizeCount} stamp ${profile.stampSizeCount === 1 ? "size" : "sizes"}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function ProfileForm({
  profile,
  isPending,
}: {
  profile?: ScanningProfileListRow;
  isPending: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <LabelWithError htmlFor="f-scan-profile-name">Scanner</LabelWithError>
        <TextInput
          id="f-scan-profile-name"
          name="name"
          defaultValue={profile?.name ?? ""}
          disabled={isPending}
          placeholder="e.g. Epson V600"
          style={INPUT_STYLE}
        />
        <span style={HINT_STYLE}>
          What you call the scanner. The resolution is shown beside the name wherever the profile is
          named, so it need not be part of it.
        </span>
      </div>
      <div>
        <LabelWithError htmlFor="f-scan-profile-dpi">Resolution (dpi)</LabelWithError>
        <TextInput
          id="f-scan-profile-dpi"
          name="nominalDpi"
          inputMode="numeric"
          defaultValue={String(profile?.nominalDpi ?? DEFAULT_SCAN_DPI)}
          disabled={isPending}
          style={{ ...INPUT_STYLE, width: "8rem" }}
        />
        <span style={HINT_STYLE}>
          What the scanner is set to. A profile you scan at two resolutions with is two profiles —
          each is calibrated on its own.
        </span>
      </div>
    </div>
  );
}

export function ScanningProfilesPanel({
  collectionId,
  initialProfiles,
}: {
  collectionId: string;
  initialProfiles: ScanningProfileListRow[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<ScanningProfileActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  function openDialog(d: DialogState) {
    setActionState(null);
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function run(action: () => Promise<ScanningProfileActionState>, closeOnSuccess = true) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") {
        if (closeOnSuccess) setDialog({ kind: "none" });
        router.refresh();
      }
    });
  }

  function submitForm(
    e: React.FormEvent<HTMLFormElement>,
    save: (name: string, dpi: number) => Promise<ScanningProfileActionState>
  ) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "");
    const dpi = parseScanDpi(String(fd.get("nominalDpi") ?? ""));
    if (dpi === null) {
      setActionState({ status: "error", message: "The resolution must be a whole number of dpi." });
      return;
    }
    run(() => save(name, dpi));
  }

  const error = actionState?.status === "error" ? actionState.message : undefined;
  const listError = dialog.kind === "none" ? error : undefined;

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
          + Add profile
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        The scanners you measure scans with. A scanner rarely delivers exactly the resolution it is
        set to — 1200 dpi may really be 1195 across the glass and 1198 along it — and on a 25 mm
        stamp that is a few tenths of a millimetre. Calibrate a profile from a scan of a ruler and
        the ruler, the size and the perforation gauge use its real resolution, each axis on its own.
        The default is what a new scan is offered and what a photo is measured with unless you pick
        another in the measuring tool. Nothing is read from a scan&apos;s own file: its stated
        resolution can be left over from an earlier edit.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      <div
        style={{
          border: initialProfiles.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {initialProfiles.map((profile, i) => {
          const uses = usesOf(profile);
          return (
            <div
              key={profile.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom:
                  i < initialProfiles.length - 1 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem", flex: 1 }}>
                <span style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {profile.name}, {profile.nominalDpi} dpi
                  {profile.isDefault && (
                    <span
                      style={{
                        marginLeft: "0.5rem",
                        padding: "0.0625rem 0.375rem",
                        borderRadius: "0.25rem",
                        border: "1px solid var(--color-accent-border)",
                        color: "var(--color-accent)",
                        fontSize: "0.6875rem",
                        fontWeight: 500,
                      }}
                    >
                      default
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--color-text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {profile.calibration
                    ? `Calibrated: ${formatCalibration(profile.calibration)}`
                    : "Uncalibrated — measures at its nominal resolution"}
                  {uses ? ` · used by ${uses}` : ""}
                </span>
              </span>
              <RowActionsMenu
                ariaLabel="Scanning profile actions"
                actions={[
                  {
                    key: "calibrate",
                    label: profile.calibration ? "Calibrate again" : "Calibrate",
                    icon: "measure",
                    onSelect: () => openDialog({ kind: "calibrate", profile }),
                  },
                  ...(profile.calibration
                    ? [
                        {
                          key: "uncalibrate",
                          label: "Remove calibration",
                          icon: "revert" as const,
                          onSelect: () => openDialog({ kind: "uncalibrate", profile }),
                        },
                      ]
                    : []),
                  ...(profile.isDefault
                    ? []
                    : [
                        {
                          key: "default",
                          label: "Make default",
                          icon: "primary" as const,
                          onSelect: () => run(() => setDefaultScanningProfileAction(profile.id)),
                        },
                      ]),
                  {
                    key: "edit",
                    label: "Edit",
                    icon: "edit",
                    onSelect: () => openDialog({ kind: "edit", profile }),
                  },
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "delete",
                    danger: true,
                    separatorBefore: true,
                    // Refused while anything uses it (collector's call, 2026-09-28), and the entry
                    // says what — the server refuses again whatever this says.
                    disabled: uses !== null,
                    hint: uses ? `In use: ${uses}` : undefined,
                    onSelect: () => openDialog({ kind: "delete", profile }),
                  },
                ]}
              />
            </div>
          );
        })}
      </div>

      {dialog.kind === "add" && (
        <DialogShell title="Add scanning profile" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitForm(e, (name, dpi) => createScanningProfileAction(collectionId, name, dpi))
            }
          >
            <DialogBody>
              <ProfileForm isPending={isPending} />
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
        <DialogShell title="Edit scanning profile" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitForm(e, (name, dpi) =>
                updateScanningProfileAction(dialog.profile.id, { name, nominalDpi: dpi })
              )
            }
          >
            <DialogBody>
              <ProfileForm profile={dialog.profile} isPending={isPending} />
              {dialog.profile.calibration && (
                <p style={{ ...HINT_STYLE, marginTop: "1rem" }}>
                  Changing the resolution removes the calibration: it was measured at{" "}
                  {dialog.profile.nominalDpi} dpi, and at another resolution the scanner is off by a
                  different amount.
                </p>
              )}
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

      {dialog.kind === "calibrate" && (
        <ScanningCalibrationDialog
          profile={dialog.profile}
          onClose={closeDialog}
          onSaved={() => {
            setDialog({ kind: "none" });
            router.refresh();
          }}
        />
      )}

      {dialog.kind === "uncalibrate" && (
        <ConfirmDialog
          title="Remove calibration"
          message={
            <>
              Measure with <strong>{dialog.profile.name}</strong> at its nominal{" "}
              {dialog.profile.nominalDpi} dpi again? Sizes already saved keep their figures.
            </>
          }
          actionLabel="Remove"
          pendingLabel="Removing…"
          onClose={closeDialog}
          onConfirm={() => run(() => calibrateScanningProfileAction(dialog.profile.id, null))}
          isPending={isPending}
          error={error}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete scanning profile"
          message={
            <>
              Delete <strong>{dialog.profile.name}, {dialog.profile.nominalDpi} dpi</strong>? Nothing
              uses it — no scan was taken with it and no size measured with it.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => run(() => deleteScanningProfileAction(dialog.profile.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
