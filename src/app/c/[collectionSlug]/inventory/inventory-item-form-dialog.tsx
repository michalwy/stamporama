"use client";

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { ItemListItem } from "@/lib/items";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { StampSelect } from "./stamp-select";
import { issueLabel, primaryLabel, type PickedStamp } from "./stamp-picker-shared";
import type { IssuePickerContext } from "./issue-stamp-picker-dialog";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { defaultTreeSelectButtonClassName } from "@/app/tree-select";
import { PhotoEditor, type PhotoEditorValue } from "./photo-editor";
import {
  readAddCopyDefaults,
  writeAddCopyDefaults,
  type AddCopyDefaults,
} from "@/app/c/[collectionSlug]/shared/add-copy-defaults";

// The tree-select trigger defaults to a compact toolbar height (min-h-8). Inside this
// dialog it sits beside INPUT_STYLE inputs (~2.25rem, 0.5rem vertical padding), so bump
// its min-height and vertical padding to line the Storage row up.
const LOCATION_SELECT_BUTTON_CLASS = defaultTreeSelectButtonClassName
  .replace("min-h-8", "min-h-9")
  .replace("py-1", "py-2");

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const SECTION_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.5rem",
};

// The dialog is laid out as a wide, few-row grid (wider than tall): each row packs related
// fields side by side rather than stacking one per line. `alignItems: start` lets cells of
// unequal height (a wrapping chip group next to a single select) top-align cleanly.
const ROW: React.CSSProperties = {
  display: "grid",
  gap: "0.875rem",
  alignItems: "start",
};

/** A uniform group heading for a field cell — a `<label>` when it targets a control, so all
 * rows share the same small-caps header regardless of field type. */
function GroupLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return htmlFor ? (
    <label htmlFor={htmlFor} style={SECTION_LABEL}>
      {children}
    </label>
  ) : (
    <div style={SECTION_LABEL}>{children}</div>
  );
}

const DISPOSITIONS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

type DispositionKey = (typeof DISPOSITIONS)[number]["key"];

/** Physical delivery axis (ADR-0009 §5, #121), orthogonal to disposition. */
const DELIVERY_STATES = [
  { value: "ordered", label: "Ordered" },
  { value: "to_sort", label: "To sort" },
  { value: "in_transit", label: "In transit" },
  { value: "delivered", label: "Delivered (sorted / in collection)" },
  { value: "not_delivered", label: "Not delivered" },
  { value: "damaged", label: "Damaged" },
];

