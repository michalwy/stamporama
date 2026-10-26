"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
import { FILTER_CONTROL_STYLE, FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { LIST_BANNER_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { ListSearchBox, useDebouncedSearch } from "@/app/c/[collectionSlug]/shared/list-search-box";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import type { SuppliesStock } from "@/lib/packing-supplies";
import {
  SUPPLY_MOVEMENT_KINDS,
  SUPPLY_MOVEMENT_LABEL,
  filterSupplyMovements,
  runningSupplyStock,
  supplyMovementTotals,
  supplyMovements,
  supplyMovementsByMonth,
  type SupplyMovement,
  type SupplyMovementTotals,
} from "@/lib/supply-register-rules";
import { CARD, CELL, CostFigure, HEAD, NUM, OwnUseDocument, PurchaseDocument, SaleDocument, TABLE, type OwnUse } from "./supplies-shared";
import { OwnUseActions } from "./supply-detail-dialog";
import { registerNarrowings, type RegisterNarrowing, type SuppliesView } from "./supplies-view-params";

// The register (#2196): every packing-supply movement — bought on a purchase order, used on a sale,
// used outside sales — for every supply, newest first, filtered by supply, dates, type and text. One
// supply alone shows the stock after each row; the totals are of what is shown, and *By month* groups
// the rows with each month's own — narrowed to *Used outside sales*, the figures the screen's old
// monthly table gave (#1900).

const LINE: CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-secondary)" };

interface SupplyRegisterProps {
  stock: SuppliesStock;
  base: string;
  view: SuppliesView;
  setView: (patch: Partial<SuppliesView>) => void;
  clearRegister: () => void;
  onEdit: (use: OwnUse) => void;
  onDelete: (use: OwnUse, supplyName: string) => void;
}

export function SupplyRegister({ stock, base, view, setView, clearRegister, onEdit, onDelete }: SupplyRegisterProps) {
  const ccy = stock.baseCurrency;
  const all = useMemo(() => supplyMovements(stock.supplies), [stock]);
  const ownUses = useMemo(
    () =>
      new Map(
        stock.supplies.flatMap((s) =>
          s.history.filter((h): h is OwnUse => h.kind === "own").map((h) => [h.id, h] as const)
        )
      ),
    [stock]
  );
  const rows = useMemo(
    () =>
      filterSupplyMovements(all, {
        supplyIds: view.supplies,
        kinds: view.kinds,
        from: view.from,
        to: view.to,
        text: view.q,
      }),
    [all, view.supplies, view.kinds, view.from, view.to, view.q]
  );
  // The stock after each row only means something for one supply at a time.
  const running = useMemo(
    () => (view.supplies.length === 1 ? runningSupplyStock(all, view.supplies[0]) : null),
    [all, view.supplies]
  );
  const totals = supplyMovementTotals(rows);
  const months = view.byMonth ? supplyMovementsByMonth(rows) : null;

  const [localSearch, setLocalSearch] = useDebouncedSearch(view.q, (value) => setView({ q: value }));
  const narrowings = registerNarrowings(view);

  function narrowingLabel(n: RegisterNarrowing): string {
    switch (n.key) {
      case "supplies":
        return `Supply: ${n.value.map((id) => stock.supplies.find((s) => s.id === id)?.name ?? "Unknown supply").join(" or ")}`;
      case "kinds":
        return n.value.map((k) => SUPPLY_MOVEMENT_LABEL[k]).join(" or ");
      case "dates":
        return n.from && n.to ? `${n.from} to ${n.to}` : n.from ? `From ${n.from}` : `Until ${n.to}`;
      case "q":
        return `“${n.value}”`;
    }
  }

  function toggleKind(kind: SupplyMovement["kind"]) {
    setView({ kinds: view.kinds.includes(kind) ? view.kinds.filter((k) => k !== kind) : [...view.kinds, kind] });
  }

  const columns = running ? 9 : 8;

  function row(m: SupplyMovement) {
    const d = m.document;
    const ownUse = m.kind === "own" ? ownUses.get(m.id) : undefined;
    return (
      <tr key={m.key}>
        <td style={{ ...CELL, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>{m.date}</td>
        <td style={{ ...CELL, whiteSpace: "nowrap" }}>{SUPPLY_MOVEMENT_LABEL[m.kind]}</td>
        <td style={CELL}>{m.supplyName}</td>
        <td
          style={{
            ...CELL,
            ...NUM,
            color: m.units >= 0 ? "var(--color-success)" : "var(--color-text-primary)",
          }}
        >
          {m.units >= 0 ? `+${m.units}` : `−${-m.units}`}
        </td>
        {running && <td style={{ ...CELL, ...NUM, fontWeight: 600 }}>{running.get(m.key)}</td>}
        <td style={{ ...CELL, ...NUM, color: "var(--color-text-secondary)" }}>
          {m.unitCostBase != null ? `${m.unitCostBase} ${ccy}` : "—"}
        </td>
        <td style={{ ...CELL, ...NUM }}>
          <CostFigure cost={m} baseCurrency={ccy} />
        </td>
        <td style={CELL}>
          {d.kind === "purchase" ? (
            <PurchaseDocument
              base={base}
              purchase={{ id: d.id, purchaseNo: d.purchaseNo, kind: d.purchaseKind, name: d.name }}
            />
          ) : d.kind === "sale" ? (
            <SaleDocument base={base} sale={d} />
          ) : (
            <OwnUseDocument note={d.note} />
          )}
        </td>
        <td style={{ ...CELL, padding: "0.25rem 0.75rem" }}>
          {ownUse && (
            <OwnUseActions
              label={`Use of ${m.supplyName} on ${m.date} actions`}
              onEdit={() => onEdit(ownUse)}
              onDelete={() => onDelete(ownUse, m.supplyName)}
            />
          )}
        </td>
      </tr>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <MultiSelectFilter
          options={stock.supplies.map((s) => ({ id: s.id, label: s.name }))}
          selected={view.supplies}
          onChange={(ids) => setView({ supplies: ids })}
          allLabel="All supplies"
          itemNoun="supplies"
          ariaLabel="Filter by supply"
        />
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {SUPPLY_MOVEMENT_KINDS.map((kind) => (
            <FilterChip
              key={kind}
              label={SUPPLY_MOVEMENT_LABEL[kind]}
              active={view.kinds.includes(kind)}
              toggle
              onClick={() => toggleKind(kind)}
            />
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", ...LINE }}>
          From
          <input
            type="date"
            aria-label="From date"
            value={view.from}
            max={view.to || undefined}
            onChange={(e) => setView({ from: e.target.value })}
            style={FILTER_CONTROL_STYLE}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", ...LINE }}>
          To
          <input
            type="date"
            aria-label="To date"
            value={view.to}
            min={view.from || undefined}
            onChange={(e) => setView({ to: e.target.value })}
            style={FILTER_CONTROL_STYLE}
          />
        </label>
        <ListSearchBox
          value={localSearch}
          onChange={setLocalSearch}
          placeholder="Search document, supplier, buyer, note…"
          label="Search movements"
          width="20rem"
        />
        <FilterChip label="By month" active={view.byMonth} toggle onClick={() => setView({ byMonth: !view.byMonth })} />
      </div>
      {narrowings.length > 0 && (
        <div style={LIST_BANNER_STYLE}>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)" }}>
            This register is narrowed — {narrowings.map(narrowingLabel).join(" · ")}
          </span>
          <button
            type="button"
            onClick={clearRegister}
            style={{
              ...FILTER_CONTROL_STYLE,
              marginLeft: "auto",
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "var(--color-accent)",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      <section style={CARD}>
        <div style={{ padding: "0.75rem 1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          <TotalsLine totals={totals} baseCurrency={ccy} />
        </div>
        {rows.length === 0 ? (
          <p style={{ margin: 0, padding: "0 1.25rem 0.75rem", color: "var(--color-text-muted)" }}>
            {all.length === 0 ? "Nothing bought or used yet." : "No movement matches these filters."}
          </p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={HEAD}>Date</th>
                <th style={HEAD}>Type</th>
                <th style={HEAD}>Supply</th>
                <th style={{ ...HEAD, ...NUM }}>Units</th>
                {running && <th style={{ ...HEAD, ...NUM }}>Stock after</th>}
                <th style={{ ...HEAD, ...NUM }}>Unit cost</th>
                <th style={{ ...HEAD, ...NUM }}>Cost</th>
                <th style={HEAD}>Document</th>
                <th style={{ ...HEAD, width: "2.5rem" }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {months
                ? months.map((month) => (
                    <Fragment key={month.key}>
                      <tr>
                        <td
                          colSpan={columns}
                          style={{ ...CELL, background: "var(--color-bg-page)", fontWeight: 600, color: "var(--color-text-primary)" }}
                        >
                          {month.label}
                          <span style={{ marginLeft: "1rem", fontWeight: 400 }}>
                            <TotalsLine totals={month.totals} baseCurrency={ccy} />
                          </span>
                        </td>
                      </tr>
                      {month.movements.map(row)}
                    </Fragment>
                  ))
                : rows.map(row)}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** What a set of movements adds up to, in one line: how many, units and cost in, units and cost out. */
function TotalsLine({ totals, baseCurrency }: { totals: SupplyMovementTotals; baseCurrency: string }) {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {totals.movements} movement{totals.movements === 1 ? "" : "s"} · in {totals.unitsIn}, cost{" "}
      <CostFigure cost={totals.costIn} baseCurrency={baseCurrency} /> · out {totals.unitsOut}, cost{" "}
      <CostFigure cost={totals.costOut} baseCurrency={baseCurrency} />
    </span>
  );
}
