"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createFaultAction,
  updateFaultAction,
  deleteFaultAction,
  reorderFaultsAction,
} from "@/app/actions/faults";
import type { FaultData } from "@/lib/faults";
import { languageLabel } from "@/lib/languages";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { faultKeys } from "@/app/c/[collectionSlug]/shared/use-faults";
import { useInvalidateInventory } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  Fields,
  INPUT_STYLE,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  RowTag,
  TranslationRows,
  countLabel,
  useListSelection,
  useReorderable,
} from "./list-detail";

function copiesLabel(count: number): string {
  return `${count} ${count === 1 ? "copy" : "copies"}`;
}

/**
 * The fault dictionary (#1557) as a list beside the selected fault — the subtypes' page, less the
 * default: a name, its translations, a hand-set order, and a delete that **refuses while any copy
 * carries the fault**, saying how many. A fault's name rides on every Copies row that carries it, so
 * a rename or a delete stales that list as well as the pickers' dictionary.
 */
export function FaultsPanel({
  collectionId,
  initialFaults,
  titleLanguages,
  defaultLanguage,
}: {
  collectionId: string;
  initialFaults: FaultData[];
  /** Languages needing a translation: the platforms' listing languages minus the default one. */
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { invalidateList: invalidateInventory } = useInvalidateInventory();
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: faultKeys.all(collectionId) });
    void invalidateInventory(collectionId);
    router.refresh();
  }
  const list = useReorderable(
    initialFaults,
    (ids) => reorderFaultsAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.current;

  return (
    <>
      <AddRowAction label="Add fault" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "fault", "faults")}
            hint="What can be wrong with a copy, chosen on the copy beside its condition. Drag a row to change the order."
            error={list.error}
            empty={list.items.length === 0 && "No faults yet."}
          >
            <ListRows label="Faults">
              {list.items.map((fault) => (
                <ListRow
                  key={fault.id}
                  selected={current?.id === fault.id}
                  onSelect={() => sel.select(fault.id)}
                  drag={list.drag(fault.id)}
                >
                  <RowName>{fault.name}</RowName>
                  {fault.copyCount > 0 && <RowTag>{copiesLabel(fault.copyCount)}</RowTag>}
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New fault"}
              isNew={!current}
              onSave={(fd) =>
                current ? updateFaultAction(current.id, fd) : createFaultAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete fault",
                      message: (
                        <>
                          Delete fault <strong>{current.name}</strong>? No copy carries it. This
                          cannot be undone.
                        </>
                      ),
                      // A fault in use is never deleted: it is a statement about each of those
                      // pieces that a buyer is owed. Refused before the click, with the count.
                      disabledHint:
                        current.copyCount > 0
                          ? `On ${copiesLabel(current.copyCount)} — take it off them before deleting it.`
                          : undefined,
                      run: () => deleteFaultAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <FaultFields
                fault={current}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>No faults yet. Add one to start the list.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function FaultFields({
  fault,
  titleLanguages,
  defaultLanguage,
}: {
  fault: FaultData | null;
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations' placeholders show the live default-language text.
  const [name, setName] = useState(fault?.name ?? "");

  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-fault-name">
          {translatable ? `Name — ${languageLabel(defaultLanguage)}` : "Name"}
        </LabelWithError>
        <TextInput
          id="f-fault-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Thinned gum"
          autoFocus={!fault}
          style={INPUT_STYLE}
        />
      </div>

      <TranslationRows
        languages={titleLanguages}
        hint="What each language's listings call this fault. Leave one blank to use the name above."
        fields={[{ key: "name", label: "Name", fallback: name, stored: fault?.nameByLanguage }]}
      />
    </Fields>
  );
}