export interface InventoryItemFormDialogProps {
  mode: "add" | "edit";
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  item?: ItemListItem;
  /** Add mode: pre-select this stamp (opened from a stamp list row, #111). */
  initialStamp?: PickedStamp;
  initialStampId?: string;
  /** Add mode: constrain the stamp picker to this issue's stamps (opened from an issue
   * list row, #111). */
  scopeIssue?: IssuePickerContext;
  /** Add mode: seed the disposition toggles, overriding the last-used defaults. Used by the
   * quick-offer flow to start the copy as *For sale* so it's immediately listable (#241). */
  initialDisposition?: Record<DispositionKey, boolean>;
  /** Add mode: override the submit button label (e.g. "Save & continue to offer" in the
   * quick-offer flow, #241). Defaults to "Add copy". */
  addActionLabel?: string;
  /** Add mode: whether to remember this copy's condition/location/disposition as the last-used
   * add-copy defaults (#234). Defaults to true; the quick-offer flow (#241) turns it off so its
   * seeded *For sale* disposition doesn't leak into the regular Add copy default. */
  persistDefaults?: boolean;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** Add/edit an inventory item (physical copy). One logical save (ADR-0007, AGENTS.md
 * dialog rules): the stamp/variant picker, condition, certificate, disposition,
 * storage, and notes all submit together. Acquisition/cost live on the purchase model
 * (ADR-0009) and are captured there, not here. */
export function InventoryItemFormDialog({
  mode,
  collectionId,
  areas,
  locations,
  conditions,
  certificateStatuses,
  item,
  initialStamp,
  initialStampId,
  scopeIssue,
  initialDisposition,
  addActionLabel,
  persistDefaults = true,
  isPending,
  error,
  onClose,
  onSubmit,
}: InventoryItemFormDialogProps) {
  // Last-used condition / location / disposition, remembered globally across every add-copy
  // entry point (#234). Add mode only; edit mode always reflects the item being edited. Computed
  // once at mount so the fields stay stable while the dialog is open.
  const [addDefaults] = useState<AddCopyDefaults | null>(() =>
    mode === "add" ? readAddCopyDefaults(collectionId, conditions, locations) : null
  );

  const [stampId, setStampId] = useState(item?.stampId ?? initialStampId ?? "");
  const [locationId, setLocationId] = useState(item?.locationId ?? addDefaults?.locationId ?? "");
  const [deliveryState, setDeliveryState] = useState(item?.deliveryState ?? "delivered");
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  const [disposition, setDisposition] = useState<Record<DispositionKey, boolean>>(
    item
      ? { inCollection: item.inCollection, forSale: item.forSale, forTrade: item.forTrade }
      : (initialDisposition ??
          addDefaults?.disposition ?? { inCollection: true, forSale: false, forTrade: false })
  );

  // Prefill the picker summary. In edit mode it is derived from the item; in add mode a
  // caller may pass one (adding a copy from a stamp list row, #111). Catalog numbers on the
  // item are raw (vendor id + number), so the summary shows the joined numbers; the popup and
  // autocomplete render prefix-formatted labels when a fresh pick is made.
  const pickerInitial: PickedStamp | undefined =
    mode === "edit" && item
      ? {
          stampId: item.stampId,
          primary: primaryLabel(
            item.catalogNumbers.map((c) => c.number),
            item.stampName
          ),
          secondary:
            item.issueName || item.issueYear
              ? issueLabel(item.issueName, item.issueYear)
              : null,
          unknownVariant: item.unknownVariant,
        }
      : initialStamp;

  // Pending photo change-set (#112): staged uploads to add + removals/reorders/retitles of
  // already-committed photos. Held in a ref so the derive-on-change loop in PhotoEditor never
  // re-renders this dialog, then serialized into the form on Save (one logical action).
  const photoValueRef = useRef<PhotoEditorValue>({
    changeSet: { add: [], update: [], remove: [] },
    uploading: false,
  });
  const [photosUploading, setPhotosUploading] = useState(false);
  const handlePhotoChange = useCallback((value: PhotoEditorValue) => {
    photoValueRef.current = value;
    setPhotosUploading(value.uploading);
  }, []);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("photoChangeSet", JSON.stringify(photoValueRef.current.changeSet));
    // Remember the choices for the next add-copy, shared across every entry point (#234).
    if (mode === "add" && persistDefaults) {
      writeAddCopyDefaults(collectionId, {
        conditionId: (formData.get("conditionId") as string) ?? "",
        locationId,
        disposition,
      });
    }
    onSubmit(formData);
  }

  const title = mode === "add" ? "Add copy" : "Edit copy";
  const actionLabel = isPending
    ? mode === "add" ? "Adding…" : "Saving…"
    : photosUploading
      ? "Uploading photos…"
      : mode === "add" ? (addActionLabel ?? "Add copy") : "Save changes";
  const actionDisabled = isPending || !stampId || photosUploading;

  return (
    <DialogShell title={title} onClose={onClose} maxWidth="52rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* Row 1: stamp — full width. Its picker is taller than a plain select, so it gets
                its own row instead of leaving a ragged gap beside short controls. */}
            <div>
              <GroupLabel>Stamp</GroupLabel>
              <StampSelect
                collectionId={collectionId}
                areas={areas}
                selectedStampId={stampId}
                onSelectedStampIdChange={setStampId}
                initial={pickerInitial}
                scopeIssue={scopeIssue}
                disabled={isPending}
              />
            </div>

