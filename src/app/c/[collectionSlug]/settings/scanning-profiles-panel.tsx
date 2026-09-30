"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ConfirmDialog,
  DialogError,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  calibrateScanningProfileAction,
  createScanningProfileAction,
  deleteScanningProfileAction,
  setDefaultScanningProfileAction,
  updateScanningProfileAction,
} from "@/app/actions/scanning-profiles";
import { Icon } from "@/app/icons";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { DEFAULT_SCAN_DPI, parseScanDpi } from "@/lib/scan-measure";
import { formatCalibration, type ScanningProfileListRow } from "@/lib/scanning-profile";
import { ScanningCalibrationDialog } from "./scanning-calibration-dialog";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  FieldNote,
  Fields,
  INPUT_STYLE,
  InfoHint,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  RowTag,
  countLabel,
  useListSelection,
} from "./list-detail";

// Settings → Scanners (#1443) as a list beside the selected scanner's detail (#1476).
//
// **One is the default** — what a new scan is offered and what a picture with no scan behind it opens
// on — and **a profile in use cannot be deleted** (collector's call, 2026-09-28). The pane says what
// uses it and its Delete is disabled with that as the reason, so the refusal is visible before
// anything is clicked; the server refuses again whatever the screen says.
//
// **The calibration stays a window of its own.** The pane shows it and opens the existing
// window-sized calibration dialog, which is a tool — a ruler scan measured on screen — not an edit
// form, so it does not become fields in the pane.
//
// Editing the nominal resolution drops a calibration, which the pane says beside the field: a
// calibration is a scanner's distance from the resolution it was set to, and set to another it is
// another measurement.

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

/** The pane's form: the resolution is checked here, as the dialog did, before the action is asked. */
function readProfile(fd: FormData): { name: string; dpi: number } | { error: string } {
  const dpi = parseScanDpi(String(fd.get("nominalDpi") ?? ""));
  if (dpi === null) return { error: "The resolution must be a whole number of dpi." };
  return { name: String(fd.get("name") ?? ""), dpi };
}

