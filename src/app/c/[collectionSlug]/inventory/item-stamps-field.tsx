"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { addStampsToRows, inAdditionOrder } from "@/lib/item-stamp-additions";
import type { StampFormatData } from "@/lib/stamp-formats";
import { STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  useReorderList,
  InsertionLine,
  DragGrip,
  showLineAt,
  dragStyle,
} from "@/app/c/[collectionSlug]/shared/reorder-list";
import { Icon } from "@/app/icons";
import { baseBtn } from "@/app/button-style";
import { StampPickerAutocomplete } from "./stamp-picker-autocomplete";
import { StampPickerBrowser } from "./stamp-picker-browser";
import { fromSearchItem, type PickedStamp } from "./stamp-picker-shared";

// **The stamps one copy carries** (#746, ADR-0044) — the editor for `ItemStamp`, inside the copy
// edit dialog, because a detail page reads and does not become a second editor (AGENTS.md).
//
// A copy is not *born* a carrier: this appears in **edit** mode only, and the add dialog keeps its
// single Stamp field. A cover is made by editing the copy that was recorded when the piece came in,
// which is also the order the ADR puts the two acts in.
//
// **Every entry is an entry, the leading one included.** There is no "and also" list beside the
// stamp field: a carrier bearing more than one stamp is a copy of *none* of them (#745), the first
// on exactly the same terms as the rest, and a control that filed one of them above the others would
// be drawing the asymmetry the rule removes. What the first position does still decide is the
// denormalised `Item.stampId` — which is why the list is ordered, and why the order is the
// collector's: it is a fact about the piece, and it is what `{catalog}` enumerates.
//
// Taking the list back down to one row makes the copy an ordinary copy of that stamp again, with no
// confirmation of its own. The counts follow the facts.
//
// **Adding is several stamps at a time** (#2352): Browse… stays open, each stamp pressed is ticked,
// and one button adds them all — a cover franked with eight stamps is one trip through the picker,
// not eight. Each lands as quantity 1, single, in catalogue order after the rows already listed; a
// stamp already on the piece raises its row's quantity instead (`item-stamp-additions.ts`). The
// autocomplete and a row's own Change stamp still pick one.

const INPUT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const ICON_BUTTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.25rem",
  border: "none",
  background: "none",
  borderRadius: "0.25rem",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  lineHeight: 1,
};

const BROWSE_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * One row of the editor: an `ItemStamp` as the form holds it.
 *
 * `key` is the row's own identity for React and for the reorder — never the entry's database id,
 * because a row added in this dialog has none yet and the save is a replace rather than a diff.
 * `formatId` is `""` for a single, matching the format select's blank option and the dialog's own
 * format field: null *is* the single (ADR-0020 §3).
 */
export interface ItemStampRow {
  key: string;
  stampId: string;
  quantity: number;
  formatId: string;
  /** The summary the picker produced, or the same shape rebuilt from a stored entry. */
  picked: PickedStamp;
}

/** Whether `rows` already holds this stamp in this format — the pair `item_stamp_unique` is over.
 *  Used to keep the collision unreachable rather than to re-state the validation: the domain checks
 *  it too, and the index behind it is the authority. */
function taken(
  rows: readonly ItemStampRow[],
  stampId: string,
  formatId: string,
  exceptKey?: string
): boolean {
  return rows.some(
    (row) => row.key !== exceptKey && row.stampId === stampId && row.formatId === formatId
  );
}

