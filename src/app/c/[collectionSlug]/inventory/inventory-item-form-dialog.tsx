"use client";

import { useMemo, useState, type FormEvent } from "react";
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
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.5rem",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

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
  isPending,
  error,
  onClose,
  onSubmit,
}: InventoryItemFormDialogProps) {
  const [stampId, setStampId] = useState(item?.stampId ?? initialStampId ?? "");
  const [locationId, setLocationId] = useState(item?.locationId ?? "");
  const [deliveryState, setDeliveryState] = useState(item?.deliveryState ?? "delivered");
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  const [disposition, setDisposition] = useState<Record<DispositionKey, boolean>>({
    inCollection: item ? item.inCollection : true,
    forSale: item?.forSale ?? false,
    forTrade: item?.forTrade ?? false,
  });

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

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = mode === "add" ? "Add copy" : "Edit copy";
  const actionLabel = isPending
    ? mode === "add" ? "Adding…" : "Saving…"
    : mode === "add" ? "Add copy" : "Save changes";
  const actionDisabled = isPending || !stampId;

  return (
    <DialogShell title={title} onClose={onClose} minHeight="30rem" maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {/* Stamp / variant */}
          <div style={FIELD_GAP}>
            <div style={SECTION_LABEL}>Stamp</div>
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

          {/* Condition + certificate */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="copy-condition">Condition</LabelWithError>
              <select
                id="copy-condition"
                name="conditionId"
                defaultValue={item?.conditionId ?? ""}
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
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="copy-cert">Certificate</LabelWithError>
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

          {/* Disposition — toggleable chips (a copy can hold any combination). */}
          <div style={FIELD_GAP}>
            <div style={SECTION_LABEL}>Disposition</div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {DISPOSITIONS.map(({ key, label }) => {
                const active = disposition[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    disabled={isPending}
                    onClick={() =>
                      setDisposition((d) => ({ ...d, [key]: !d[key] }))
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      padding: "0.3125rem 0.75rem",
                      borderRadius: "999px",
                      fontSize: "0.8125rem",
                      fontWeight: active ? 600 : 500,
                      cursor: isPending ? "not-allowed" : "pointer",
                      color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                      background: active ? "var(--color-accent-soft)" : "var(--color-bg-page)",
                      border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-strong)"}`,
                      transition: "background 0.1s ease, border-color 0.1s ease",
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: "0.75rem" }}>
                      {active ? "✓" : "+"}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
            {/* Hidden fields carry "true"/"false" so the action reads a boolean.
                Kept outside the buttons — an <input> can't be a button descendant. */}
            {DISPOSITIONS.map(({ key }) => (
              <input key={key} type="hidden" name={key} value={disposition[key] ? "true" : "false"} />
            ))}
          </div>

          {/* Delivery status (ADR-0009 §5, #121): physical arrival/sort state of the copy. */}
          <div style={FIELD_GAP}>
            <div style={SECTION_LABEL}>Delivery</div>
            <select
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

          {/* Storage location (#56) */}
          <div style={FIELD_GAP}>
            <div style={SECTION_LABEL}>Storage</div>
            {locations.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                No locations defined yet. Add some on the Locations screen to file copies away.
              </p>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <div style={{ flex: 2 }}>
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

          {/* Notes */}
          <div>
            <LabelWithError htmlFor="copy-notes">Notes</LabelWithError>
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
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={actionDisabled}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
