"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createPackingSupplyAction,
  renamePackingSupplyAction,
  deletePackingSupplyAction,
} from "@/app/actions/packing-supplies";
import type { PackingSupplyData } from "@/lib/packing-supplies";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  FieldNote,
  Fields,
  INPUT_STYLE,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  countLabel,
  useListSelection,
} from "./list-detail";

interface PackingSupplyPanelProps {
  collectionId: string;
  collectionSlug: string;
  initialSupplies: PackingSupplyData[];
}

/**
 * The collection's packing supplies (#1897, ADR-0068) — *C6 envelope*, *transport card A6* — as a
 * list beside the selected supply's detail.
 *
 * A name and nothing else: what a supply costs is never typed here. It follows from the purchase
 * orders it was bought on, each line a batch in its stock, costed FIFO — the Supplies screen shows
 * that stock.
 */
export function PackingSuppliesPanel({
  collectionId,
  collectionSlug,
  initialSupplies,
}: PackingSupplyPanelProps) {
  const router = useRouter();
  const sel = useListSelection(initialSupplies);
  const current = sel.adding ? null : sel.current;

  return (
    <>
      <AddRowAction label="Add packing supply" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialSupplies.length, "supply", "supplies")}
            hint="What goes into a parcel besides the stamps. Buy them as supply lines of a purchase order: each line is a batch in the supply's stock, at its own cost."
            empty={initialSupplies.length === 0 && "No packing supplies yet."}
          >
            <ListRows label="Packing supplies">
              {initialSupplies.map((supply) => (
                <ListRow
                  key={supply.id}
                  selected={current?.id === supply.id}
                  onSelect={() => sel.select(supply.id)}
                >
                  <RowName>{supply.name}</RowName>
                  {supply.lineCount === 0 && (
                    <span style={{ flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                      never bought
                    </span>
                  )}
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New packing supply"}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? renamePackingSupplyAction(current.id, fd)
                  : createPackingSupplyAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                router.refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete packing supply",
                      message: (
                        <>
                          Delete packing supply <strong>{current.name}</strong>?
                        </>
                      ),
                      run: () => deletePackingSupplyAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        router.refresh();
                      },
                      disabledHint:
                        current.lineCount > 0
                          ? `Bought on ${countLabel(current.lineCount, "order line", "order lines")} — those lines are its stock, so it stays.`
                          : current.saleLineCount > 0
                            ? `Used on ${countLabel(current.saleLineCount, "sale line", "sale lines")} — part of those sales' shipping, so it stays.`
                            : current.ownUseCount > 0
                              ? `Used outside sales ${countLabel(current.ownUseCount, "time", "times")} — delete those uses on the Supplies screen first.`
                              : undefined,
                    }
                  : undefined
              }
            >
              <Fields>
                <div>
                  <LabelWithError htmlFor="f-supply-name">Name</LabelWithError>
                  <TextInput
                    id="f-supply-name"
                    name="name"
                    defaultValue={current?.name ?? ""}
                    placeholder="e.g. C6 envelope"
                    required
                    autoFocus={!current}
                    {...NO_AUTOFILL}
                    style={INPUT_STYLE}
                  />
                  <FieldNote>
                    Its cost comes from the purchases it is bought on —{" "}
                    <Link href={`/c/${collectionSlug}/supplies`}>see the stock</Link>.
                  </FieldNote>
                </div>
              </Fields>
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              No packing supplies yet. Add the envelopes and cards you pack parcels with.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}