export function ScanningProfilesPanel({
  collectionId,
  initialProfiles,
}: {
  collectionId: string;
  initialProfiles: ScanningProfileListRow[];
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const sel = useListSelection(initialProfiles);
  const current = sel.adding ? null : sel.current;
  const uses = current ? usesOf(current) : null;

  return (
    <>
      <AddRowAction label="Add scanner" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialProfiles.length, "scanner", "scanners")}
            hint="The scanners you measure scans with. A scanner rarely delivers exactly the resolution it is set to, so calibrate each from a scan of a ruler: the ruler, the size and the perforation gauge then use its real resolution, each axis on its own. Nothing is read from a scan's own file."
            empty={initialProfiles.length === 0 && "No scanners yet."}
          >
            <ListRows label="Scanners">
              {initialProfiles.map((profile) => (
                <ListRow
                  key={profile.id}
                  selected={current?.id === profile.id}
                  onSelect={() => sel.select(profile.id)}
                >
                  <RowName>
                    {profile.name}, {profile.nominalDpi} dpi
                  </RowName>
                  {!profile.calibration && <RowTag>Uncalibrated</RowTag>}
                  {profile.isDefault && <RowTag tone="accent">Default</RowTag>}
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? `${current.name}, ${current.nominalDpi} dpi` : "New scanner"}
              context={current ? (uses ? `Used by ${uses}` : "Not used yet") : undefined}
              isNew={!current}
              headerAction={current && !current.isDefault ? <MakeDefault profile={current} onDone={refresh} /> : undefined}
              onSave={async (fd) => {
                const input = readProfile(fd);
                if ("error" in input) return { status: "error", message: input.error };
                return current
                  ? updateScanningProfileAction(current.id, { name: input.name, nominalDpi: input.dpi })
                  : createScanningProfileAction(collectionId, input.name, input.dpi);
              }}
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete scanner",
                      message: (
                        <>
                          Delete <strong>{current.name}, {current.nominalDpi} dpi</strong>? Nothing
                          uses it — no scan was taken with it and no size measured with it.
                        </>
                      ),
                      // Refused while anything uses it (collector's call, 2026-09-28), and the
                      // button says what — the server refuses again whatever this says.
                      disabledHint: uses ? `In use: ${uses}` : undefined,
                      run: () => deleteScanningProfileAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <ProfileFields profile={current} />
              {current && <Calibration profile={current} onChanged={refresh} />}
            </DetailForm>
          ) : (
            <DetailPlaceholder>No scanners yet. Add one to calibrate it.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function ProfileFields({ profile }: { profile: ScanningProfileListRow | null }) {
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-scan-profile-name">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Scanner
            <InfoHint>
              What you call the scanner. The resolution is shown beside the name wherever the profile
              is named, so it need not be part of it.
            </InfoHint>
          </span>
        </LabelWithError>
        <TextInput
          id="f-scan-profile-name"
          name="name"
          defaultValue={profile?.name ?? ""}
          placeholder="e.g. Epson V600"
          autoFocus={!profile}
          style={INPUT_STYLE}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-scan-profile-dpi">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Resolution (dpi)
            <InfoHint>
              What the scanner is set to. A scanner you use at two resolutions is two profiles — each
              is calibrated on its own.
            </InfoHint>
          </span>
        </LabelWithError>
        <TextInput
          id="f-scan-profile-dpi"
          name="nominalDpi"
          inputMode="numeric"
          defaultValue={String(profile?.nominalDpi ?? DEFAULT_SCAN_DPI)}
          style={{ ...INPUT_STYLE, width: "8rem" }}
        />
        {profile?.calibration && (
          <FieldNote>Changing it removes the calibration, which was measured at this resolution.</FieldNote>
        )}
      </div>
    </Fields>
  );
}

/**
 * The scanner's calibration, shown in the pane and changed through its own actions — the existing
 * calibration window, and a confirmed removal — rather than through the pane's Save. Both dialogs
 * portal to `<body>`: the pane is sticky, and a dialog left inside it would rank only within it.
 */
function Calibration({
  profile,
  onChanged,
}: {
  profile: ScanningProfileListRow;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<"calibrate" | "uncalibrate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function uncalibrate() {
    setError(null);
    startTransition(async () => {
      const result = await calibrateScanningProfileAction(profile.id, null);
      if (result.status !== "success") {
        setError(result.message ?? "Could not remove the calibration.");
        return;
      }
      setOpen(null);
      onChanged();
    });
  }

  return (
    <div
      style={{
        marginTop: "1.25rem",
        paddingTop: "1.125rem",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <LabelWithError>Calibration</LabelWithError>
      <p
        style={{
          margin: "0 0 0.75rem",
          fontSize: "0.875rem",
          color: profile.calibration ? "var(--color-text-primary)" : "var(--color-text-muted)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {profile.calibration
          ? formatCalibration(profile.calibration)
          : "Uncalibrated — measures at its nominal resolution"}
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <DialogSecondaryButton onClick={() => setOpen("calibrate")}>
          <Icon name="measure" size="sm" />
          &nbsp;{profile.calibration ? "Calibrate again…" : "Calibrate…"}
        </DialogSecondaryButton>
        {profile.calibration && (
          <DialogSecondaryButton
            onClick={() => {
              setError(null);
              setOpen("uncalibrate");
            }}
          >
            <Icon name="revert" size="sm" />
            &nbsp;Remove calibration
          </DialogSecondaryButton>
        )}
      </div>

      {open === "calibrate" &&
        createPortal(
          <ScanningCalibrationDialog
            profile={profile}
            onClose={() => setOpen(null)}
            onSaved={() => {
              setOpen(null);
              onChanged();
            }}
          />,
          document.body
        )}

      {open === "uncalibrate" &&
        createPortal(
          <ConfirmDialog
            title="Remove calibration"
            message={
              <>
                Measure with <strong>{profile.name}</strong> at its nominal {profile.nominalDpi} dpi
                again? Sizes already saved keep their figures.
              </>
            }
            actionLabel="Remove"
            pendingLabel="Removing…"
            onClose={() => {
              if (!isPending) setOpen(null);
            }}
            onConfirm={uncalibrate}
            isPending={isPending}
            error={error}
          />,
          document.body
        )}
    </div>
  );
}

/** *Make default*, in the pane's header: a one-click change of which scanner a new scan is offered. */
function MakeDefault({
  profile,
  onDone,
}: {
  profile: ScanningProfileListRow;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.375rem" }}>
      <DialogSecondaryButton
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await setDefaultScanningProfileAction(profile.id);
            if (result.status === "success") onDone();
            else setError(result.message ?? "Could not make it the default.");
          });
        }}
      >
        <Icon name="primary" size="sm" />
        &nbsp;Make default
      </DialogSecondaryButton>
      {error && <DialogError>{error}</DialogError>}
    </div>
  );
}
