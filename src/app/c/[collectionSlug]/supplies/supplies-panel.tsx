"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  ConfirmDialog,
  LabelWithError,
} from "@/app/dialog-shell";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { ListSearchBox, useDebouncedSearch } from "@/app/c/[collectionSlug]/shared/list-search-box";
import { clickIsTheRows, ROW_OPEN_STYLE } from "@/app/c/[collectionSlug]/shared/row-open";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { INPUT_STYLE } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import type { SuppliesStock, SupplyStockData } from "@/lib/packing-supplies";
import { CARD, CELL, HEAD, NUM, TABLE, type OwnUse } from "./supplies-shared";
import { SupplyDetailDialog, SupplyUseButton } from "./supply-detail-dialog";
import { SupplyRegister } from "./supply-register";
import { filterSupplySummary, type SuppliesTab } from "./supplies-view-params";
import { useSuppliesView } from "./use-supplies-view";

// The Packing supplies screen (#1897, ADR-0068). It opens on a **summary** — one row per supply with
// what is on hand and its value at FIFO cost (#2195) — whose row opens that supply's batches and uses
// in a dialog, and its **register** tab lists every movement, in and out, for all supplies (#2196).
// Uses without a sale (#1900) are recorded here with *Use…*, and corrected from either tab's ⋮.

type Dialog =
  | { kind: "none" }
  | { kind: "use"; supplyId: string }
  | { kind: "edit"; use: OwnUse }
  | { kind: "delete"; use: OwnUse; supplyName: string };

const TABS: { key: SuppliesTab; label: string }[] = [
  { key: "summary", label: "Stock" },
  { key: "register", label: "Register" },
];

interface SuppliesPanelProps {
  collectionId: string;
  collectionSlug: string;
  stock: SuppliesStock;
  /** Today (yyyy-mm-dd), from the server: a use's default date. */
  today: string;
}

