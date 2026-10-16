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
import type { ShippingOptionData } from "@/lib/shipping-options";
import type { CarrierData } from "@/lib/carriers";
import { getCarriersAction } from "@/app/actions/carriers";
import {
  getShippingOptionsAction,
  createShippingOptionAction,
  updateShippingOptionAction,
  deleteShippingOptionAction,
  type ShippingOptionActionState,
} from "@/app/actions/shipping-options";
import { Icon } from "@/app/icons";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

/** name · carrier service · buyer price · currency · actions — one grid so the rows, the editor and
 * the add form line up.
 * The last column is sized for the **widest** thing that lands in it, the editor's ✓ + ✕ pair, not
 * for the single `⋮` a resting row shows; a column cut to the narrower case clips the other. Its
 * contents are flush right, so a resting row's `⋮` still sits at the edge. */
const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 13rem 6rem 5rem 4.5rem",
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

export interface ShippingOptionsDialogProps {
  collectionId: string;
  /** The platform whose options these are. Only ever a *saved* platform — the dialog cannot be
   * opened while adding one, since an option has to hang off a platform that exists. */
  platformId: string;
  platformName: string;
  /** The platform's transaction currency (#196), used as the default for a new option — the buyer
   * pays in it — and every row can pick its own anyway. */
  defaultCurrency: string;
  onClose: () => void;
  /** Raised with the current count after every change, so the platform form's summary line stays
   * truthful without re-fetching. */
  onCountChange?: (count: number) => void;
}

type RowState = { kind: "none" } | { kind: "edit"; id: string } | { kind: "delete"; id: string };

/** This dialog stacks above the settings page at `zIndexBase` 200, so its panel sits at 201 — the
 * row menus portal to `<body>` and have to be raised past it, or they open behind the panel. */
const DIALOG_Z_INDEX_BASE = 200;
const ROW_MENU_Z_INDEX = DIALOG_Z_INDEX_BASE + 100;

/**
 * The platform's shipping options (#468, #1909) — what its buyers can choose from, at the price they
 * pay, each linked to the carrier service it is sent by. What sending costs the collector is not
 * here: it is the service's, in the global rate list under Settings → Carriers. Opened from the
 * platform's settings (#1955), beside the listing templates, because it is the same kind of fact:
 * something configured once per marketplace and then picked from on every sale.
 *
 * Unlike the templates dialog, this one **writes as you go**: its rows are their own records, not
 * fields of the platform, so there is nothing for the platform form's Save to carry. Deletion confirms
 * inline rather than in a nested `ConfirmDialog` — a third stacked dialog for one row is more
 * ceremony than the act deserves, and the rows are cheap to re-add.
 */
