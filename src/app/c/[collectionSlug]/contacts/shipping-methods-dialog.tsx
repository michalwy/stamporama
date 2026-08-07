"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { NumericInput } from "../shared/numeric-input";
import { NO_AUTOFILL } from "../shared/no-autofill";
import { RowActionsMenu } from "../shared/row-actions-menu";
import type { ShippingMethodData } from "@/lib/shipping-methods";
import type { CarrierData } from "@/lib/carriers";
import { getCarriersAction } from "@/app/actions/carriers";
import {
  getShippingMethodsAction,
  createShippingMethodAction,
  updateShippingMethodAction,
  deleteShippingMethodAction,
  type ShippingMethodActionState,
} from "@/app/actions/shipping-methods";
import { Icon } from "@/app/icons";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

/** name · carrier · cost · currency · actions — one grid so the rows, the editor and the add form
 * line up.
 * The last column is sized for the **widest** thing that lands in it, the editor's ✓ + ✕ pair, not
 * for the single `⋮` a resting row shows; a column cut to the narrower case clips the other. Its
 * contents are flush right, so a resting row's `⋮` still sits at the edge. */
const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 9rem 6rem 5rem 4.5rem",
  alignItems: "center",
  gap: "0.5rem",
};

/** Horizontal inset of a list row, shared by the header and the add form so all three align. */
const ROW_INSET = "0 0.625rem";

/** The action cell: right-aligned, whether it holds one control or two. */
const ACTIONS_CELL: React.CSSProperties = {
  display: "flex",
  gap: "0.25rem",
  justifyContent: "flex-end",
};

export interface ShippingMethodsDialogProps {
  collectionId: string;
  /** The platform whose price list this is. Only ever a *saved* contact — the dialog cannot be
   * opened while adding one, since a method has to hang off a platform that exists. */
  platformId: string;
  platformName: string;
  /** The platform's transaction currency (#196), used as the default for a new method. Postage is
   * usually paid in the collector's own currency, but the platform's is the better first guess than
   * nothing, and every row picks its own anyway. */
  defaultCurrency: string;
  onClose: () => void;
  /** Raised with the current count after every change, so the contact form's summary line stays
   * truthful without re-fetching. */
  onCountChange?: (count: number) => void;
}

type RowState = { kind: "none" } | { kind: "edit"; id: string } | { kind: "delete"; id: string };

/** This dialog stacks above the contact form at `zIndexBase` 200, so its panel sits at 201 — the
 * row menus portal to `<body>` and have to be raised past it, or they open behind the panel. */
const DIALOG_Z_INDEX_BASE = 200;
const ROW_MENU_Z_INDEX = DIALOG_Z_INDEX_BASE + 100;

/**
 * The platform's shipping-method dictionary (#468) — what its buyers can choose from, and what
 * sending by each costs. Opened from the contact dialog's Platform tab, beside the listing
 * templates, because it is the same kind of fact: something configured once per marketplace and
 * then picked from on every sale.
 *
 * Unlike the templates dialog, this one **writes as you go**: its rows are their own records, not
 * fields of the contact, so there is nothing for the contact's Save to carry. Deletion confirms
 * inline rather than in a nested `ConfirmDialog` — a third stacked dialog for one row is more
 * ceremony than the act deserves, and the rows are cheap to re-add.
 */