export function SuppliesPanel({ collectionId, collectionSlug, stock, today }: SuppliesPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  /** The supply whose detail is open — kept apart from {@link dialog}, which can stack on it. */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const base = `/c/${collectionSlug}`;
  const knownSupplies = useMemo(() => new Set(stock.supplies.map((s) => s.id)), [stock]);
  const { tab, setTab, view, setView, clearRegister } = useSuppliesView(collectionId, `${base}/supplies`, knownSupplies);
  const detail = detailId ? stock.supplies.find((s) => s.id === detailId) : undefined;
  // Over the detail dialog, a dialog it opened paints above it.
  const stackedZ = detail ? 110 : undefined;

  function run(fn: () => Promise<{ status: string; message?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        setDialog({ kind: "none" });
      } else {
        setError(result.message);
      }
    });
  }

  function open(next: Dialog) {
    setError(undefined);
    setDialog(next);
  }

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", margin: "0 0 0.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Packing supplies
        </h2>
        {stock.supplies.length > 0 && (
          <span style={{ fontSize: "0.9375rem", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {stock.totalValueBase != null
              ? `${stock.totalValueBase} ${stock.baseCurrency} on hand`
              : `Value on hand not known in ${stock.baseCurrency}`}
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
        Each supply line of a purchase order is a batch, costed at its price plus its share of the
        order&apos;s shipping. Supplies leave stock oldest batch first — on a sale, or with{" "}
        <em>Use…</em> when they go elsewhere.{" "}
        <Link href={`${base}/settings?tab=packing-supplies`}>Name your supplies in Settings</Link>.
      </p>

      {stock.supplies.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No packing supplies yet.</p>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Packing supplies"
            style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginBottom: "1rem" }}
          >
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  style={{
                    padding: "0.625rem 1rem",
                    fontSize: "0.875rem",
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                    background: "transparent",
                    border: "none",
                    borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                    cursor: "pointer",
                    marginBottom: "-1px",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {tab === "summary" ? (
            <SupplySummary
              stock={stock}
              name={view.name}
              onHandOnly={view.onHand}
              onName={(name) => setView({ name })}
              onOnHandOnly={(onHand) => setView({ onHand })}
              isPending={isPending}
              onOpen={(id) => setDetailId(id)}
              onUse={(id) => open({ kind: "use", supplyId: id })}
            />
          ) : (
            <SupplyRegister
              stock={stock}
              base={base}
              view={view}
              setView={setView}
              clearRegister={clearRegister}
              onEdit={(use) => open({ kind: "edit", use })}
              onDelete={(use, supplyName) => open({ kind: "delete", use, supplyName })}
            />
          )}
        </>
      )}

      {detail && (
        <SupplyDetailDialog
          supply={detail}
          baseCurrency={stock.baseCurrency}
          base={base}
          isPending={isPending}
          onUse={() => open({ kind: "use", supplyId: detail.id })}
          onEdit={(use) => open({ kind: "edit", use })}
          onDelete={(use) => open({ kind: "delete", use, supplyName: detail.name })}
          onClose={() => setDetailId(null)}
        />
      )}

      {dialog.kind === "use" && (
        <OwnUseDialog
          title="Use packing supplies"
          actionLabel="Use"
          supplies={stock.supplies}
          initialSupplyId={dialog.supplyId}
          today={today}
          isPending={isPending}
          error={error}
          zIndexBase={stackedZ}
          onClose={close}
          onSubmit={(fd) =>
            run(async () => {
              const { createSupplyOwnUseAction } = await import("@/app/actions/packing-supplies");
              return createSupplyOwnUseAction(collectionId, fd);
            })
          }
        />
      )}

      {dialog.kind === "edit" && (
        <OwnUseDialog
          title="Edit use"
          actionLabel="Save"
          supplies={stock.supplies}
          initialSupplyId={dialog.use.supplyId}
          initial={dialog.use}
          today={today}
          isPending={isPending}
          error={error}
          zIndexBase={stackedZ}
          onClose={close}
          onSubmit={(fd) =>
            run(async () => {
              const { updateSupplyOwnUseAction } = await import("@/app/actions/packing-supplies");
              return updateSupplyOwnUseAction(dialog.use.id, fd);
            })
          }
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete use"
          message={`This deletes the use of ${dialog.use.quantity} × “${dialog.supplyName}” on ${dialog.use.usedOn} and returns them to stock.`}
          actionLabel="Delete use"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={error}
          zIndexBase={stackedZ}
          onClose={close}
          onConfirm={() =>
            run(async () => {
              const { deleteSupplyOwnUseAction } = await import("@/app/actions/packing-supplies");
              return deleteSupplyOwnUseAction(dialog.use.id);
            })
          }
        />
      )}
    </>
  );
}

/** The stock summary (#2195): one row per supply, by name, with what is on hand, its value, what it
 *  owes and *Use…*; a row opens the supply's detail. */
function SupplySummary({
  stock,
  name,
  onHandOnly,
  onName,
  onOnHandOnly,
  isPending,
  onOpen,
  onUse,
}: {
  stock: SuppliesStock;
  name: string;
  onHandOnly: boolean;
  onName: (name: string) => void;
  onOnHandOnly: (onHand: boolean) => void;
  isPending: boolean;
  onOpen: (supplyId: string) => void;
  onUse: (supplyId: string) => void;
}) {
  const ccy = stock.baseCurrency;
  const [localName, setLocalName] = useDebouncedSearch(name, onName);
  const rows = filterSupplySummary(stock.supplies, { name, onHand: onHandOnly });
  const owes = stock.supplies.some((s) => s.shortUnits + s.ownShortUnits > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <ListSearchBox
          value={localName}
          onChange={setLocalName}
          placeholder="Filter by name…"
          label="Filter supplies by name"
          width="16rem"
        />
        <FilterChip label="On hand only" active={onHandOnly} toggle onClick={() => onOnHandOnly(!onHandOnly)} />
      </div>
      <section style={CARD}>
        {rows.length === 0 ? (
          <p style={{ margin: 0, padding: "0.75rem 1.25rem", color: "var(--color-text-muted)" }}>
            No supply matches these filters.
          </p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={HEAD}>Supply</th>
                <th style={{ ...HEAD, ...NUM }}>On hand</th>
                <th style={{ ...HEAD, ...NUM }}>Value</th>
                {owes && <th style={{ ...HEAD, ...NUM }}>Owed</th>}
                <th style={{ ...HEAD, width: "1%" }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((supply) => (
                <SummaryRow
                  key={supply.id}
                  supply={supply}
                  baseCurrency={ccy}
                  owes={owes}
                  isPending={isPending}
                  onOpen={() => onOpen(supply.id)}
                  onUse={() => onUse(supply.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function SummaryRow({
  supply,
  baseCurrency,
  owes,
  isPending,
  onOpen,
  onUse,
}: {
  supply: SupplyStockData;
  baseCurrency: string;
  owes: boolean;
  isPending: boolean;
  onOpen: () => void;
  onUse: () => void;
}) {
  const owed = supply.shortUnits + supply.ownShortUnits;
  return (
    <tr
      style={ROW_OPEN_STYLE}
      onClick={(event) => {
        if (clickIsTheRows(event)) onOpen();
      }}
    >
      <td style={CELL}>
        <button
          type="button"
          onClick={onOpen}
          style={{
            border: "none",
            background: "none",
            padding: 0,
            font: "inherit",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {supply.name}
        </button>
        {supply.batches.length === 0 && (
          <span style={{ marginLeft: "0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            never bought
          </span>
        )}
      </td>
      <td style={{ ...CELL, ...NUM }}>{supply.onHand}</td>
      <td style={{ ...CELL, ...NUM, fontWeight: 600 }}>
        {supply.valueBase != null ? (
          `${supply.valueBase} ${baseCurrency}`
        ) : (
          <Tooltip
            content={`${supply.unvaluedBatches} batch${supply.unvaluedBatches === 1 ? "" : "es"} bought in another currency without a rate into ${baseCurrency}`}
          >
            <span>—</span>
          </Tooltip>
        )}
      </td>
      {owes && (
        <td style={{ ...CELL, ...NUM }}>
          {owed > 0 && (
            <Tooltip content="Used more than there was — the next purchase of this supply covers them">
              <span style={{ color: "var(--color-warning)" }}>{owed}</span>
            </Tooltip>
          )}
        </td>
      )}
      <td style={{ ...CELL, padding: "0.25rem 0.75rem" }}>
        <SupplyUseButton supply={supply} isPending={isPending} onUse={onUse} />
      </td>
    </tr>
  );
}

function OwnUseDialog({
  title,
  actionLabel,
  supplies,
  initialSupplyId,
  initial,
  today,
  isPending,
  error,
  zIndexBase,
  onClose,
  onSubmit,
}: {
  title: string;
  actionLabel: string;
  supplies: readonly SupplyStockData[];
  initialSupplyId: string;
  initial?: OwnUse;
  today: string;
  isPending: boolean;
  error: string | undefined;
  zIndexBase?: number;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }
  return (
    <DialogShell title={title} onClose={onClose} maxWidth="28rem" zIndexBase={zIndexBase}>
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 2 }}>
                <LabelWithError htmlFor="own-use-supply">Supply</LabelWithError>
                <select
                  id="own-use-supply"
                  name="supplyId"
                  defaultValue={initialSupplyId}
                  required
                  disabled={isPending}
                  style={{ ...INPUT_STYLE, cursor: "pointer" }}
                >
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.onHand} on hand)
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="own-use-quantity">Quantity</LabelWithError>
                <TextInput
                  id="own-use-quantity"
                  name="quantity"
                  inputMode="numeric"
                  placeholder="e.g. 10"
                  defaultValue={initial ? String(initial.quantity) : ""}
                  required
                  autoFocus
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="own-use-date">Date</LabelWithError>
                <input
                  id="own-use-date"
                  name="usedOn"
                  type="date"
                  defaultValue={initial?.usedOn ?? today}
                  max={today}
                  required
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
              </div>
              <div style={{ flex: 2 }}>
                <LabelWithError htmlFor="own-use-note">Note</LabelWithError>
                <TextInput
                  id="own-use-note"
                  name="note"
                  placeholder="e.g. storage"
                  defaultValue={initial?.note ?? ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogActions actionLabel={isPending ? "Saving…" : actionLabel} onCancel={onClose} disabled={isPending} error={error} />
      </form>
    </DialogShell>
  );
}
