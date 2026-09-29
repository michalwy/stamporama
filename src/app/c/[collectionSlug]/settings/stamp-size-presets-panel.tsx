"use client";

import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createStampSizePresetAction,
  updateStampSizePresetAction,
  deleteStampSizePresetAction,
  reorderStampSizePresetsAction,
} from "@/app/actions/stamp-size-presets";
import type { StampSizePresetData } from "@/lib/stamp-size-presets";
import { formatSizeMm } from "@/lib/stamp-size";
import { STAMP_SIZE_LABELS } from "@/lib/stamp-attribute-kinds";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
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
  countLabel,
  useListSelection,
  useReorderable,
} from "./list-detail";

// The collection's stamp size presets (#804; ADR-0048), as a list beside the selected preset
// (#1471): a dictionary of millimetres in the collector's own dragged order, with a label that is
// not its identity — the same kind of thing as the hawid stock.
//
// It sits in the **Catalog** group beside Attributes (an entry of its own since #1469) rather than
// beside the hawid drawer, which was weighed and refused: a size is the seventh and eighth stamp
// attribute (#763), catalogue identity, and it is a fact for a collection that never prints a page.
//
// ## Two things the wording here is doing on purpose
//
// **The delete confirmation says that deleting is safe**, because nothing on screen can show that it
// is. A preset is copied onto a stamp and never referenced (ADR-0048 §1), so no stamp can be
// orphaned by removing one — but a collector who has just applied a preset to forty stamps has every
// reason to assume the opposite, and every other dictionary in this app *does* refuse a delete that
// is in use. Silence would read as the dangerous case.
//
// **The figures are `type="text"` with `inputMode="decimal"`, not `type="number"`**, matching the
// stamp form's own size fields rather than the hawid panel's. `parseSizeMm` (#763) reads a comma as
// a decimal point deliberately — the collector's locale writes `21,5` — and a number input strips or
// rejects the comma before the action ever sees it, which would make that rule unreachable from this
// screen while leaving it true everywhere else.

interface StampSizePresetsPanelProps {
  collectionId: string;
  initialPresets: StampSizePresetData[];
}

/** `25 × 30 mm` — the pair, which is what the preset *is*. The name rides beside it rather than in
 *  it, so a row without one reads as complete instead of as a missing label. */
function presetPair(preset: StampSizePresetData): string {
  return `${formatSizeMm(preset.widthMm)} × ${formatSizeMm(preset.heightMm)} mm`;
}

export function StampSizePresetsPanel({
  collectionId,
  initialPresets,
}: StampSizePresetsPanelProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const list = useReorderable(
    initialPresets,
    (ids) => reorderStampSizePresetsAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.current;

  return (
    <>
      <AddRowAction label="Add preset" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "preset", "presets")}
            hint="Sizes you already know, saved so they are typed once. Nothing is set up here to begin with. Drag a row to change the order they are offered in."
            error={list.error}
            empty={list.items.length === 0 && "No presets yet."}
          >
            <ListRows label="Size presets">
              {list.items.map((preset) => (
                <ListRow
                  key={preset.id}
                  selected={current?.id === preset.id}
                  onSelect={() => sel.select(preset.id)}
                  drag={list.drag(preset.id)}
                >
                  <span style={{ flexShrink: 0, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                    {presetPair(preset)}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "0.8125rem",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {preset.name ?? ""}
                  </span>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? presetPair(current) : "New size preset"}
              context={current?.name ?? undefined}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateStampSizePresetAction(current.id, fd)
                  : createStampSizePresetAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete size preset",
                      message: (
                        <>
                          Delete the <strong>{presetPair(current)}</strong> preset
                          {current.name ? ` (${current.name})` : ""}? Every stamp you have sized from
                          it keeps its size: a preset is copied onto a stamp rather than referenced by
                          it, so nothing here is pointed at and nothing can be left dangling. You are
                          removing it from this list, and nothing else.
                        </>
                      ),
                      run: () => deleteStampSizePresetAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <PresetFields preset={current} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              No presets yet. Add one for a size you keep typing — an empty list is a collection that
              has not needed one.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function PresetFields({ preset }: { preset: StampSizePresetData | null }) {
  return (
    <Fields>
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          {(["widthMm", "heightMm"] as const).map((field, i) => (
            <div key={field}>
              <LabelWithError htmlFor={`f-preset-${field}`}>
                {STAMP_SIZE_LABELS[field].field}
              </LabelWithError>
              <TextInput
                id={`f-preset-${field}`}
                name={field}
                inputMode="decimal"
                defaultValue={preset ? formatSizeMm(preset[field]) : ""}
                placeholder={STAMP_SIZE_LABELS[field].example}
                autoFocus={!preset && i === 0}
                style={INPUT_STYLE}
              />
            </div>
          ))}
        </div>
        {/* The one line kept on the page: correcting a preset reads as correcting every stamp sized
            from it, and a hawid cut to the old figure is material that does not come back. */}
        {preset ? (
          <FieldNote>
            Stamps already sized from this preset keep their figures — correct those on the stamps,
            or apply the preset to them again.
          </FieldNote>
        ) : (
          <FieldNote>Millimetres, to a tenth. Both are required: a preset is a complete size.</FieldNote>
        )}
      </div>

      <div>
        <LabelWithError htmlFor="f-preset-name">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Name (optional)
            <InfoHint>
              What you call this size. The pair of numbers is already the identity — the name is
              there so you can recognise it in a list, and two presets can never share a pair.
            </InfoHint>
          </span>
        </LabelWithError>
        <TextInput
          id="f-preset-name"
          name="name"
          defaultValue={preset?.name ?? ""}
          placeholder="e.g. Germania"
          style={INPUT_STYLE}
        />
      </div>
    </Fields>
  );
}