            {/* Row 2: condition · certificate — two matched selects. */}
            <div style={{ ...ROW, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <GroupLabel htmlFor="copy-condition">Condition</GroupLabel>
                <select
                  id="copy-condition"
                  name="conditionId"
                  defaultValue={item?.conditionId ?? addDefaults?.conditionId ?? ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  <option value="">— Select —</option>
                  {conditions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.abbreviation})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <GroupLabel htmlFor="copy-cert">Certificate</GroupLabel>
                <select
                  id="copy-cert"
                  name="certificateStatusId"
                  defaultValue={item?.certificateStatusId ?? ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  <option value="">— None —</option>
                  {certificateStatuses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.abbreviation})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 3: delivery · disposition — a wide select (its labels are long) beside the
                joined disposition multi-toggle, both single-height controls. */}
            <div style={{ ...ROW, gridTemplateColumns: "1fr 1fr" }}>
              {/* Delivery status (ADR-0009 §5, #121): physical arrival/sort state of the copy. */}
              <div>
                <GroupLabel htmlFor="copy-delivery">Delivery</GroupLabel>
                <select
                  id="copy-delivery"
                  name="deliveryState"
                  value={deliveryState}
                  onChange={(e) => setDeliveryState(e.target.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  {DELIVERY_STATES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <DispositionField
                disposition={disposition}
                onToggle={(key) =>
                  setDisposition((d) => ({ ...d, [key]: !d[key] }))
                }
                disabled={isPending}
              />
            </div>

            {/* Row 4: storage (#56) — full width so the location tree-select breathes; the
                in-location ref sits beside it. */}
            <div>
              <GroupLabel>Storage</GroupLabel>
              {locations.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                  No locations defined yet. Add some on the Locations screen to file copies away.
                </p>
              ) : (
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <div style={{ flex: 3 }}>
                    <LabelWithError htmlFor="copy-location-button">Location</LabelWithError>
                    <LocationTreeSelect
                      locations={locations}
                      locationTree={locationTree}
                      name="locationId"
                      selectedId={locationId}
                      onSelectedIdChange={setLocationId}
                      onlyAssignableSelectable
                      disabled={isPending}
                      noneOptionLabel="— None"
                      // Taller trigger so it matches the sibling text/select inputs
                      // in this dialog (INPUT_STYLE), not the compact toolbar default.
                      buttonClassName={LOCATION_SELECT_BUTTON_CLASS}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <LabelWithError htmlFor="copy-location-ref">Ref</LabelWithError>
                    <input
                      id="copy-location-ref"
                      name="locationRef"
                      type="text"
                      placeholder="e.g. A234"
                      defaultValue={item?.locationRef ?? ""}
                      disabled={isPending || !locationId}
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Row 5: notes */}
            <div>
              <GroupLabel htmlFor="copy-notes">Notes</GroupLabel>
              <textarea
                id="copy-notes"
                name="notes"
                rows={2}
                placeholder="Per-copy detail (e.g. postmark type)"
                defaultValue={item?.notes ?? ""}
                disabled={isPending}
                style={{ ...INPUT_STYLE, resize: "vertical" }}
              />
            </div>

            {/* Row 6: photos (#112) — front/back slots + reorderable titled extras. Eager
                staged uploads; the pending change-set applies on Save with the copy fields.
                In edit mode each committed photo can be promoted to this copy's stamp (#137):
                an independent duplicated stamp photo; the copy's own photo is untouched. */}
            <PhotoEditor
              collectionId={collectionId}
              initialPhotos={item?.photos ?? []}
              disabled={isPending}
              onChange={handlePhotoChange}
              onPromotePhoto={
                mode === "edit"
                  ? async (photoId, target) => {
                      const { promoteCopyPhotoAction } = await import(
                        "@/app/actions/stamps"
                      );
                      const result = await promoteCopyPhotoAction(
                        photoId,
                        target.role,
                        target.title
                      );
                      return result.status === "success"
                        ? { ok: true }
                        : {
                            ok: false,
                            error:
                              result.status === "error"
                                ? result.message
                                : undefined,
                          };
                    }
                  : undefined
              }
            />
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={actionDisabled}
          cancelDisabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

/** Disposition as a joined segmented multi-toggle (a copy can hold any combination). Reads as
 * one control the same height as the sibling selects — cleaner than free-floating pills that
 * wrap. Hidden inputs carry each flag's "true"/"false" so the action reads booleans. */
function DispositionField({
  disposition,
  onToggle,
  disabled,
}: {
  disposition: Record<DispositionKey, boolean>;
  onToggle: (key: DispositionKey) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <GroupLabel>Disposition</GroupLabel>
      <div
        role="group"
        aria-label="Disposition"
        style={{
          display: "inline-flex",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          overflow: "hidden",
        }}
      >
        {DISPOSITIONS.map(({ key, label }, i) => {
          const active = disposition[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onToggle(key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.5rem 0.85rem",
                border: "none",
                borderLeft: i === 0 ? undefined : "1px solid var(--color-border-strong)",
                background: active ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                fontSize: "0.8125rem",
                fontWeight: active ? 600 : 500,
                cursor: disabled ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                transition: "background 0.1s ease, color 0.1s ease",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "0.7rem" }}>
                {active ? "✓" : "+"}
              </span>
              {label}
            </button>
          );
        })}
      </div>
      {DISPOSITIONS.map(({ key }) => (
        <input key={key} type="hidden" name={key} value={disposition[key] ? "true" : "false"} />
      ))}
    </div>
  );
}