export function ItemStampsField({
  collectionId,
  areas,
  formats,
  rows,
  onRowsChange,
  disabled,
  onPickerOpenChange,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  formats: StampFormatData[];
  rows: ItemStampRow[];
  onRowsChange: (rows: ItemStampRow[]) => void;
  disabled?: boolean;
  /** Raised while the Browse popup is open, so the enclosing dialog stops dismissing itself on Esc —
   *  otherwise one Esc closes the picker *and* the copy form. The same contract `StampSelect` has. */
  onPickerOpenChange?: (open: boolean) => void;
}) {
  /** Which row the picker is choosing for — `"new"` adds the ticked stamps, a key replaces that row's
   *  stamp. */
  const [pickingFor, setPickingFor] = useState<string | "new" | null>(null);
  const [browsing, setBrowsing] = useState(false);
  /** Why the last pick did nothing. Cleared by the next one. */
  const [note, setNote] = useState<string | null>(null);

  function openBrowser(target: string | "new") {
    setPickingFor(target);
    setBrowsing(true);
    onPickerOpenChange?.(true);
  }

  function closeBrowser() {
    setBrowsing(false);
    onPickerOpenChange?.(false);
  }

  /** `target` is passed explicitly by the autocomplete, which picks in the same tick as it decides
   *  where the pick goes — reading it back out of state there would read the previous render's. */
  function pick(picked: PickedStamp, target: string | "new" | null = pickingFor) {
    closeBrowser();
    setPickingFor(null);
    setNote(null);
    if (target === null) return;

    if (target === "new") {
      add([picked]);
      return;
    }

    const current = rows.find((row) => row.key === target);
    if (!current) return;
    if (taken(rows, picked.stampId, current.formatId, current.key)) {
      setNote("That stamp is already on this copy in that format.");
      return;
    }
    onRowsChange(
      rows.map((row) =>
        row.key === target ? { ...row, stampId: picked.stampId, picked } : row
      )
    );
  }

  /** Puts `picked` on the piece — a stamp already listed as a single raises that row's quantity, the
   *  rest are appended in catalogue order. Two loose copies of one stamp on one cover are *one* entry
   *  of quantity 2 (ADR-0044 §4), never the pair the unique index refuses. */
  function add(picked: readonly PickedStamp[]) {
    closeBrowser();
    setPickingFor(null);
    setNote(null);
    if (picked.length === 0) return;
    const now = Date.now();
    onRowsChange(
      addStampsToRows(rows, picked, (p) => ({
        key: `new-${p.stampId}-${now}`,
        stampId: p.stampId,
        quantity: 1,
        formatId: "",
        picked: p,
      }))
    );
  }

  function update(key: string, patch: Partial<ItemStampRow>) {
    setNote(null);
    onRowsChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function remove(key: string) {
    setNote(null);
    onRowsChange(rows.filter((row) => row.key !== key));
  }

  function move(from: number, to: number) {
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setNote(null);
    onRowsChange(next);
  }

  // The shared drag kit, `handleOnly` because a row carries a number input, a select and three
  // buttons — a press on any of them must not start a drag. Off while there is nothing to reorder.
  const drag = useReorderList(rows.length > 1 && !disabled, move, { handleOnly: true });
  const single = rows.length === 1;
  // Whether what is described adds up to more than one stamp on the piece — a second row, or one row
  // twice over. It decides only what the note below *says*; the stored `Item.stampCount` is derived
  // server-side by `item-stamps.ts` and is never worked out here.
  const carriesSeveral = rows.reduce((sum, row) => sum + row.quantity, 0) > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div
        {...(drag?.containerProps ?? {})}
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.375rem",
          background: "var(--color-bg-page)",
          overflow: "hidden",
        }}
      >
        {rows.map((row, i) => (
          <div key={row.key}>
            {showLineAt(drag, i) && <InsertionLine />}
            <div
              {...(drag?.itemProps(i) ?? {})}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.625rem",
                borderBottom: i < rows.length - 1 ? "1px solid var(--color-border)" : "none",
                ...dragStyle(drag, i),
              }}
            >
              {drag && (
                <span {...drag.handleProps(i)}>
                  <DragGrip label="Reorder — the order the stamps sit on the piece" />
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "0.3rem",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "var(--color-text-primary)",
                  }}
                >
                  {row.picked.catalogLabels.map((label) => (
                    <CatalogNumberChip key={label} label={label} style={STAMP_SECONDARY_CHIP} />
                  ))}
                  {(row.picked.name || row.picked.catalogLabels.length === 0) && (
                    <span>{row.picked.name || "(unnamed stamp)"}</span>
                  )}
                  {row.picked.unknownVariant && (
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                      — unknown variant
                    </span>
                  )}
                </div>
                {row.picked.secondary && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                      marginTop: "0.125rem",
                    }}
                  >
                    {row.picked.secondary}
                  </div>
                )}
              </div>

              {/* How many of *this component* the piece bears — components, not sheets of paper
                  (ADR-0044 §4), which is why a block of four is 1 and its format says the rest. */}
              <Tooltip content="How many of this stamp the piece bears loose. A block or a pair is one component — say so in its format instead.">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={row.quantity}
                  disabled={disabled}
                  aria-label="Quantity"
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    update(row.key, { quantity: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 });
                  }}
                  style={{ ...INPUT_STYLE, width: "3.75rem" }}
                />
              </Tooltip>

              {/* The **component's** format, not the piece's: a block of four *on* this cover. The
                  piece's own format — Cover, FDC, Piece — is the dialog's Format field (ADR-0044 §5),
                  and an option that would duplicate another row is disabled rather than refused. */}
              <Tooltip content="This component's own format — a block of four on the piece. The piece itself is described by the copy's Format field.">
                <select
                  value={row.formatId}
                  disabled={disabled}
                  aria-label="Component format"
                  onChange={(e) => update(row.key, { formatId: e.target.value })}
                  style={{ ...INPUT_STYLE, maxWidth: "9rem" }}
                >
                  <option value="" disabled={taken(rows, row.stampId, "", row.key)}>
                    — Single —
                  </option>
                  {formats.map((f) => (
                    <option
                      key={f.id}
                      value={f.id}
                      disabled={taken(rows, row.stampId, f.id, row.key)}
                    >
                      {f.abbreviation || f.name}
                    </option>
                  ))}
                </select>
              </Tooltip>

              <Tooltip content="Pick a different stamp for this entry">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => openBrowser(row.key)}
                  style={ICON_BUTTON}
                  aria-label="Change stamp"
                >
                  <Icon name="edit" size="sm" />
                </button>
              </Tooltip>
              <Tooltip
                content={
                  single
                    ? "A copy is a copy of something — delete the copy instead of emptying it."
                    : "This stamp is not on the piece"
                }
              >
                <button
                  type="button"
                  disabled={disabled || single}
                  onClick={() => remove(row.key)}
                  style={{
                    ...ICON_BUTTON,
                    color: single ? "var(--color-text-muted)" : "var(--color-error)",
                    cursor: disabled || single ? "not-allowed" : "pointer",
                  }}
                  aria-label="Remove stamp"
                >
                  <Icon name="close" size="sm" />
                </button>
              </Tooltip>
            </div>
          </div>
        ))}
        {showLineAt(drag, rows.length) && <InsertionLine />}
      </div>

      {/* Adding one is the same two entry modes the Stamp field offers — the collection's one stamp
          picker, never a second way of naming a stamp. */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StampPickerAutocomplete
            collectionId={collectionId}
            onPick={(item) => pick(fromSearchItem(item), "new")}
            inputId="copy-stamp-add-search"
            disabled={disabled}
          />
        </div>
        <button
          type="button"
          onClick={() => openBrowser("new")}
          disabled={disabled}
          style={{ ...BROWSE_BUTTON_STYLE, cursor: disabled ? "not-allowed" : "pointer" }}
        >
          Browse…
        </button>
      </div>

      {note && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-warning)" }}>{note}</p>
      )}
      {carriesSeveral && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          A piece carrying more than one stamp is a copy of none of them: it stays on the Copies list
          and can be offered, sold and traded, but it no longer counts towards any of its stamps, and
          closes no want for them.
        </p>
      )}

      {browsing && pickingFor === "new" && (
        <PieceStampsPicker
          collectionId={collectionId}
          areas={areas}
          listedStampIds={new Set(rows.filter((row) => row.formatId === "").map((row) => row.stampId))}
          onAdd={add}
          onClose={() => {
            closeBrowser();
            setPickingFor(null);
          }}
        />
      )}
      {browsing && pickingFor !== "new" && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          onPick={pick}
          onClose={() => {
            closeBrowser();
            setPickingFor(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Browse… for the stamps on a piece (#2352): the collection's one stamp picker, kept open while the
 * collector ticks every stamp the piece carries — across issues, since searching for another one
 * keeps the ticks — and closed by the one button that adds them. Pressing a ticked stamp again takes
 * it off; the list beside the tree is the whole state, in the order the rows will be added. The same
 * shape as *Several possible variants…* (`candidate-stamps-picker.tsx`), which is where it comes from.
 */
function PieceStampsPicker({
  collectionId,
  areas,
  listedStampIds,
  onAdd,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  /** Stamps already on the piece as a single — ticking one raises its quantity, and the list says so. */
  listedStampIds: ReadonlySet<string>;
  onAdd: (picked: PickedStamp[]) => void;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState<PickedStamp[]>([]);

  function toggle(picked: PickedStamp) {
    setTicked((current) =>
      current.some((s) => s.stampId === picked.stampId)
        ? current.filter((s) => s.stampId !== picked.stampId)
        : [...current, picked]
    );
  }

  const ordered = inAdditionOrder(ticked);
  const none = ticked.length === 0;

  return (
    <StampPickerBrowser
      collectionId={collectionId}
      areas={areas}
      title="Stamps on this piece"
      marked={{
        stampIds: new Set(ticked.map((s) => s.stampId)),
        label: "ticked",
        hint: "Ticked to be added — pressing it again takes it off",
      }}
      onPick={toggle}
      asideWidth="22rem"
      aside={
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            gap: "0.625rem",
          }}
        >
          <div
            style={{
              flex: "0 1 auto",
              minHeight: 0,
              overflowY: "auto",
              padding: "0.5rem 0.625rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-page)",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            {none ? (
              "Tick every stamp the piece carries, from any issue."
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {ordered.map((s) => (
                  <li
                    key={s.stampId}
                    style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {[s.catalogLabels[0], s.name].filter(Boolean).join(" · ") ||
                        "(unnamed stamp)"}
                      {listedStampIds.has(s.stampId) && (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          {" "}
                          — already on the piece, its quantity goes up by 1
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label="Untick"
                      tabIndex={-1}
                      onClick={() => toggle(s)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      <Icon name="clear" size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              disabled={none}
              onClick={() => onAdd(ticked)}
              style={{
                ...baseBtn,
                background: "var(--color-action-primary)",
                color: "#fff",
                opacity: none ? 0.5 : 1,
                cursor: none ? "default" : "pointer",
              }}
            >
              {none
                ? "Tick the stamps to add"
                : `Add ${ticked.length} ${ticked.length === 1 ? "stamp" : "stamps"}`}
            </button>
          </div>
        </div>
      }
      onClose={onClose}
    />
  );
}
