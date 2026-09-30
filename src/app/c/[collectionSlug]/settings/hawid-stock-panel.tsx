"use client";

import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createHawidStripAction,
  updateHawidStripAction,
  deleteHawidStripAction,
  reorderHawidStripsAction,
} from "@/app/actions/hawid-stock";
import type { HawidStripData } from "@/lib/hawid-stock";
import {
  DEFAULT_STOCK_LENGTH_MM,
  hawidStripBorderMm,
  HAWID_MM_STEP,
  hawidStripLabel,
  hawidStripTotalHeightMm,
  isHawidStripMeasured,
  MAX_STOCK_LENGTH_MM,
  MAX_STRIP_HEIGHT_MM,
  MIN_STOCK_LENGTH_MM,
  MIN_STRIP_HEIGHT_MM,
} from "@/lib/hawid";
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
  RowName,
  countLabel,
  useListSelection,
  useReorderable,
} from "./list-detail";

// The hawid stock (#765) as a list beside the selected strip's detail (#1476), keeping the drag
// order, because it applies here: it is a dictionary of millimetres, and its order is the
// collector's — where two strips are equally short, the one nearer the top is used.
//
// The empty state is doing real work. A collector who leaves this empty gets pages where every stamp
// is drawn as a pocket, and that has to read as *you have not described your drawer* rather than as
// a bug.
//
// So is the wording on the two height fields (#793). A bare "Strip height (mm)" is what let a packet
// number be typed where an outer height was meant and read back the other way round, which sent a
// 26 mm stamp to the 30 mm packet and then drew its box 4 mm shorter than the mount. Each field says
// which of the two figures it wants — the one line a field keeps beside it, because it prevents that
// mistake — and each row prints both back.

interface HawidStockPanelProps {
  collectionId: string;
  initialStrips: HawidStripData[];
}

function measuredText(strip: HawidStripData): string {
  return isHawidStripMeasured(strip)
    ? `${hawidStripTotalHeightMm(strip)} mm tall · ${hawidStripBorderMm(strip)} mm border`
    : "outer height not measured";
}

export function HawidStockPanel({ collectionId, initialStrips }: HawidStockPanelProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const list = useReorderable(
    initialStrips,
    (ids) => reorderHawidStripsAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.adding ? null : sel.current;

  return (
    <>
      <AddRowAction label="Add strip" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "strip", "strips")}
            hint="The hawid strips you own. An album page's box is a piece cut from one of these: the height is whichever strip the stamp fits into, and only the width is cut. A stamp taller than every strip is drawn as a pocket. Drag a row to change the order; where two strips are equally short, the one nearer the top is used."
            error={list.error}
            empty={list.items.length === 0 && "No strips yet."}
          >
            <ListRows label="Hawid strips">
              {list.items.map((strip) => (
                <ListRow
                  key={strip.id}
                  selected={current?.id === strip.id}
                  onSelect={() => sel.select(strip.id)}
                  drag={list.drag(strip.id)}
                >
                  <RowName>{hawidStripLabel(strip)}</RowName>
                  <span style={{ flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                    {measuredText(strip)}
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
              title={current ? hawidStripLabel(current) : "New hawid strip"}
              context={current ? `${measuredText(current)} · ${current.stockLengthMm} mm long` : undefined}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateHawidStripAction(current.id, fd)
                  : createHawidStripAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete hawid strip",
                      message: (
                        <>
                          Delete the <strong>{hawidStripLabel(current)}</strong> strip? Pages you
                          have already printed are unaffected; boxes planned from now on will use
                          whatever else is in the stock, or be drawn as pockets.
                        </>
                      ),
                      run: () => deleteHawidStripAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <StripFields strip={current} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              No strips yet. Until you add one, every box on an album page is planned as a pocket —
              which is what an undescribed drawer honestly comes to, rather than a size nobody chose.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function StripFields({ strip }: { strip: HawidStripData | null }) {
  return (
    <Fields>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <LabelWithError htmlFor="f-hawid-height">
            <HintedLabel hint="The number printed on the packet: the tallest stamp this strip takes.">
              Stamp height (mm)
            </HintedLabel>
          </LabelWithError>
          <input
            id="f-hawid-height"
            name="heightMm"
            type="number"
            step={HAWID_MM_STEP}
            min={MIN_STRIP_HEIGHT_MM}
            max={MAX_STRIP_HEIGHT_MM}
            defaultValue={strip?.heightMm}
            autoFocus={!strip}
            style={INPUT_STYLE}
          />
          <FieldNote>The packet&apos;s number — not the strip&apos;s own height.</FieldNote>
        </div>
        <div>
          <LabelWithError htmlFor="f-hawid-total">
            <HintedLabel hint="The strip itself, welded border included — lay a ruler against it. A 26 mm packet is usually about 30. This is what a box on the page is drawn at. Left blank, boxes are drawn at the packet figure, which is a border too short.">
              Outer height (mm)
            </HintedLabel>
          </LabelWithError>
          <input
            id="f-hawid-total"
            name="totalHeightMm"
            type="number"
            step={HAWID_MM_STEP}
            min={MIN_STRIP_HEIGHT_MM}
            max={MAX_STRIP_HEIGHT_MM}
            defaultValue={strip && strip.totalHeightMm > 0 ? strip.totalHeightMm : ""}
            style={INPUT_STYLE}
          />
          <FieldNote>The strip measured with a ruler, border included.</FieldNote>
        </div>
        <div>
          <LabelWithError htmlFor="f-hawid-length">Stock length (mm)</LabelWithError>
          <input
            id="f-hawid-length"
            name="stockLengthMm"
            type="number"
            step={HAWID_MM_STEP}
            min={MIN_STOCK_LENGTH_MM}
            max={MAX_STOCK_LENGTH_MM}
            defaultValue={strip?.stockLengthMm ?? DEFAULT_STOCK_LENGTH_MM}
            style={INPUT_STYLE}
          />
          <FieldNote>One strip as sold. Usually 210 mm.</FieldNote>
        </div>
      </div>

      <div>
        <LabelWithError htmlFor="f-hawid-label">
          <HintedLabel hint="What you call this one — the packet you reach for. Two strips with the same stamp height need different labels, because the label is how a cutting list tells them apart.">
            Label (optional)
          </HintedLabel>
        </LabelWithError>
        <TextInput
          id="f-hawid-label"
          name="label"
          defaultValue={strip?.label ?? ""}
          placeholder="e.g. Hawid 264"
          style={INPUT_STYLE}
        />
      </div>
    </Fields>
  );
}

function HintedLabel({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
      {children}
      <InfoHint>{hint}</InfoHint>
    </span>
  );
}