export function ShippingMethodsDialog({
  collectionId,
  platformId,
  platformName,
  defaultCurrency,
  onClose,
  onCountChange,
}: ShippingMethodsDialogProps) {
  const [methods, setMethods] = useState<ShippingMethodData[]>([]);
  // The collection's carriers (#491) — what a method can name as the one that actually posts by it.
  // Loaded once beside the methods; the list is short and maintained in Settings, not here.
  const [carriers, setCarriers] = useState<CarrierData[]>([]);
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<RowState>({ kind: "none" });
  // A row menu owns Escape while it is open (it is not an escape layer of its own), so the dialog
  // stops dismissing itself — otherwise one Escape closes the menu and the dialog with it (#361).
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  // Draft fields, shared by the editor and the add form — only one of them is ever open.
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [carrierId, setCarrierId] = useState("");

  async function reload() {
    const rows = await getShippingMethodsAction(platformId);
    setMethods(rows);
    onCountChange?.(rows.length);
    return rows;
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getShippingMethodsAction(platformId), getCarriersAction(collectionId)])
      .then(([rows, carrierRows]) => {
        if (cancelled) return;
        setMethods(rows);
        setCarriers(carrierRows);
        onCountChange?.(rows.length);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this platform's shipping methods.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The platform is fixed for the life of the dialog; `onCountChange` is a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformId]);

  function startAdd() {
    setError(undefined);
    setRow({ kind: "none" });
    setName("");
    setCost("");
    setCurrency(defaultCurrency);
    setCarrierId("");
  }

  function startEdit(m: ShippingMethodData) {
    setError(undefined);
    setName(m.name);
    setCost(m.cost);
    setCurrency(m.currency);
    setCarrierId(m.carrierId ?? "");
    setRow({ kind: "edit", id: m.id });
  }

  function submit(action: (fd: FormData) => Promise<ShippingMethodActionState>) {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("cost", cost);
    fd.set("currency", currency);
    fd.set("carrierId", carrierId);
    startTransition(async () => {
      const result = await action(fd);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setError(undefined);
      setRow({ kind: "none" });
      startAdd();
      await reload();
    });
  }

  function confirmDelete(id: string) {
    startTransition(async () => {
      const result = await deleteShippingMethodAction(id);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setError(undefined);
      setRow({ kind: "none" });
      await reload();
    });
  }

  const draft = {
    name,
    setName,
    cost,
    setCost,
    currency,
    setCurrency,
    carrierId,
    setCarrierId,
    carriers,
    disabled: isPending,
  };
  const carrierNameById = new Map(carriers.map((c) => [c.id, c.name]));

  return (
    <DialogShell
      title={`Shipping methods — ${platformName}`}
      onClose={onClose}
      maxWidth="44rem"
      minHeight="24rem"
      zIndexBase={DIALOG_Z_INDEX_BASE}
      dismissable={!menuOpen}
    >
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          What buyers on this platform can choose from, and what sending by each costs you. Picking
          one on a sale fills in <strong>my shipping</strong> with the cost below — still editable
          there, since a method&apos;s price is what it usually costs, not what this parcel cost.
        </p>

        {/* The header and the add form carry the list rows' own horizontal padding, or their
            columns would sit 0.625rem to the left of the rows they label. */}
        <div style={{ ...GRID, padding: ROW_INSET, marginBottom: "0.375rem" }}>
          <LabelWithError>Method</LabelWithError>
          <LabelWithError>Carrier</LabelWithError>
          <LabelWithError>Cost</LabelWithError>
          <LabelWithError>Currency</LabelWithError>
          <span />
        </div>

        {loading ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading…</p>
        ) : methods.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", margin: "0 0 0.75rem" }}>
            No methods yet. Add the services you actually post with — a sale can still name a one-off
            method without one being listed here.
          </p>
        ) : (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.5rem", overflow: "hidden" }}>
            {methods.map((m, i) => (
              <div
                key={m.id}
                style={{
                  ...GRID,
                  padding: "0.5rem 0.625rem",
                  borderBottom: i < methods.length - 1 ? "1px solid var(--color-border)" : "none",
                  background: "var(--color-bg-elevated)",
                }}
              >
                {row.kind === "edit" && row.id === m.id ? (
                  <>
                    <DraftFields idPrefix={`ship-edit-${m.id}`} {...draft} />
                    <div style={ACTIONS_CELL}>
                      <IconButton
                        label="Save"
                        disabled={isPending}
                        onClick={() => submit((fd) => updateShippingMethodAction(m.id, fd))}
                      >
                        <Icon name="check" size="sm" />
                      </IconButton>
                      <IconButton label="Cancel" disabled={isPending} onClick={() => setRow({ kind: "none" })}>
                        <Icon name="close" size="sm" />
                      </IconButton>
                    </div>
                  </>
                ) : row.kind === "delete" && row.id === m.id ? (
                  <>
                    <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                      Delete <strong>{m.name}</strong>?
                    </span>
                    <span />
                    <span />
                    <span />
                    <div style={ACTIONS_CELL}>
                      <IconButton label="Delete" danger disabled={isPending} onClick={() => confirmDelete(m.id)}>
                        <Icon name="check" size="sm" />
                      </IconButton>
                      <IconButton label="Keep" disabled={isPending} onClick={() => setRow({ kind: "none" })}>
                        <Icon name="close" size="sm" />
                      </IconButton>
                    </div>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
                      {m.name}
                    </span>
                    <span
                      style={{
                        fontSize: "0.875rem",
                        color: "var(--color-text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.carrierId ? (carrierNameById.get(m.carrierId) ?? "—") : "—"}
                    </span>
                    <span
                      style={{
                        fontSize: "0.875rem",
                        color: "var(--color-text-secondary)",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {m.cost}
                    </span>
                    <span style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>{m.currency}</span>
                    <div style={ACTIONS_CELL}>
                    <RowActionsMenu
                      ariaLabel={`Actions for ${m.name}`}
                      zIndex={ROW_MENU_Z_INDEX}
                      onOpenChange={setMenuOpen}
                      actions={[
                        { key: "edit", label: "Edit", icon: "edit", onSelect: () => startEdit(m) },
                        {
                          key: "delete",
                          label: "Delete",
                          icon: "delete",
                          danger: true,
                          separatorBefore: true,
                          onSelect: () => {
                            setError(undefined);
                            setRow({ kind: "delete", id: m.id });
                          },
                        },
                      ]}
                    />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* The add form is always there rather than behind a button: a price list is entered in one
            sitting, and a row that is already open costs one click less per method. */}
        {row.kind === "none" && (
          <div style={{ ...GRID, padding: ROW_INSET, marginTop: "0.75rem" }}>
            <DraftFields idPrefix="ship-add" {...draft} />
            <div style={ACTIONS_CELL}>
              <IconButton
                label="Add method"
                disabled={isPending || !name.trim() || !cost.trim()}
                onClick={() => submit((fd) => createShippingMethodAction(collectionId, platformId, fd))}
              >
                +
              </IconButton>
            </div>
          </div>
        )}

        {error && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</p>
        )}
      </DialogBody>

      {/* One button: every change is already saved, so this dialog has nothing to commit. */}
      <DialogFooter>
        <DialogPrimaryButton type="button" onClick={onClose} disabled={isPending}>
          Done
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}

/** The four draft inputs, shared by the inline editor and the add form. Declared at module level
 * on purpose: a component defined inside the dialog would be a new type on every keystroke, and
 * React would remount the inputs and take the caret with them. */
function DraftFields({
  idPrefix,
  name,
  setName,
  cost,
  setCost,
  currency,
  setCurrency,
  carrierId,
  setCarrierId,
  carriers,
  disabled,
}: {
  idPrefix: string;
  name: string;
  setName: (v: string) => void;
  cost: string;
  setCost: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  carrierId: string;
  setCarrierId: (v: string) => void;
  carriers: CarrierData[];
  disabled: boolean;
}) {
  return (
    <>
      <input
        id={`${idPrefix}-name`}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Registered letter"
        disabled={disabled}
        aria-label="Shipping method name"
        {...NO_AUTOFILL}
        style={INPUT_STYLE}
      />
      {/* Optional (#491), and only ever about tracking: naming the carrier is what turns a sale's
          tracking number into a link to its own consignment. Carriers are kept in
          Settings → Shipping, because the same one carries parcels for every platform. */}
      <select
        id={`${idPrefix}-carrier`}
        value={carrierId}
        onChange={(e) => setCarrierId(e.target.value)}
        disabled={disabled}
        aria-label="Carrier"
        style={{ ...INPUT_STYLE, cursor: "pointer" }}
      >
        <option value="">— no carrier —</option>
        {carriers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <NumericInput
        id={`${idPrefix}-cost`}
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        placeholder="0.00"
        disabled={disabled}
        aria-label="Cost"
        style={{ ...INPUT_STYLE, textAlign: "right" }}
      />
      <select
        id={`${idPrefix}-currency`}
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        disabled={disabled}
        aria-label="Cost currency"
        style={{ ...INPUT_STYLE, cursor: "pointer" }}
      >
        {COMMON_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </>
  );
}

function IconButton({
  label,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "1px solid var(--color-border-strong)",
        borderRadius: "0.375rem",
        background: "var(--color-bg-elevated)",
        cursor: disabled ? "default" : "pointer",
        fontSize: "0.875rem",
        lineHeight: 1,
        padding: "0.375rem 0.5rem",
        color: danger ? "var(--color-error)" : "var(--color-text-secondary)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