export function ShippingOptionsDialog({
  collectionId,
  platformId,
  platformName,
  defaultCurrency,
  onClose,
  onCountChange,
}: ShippingOptionsDialogProps) {
  const [options, setOptions] = useState<ShippingOptionData[]>([]);
  // The collection's carriers and their services (#1909) — what an option can be sent by. Loaded
  // once beside the options; the rate list is maintained in Settings → Carriers, not here.
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
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [serviceId, setServiceId] = useState("");

  async function reload() {
    const rows = await getShippingOptionsAction(platformId);
    setOptions(rows);
    onCountChange?.(rows.length);
    return rows;
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getShippingOptionsAction(platformId), getCarriersAction(collectionId)])
      .then(([rows, carrierRows]) => {
        if (cancelled) return;
        setOptions(rows);
        setCarriers(carrierRows);
        onCountChange?.(rows.length);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this platform's shipping options.");
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
    setPrice("");
    setCurrency(defaultCurrency);
    setServiceId("");
  }

  function startEdit(o: ShippingOptionData) {
    setError(undefined);
    setName(o.name);
    setPrice(o.price);
    setCurrency(o.currency);
    setServiceId(o.service?.id ?? "");
    setRow({ kind: "edit", id: o.id });
  }

  function submit(action: (fd: FormData) => Promise<ShippingOptionActionState>) {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("price", price);
    fd.set("currency", currency);
    fd.set("serviceId", serviceId);
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
      const result = await deleteShippingOptionAction(id);
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
    price,
    setPrice,
    currency,
    setCurrency,
    serviceId,
    setServiceId,
    carriers,
    disabled: isPending,
  };

  return (
    <DialogShell
      title={`Shipping options — ${platformName}`}
      onClose={onClose}
      maxWidth="48rem"
      minHeight="24rem"
      zIndexBase={DIALOG_Z_INDEX_BASE}
      dismissable={!menuOpen}
    >
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          What buyers on this platform can choose from, at the price <strong>they</strong> pay. Link
          each to the carrier service it goes by: picking it on a sale fills in the postage and the
          usual packing supplies from that service, still editable there.
        </p>

        {/* The header and the add form carry the list rows' own horizontal padding, or their
            columns would sit 0.625rem to the left of the rows they label. */}
        <div style={{ ...GRID, padding: ROW_INSET, marginBottom: "0.375rem" }}>
          <LabelWithError>Option</LabelWithError>
          <LabelWithError>Sent by</LabelWithError>
          <LabelWithError>Buyer pays</LabelWithError>
          <LabelWithError>Currency</LabelWithError>
          <span />
        </div>

        {loading ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading…</p>
        ) : options.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", margin: "0 0 0.75rem" }}>
            No options yet. Add the shipping you offer buyers here — a sale can still name a one-off
            without one being listed.
          </p>
        ) : (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.5rem", overflow: "hidden" }}>
            {options.map((o, i) => (
              <div
                key={o.id}
                style={{
                  ...GRID,
                  padding: "0.5rem 0.625rem",
                  borderBottom: i < options.length - 1 ? "1px solid var(--color-border)" : "none",
                  background: "var(--color-bg-elevated)",
                }}
              >
                {row.kind === "edit" && row.id === o.id ? (
                  <>
                    <DraftFields idPrefix={`ship-edit-${o.id}`} {...draft} />
                    <div style={ACTIONS_CELL}>
                      <IconButton
                        label="Save"
                        disabled={isPending}
                        onClick={() => submit((fd) => updateShippingOptionAction(o.id, fd))}
                      >
                        <Icon name="check" size="sm" />
                      </IconButton>
                      <IconButton label="Cancel" disabled={isPending} onClick={() => setRow({ kind: "none" })}>
                        <Icon name="close" size="sm" />
                      </IconButton>
                    </div>
                  </>
                ) : row.kind === "delete" && row.id === o.id ? (
                  <>
                    <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                      Delete <strong>{o.name}</strong>?
                    </span>
                    <span />
                    <span />
                    <span />
                    <div style={ACTIONS_CELL}>
                      <IconButton label="Delete" danger disabled={isPending} onClick={() => confirmDelete(o.id)}>
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
                      {o.name}
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
                      {o.service ? `${o.service.carrierName} › ${o.service.name}` : "—"}
                    </span>
                    <span
                      style={{
                        fontSize: "0.875rem",
                        color: "var(--color-text-secondary)",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {o.price}
                    </span>
                    <span style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>{o.currency}</span>
                    <div style={ACTIONS_CELL}>
                    <RowActionsMenu
                      ariaLabel={`Actions for ${o.name}`}
                      zIndex={ROW_MENU_Z_INDEX}
                      onOpenChange={setMenuOpen}
                      actions={[
                        { key: "edit", label: "Edit", icon: "edit", onSelect: () => startEdit(o) },
                        {
                          key: "delete",
                          label: "Delete",
                          icon: "delete",
                          danger: true,
                          separatorBefore: true,
                          onSelect: () => {
                            setError(undefined);
                            setRow({ kind: "delete", id: o.id });
                          },
                        },
                      ]}
                    />
                    </div>
                    {o.service && (
                      <span style={{ gridColumn: "1 / -1", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                        Costs you {o.service.cost} {o.service.currency}
                        {o.service.supplies.length > 0 &&
                          ` · packed with ${o.service.supplies.map((s) => `${s.name} × ${s.quantity}`).join(", ")}`}
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* The add form is always there rather than behind a button: a platform's options are
            entered in one sitting, and a row that is already open costs one click less per option. */}
        {row.kind === "none" && (
          <div style={{ ...GRID, padding: ROW_INSET, marginTop: "0.75rem" }}>
            <DraftFields idPrefix="ship-add" {...draft} />
            <div style={ACTIONS_CELL}>
              <IconButton
                label="Add option"
                disabled={isPending || !name.trim() || !price.trim()}
                onClick={() => submit((fd) => createShippingOptionAction(collectionId, platformId, fd))}
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
  price,
  setPrice,
  currency,
  setCurrency,
  serviceId,
  setServiceId,
  carriers,
  disabled,
}: {
  idPrefix: string;
  name: string;
  setName: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  serviceId: string;
  setServiceId: (v: string) => void;
  carriers: CarrierData[];
  disabled: boolean;
}) {
  return (
    <>
      <TextInput
        id={`${idPrefix}-name`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Registered letter"
        disabled={disabled}
        aria-label="Shipping option name"
        {...NO_AUTOFILL}
        style={INPUT_STYLE}
      />
      {/* Optional: linking the service is what fills a sale's postage and supplies in, and turns its
          tracking number into a link. The rate list is kept in Settings → Carriers, because the same
          service carries parcels for every platform at the same cost. */}
      <select
        id={`${idPrefix}-service`}
        value={serviceId}
        onChange={(e) => setServiceId(e.target.value)}
        disabled={disabled}
        aria-label="Carrier service"
        style={{ ...INPUT_STYLE, cursor: "pointer" }}
      >
        <option value="">— no service —</option>
        {carriers
          .filter((c) => c.services.length > 0)
          .map((c) => (
            <optgroup key={c.id} label={c.name}>
              {c.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.cost} {s.currency}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      <NumericInput
        kind="amount"
        id={`${idPrefix}-price`}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="0.00"
        disabled={disabled}
        aria-label="Buyer price"
        style={{ ...INPUT_STYLE, textAlign: "right" }}
      />
      <select
        id={`${idPrefix}-currency`}
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        disabled={disabled}
        aria-label="Buyer price currency"
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
