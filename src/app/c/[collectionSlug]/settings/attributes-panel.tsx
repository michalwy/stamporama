"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createStampAttributeAction,
  updateStampAttributeAction,
  deleteStampAttributeAction,
  reorderStampAttributesAction,
} from "@/app/actions/stamp-attributes";
import type { StampAttributeData } from "@/lib/stamp-attributes";
import { STAMP_ATTRIBUTE_LABELS, type StampAttributeKind } from "@/lib/stamp-attribute-kinds";
import { languageLabel } from "@/lib/languages";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
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
  TranslationRows,
  countLabel,
  useListSelection,
  useReorderable,
} from "./list-detail";

// One of the four stamp-attribute dictionaries (#72) — colour, watermark, paper, printing method —
// as a list beside the selected entry (#1471). The subtypes page with the behaviour stripped: no
// default (there is no "usual colour" the way there is a usual subtype — a stamp that states none
// has none) and no per-row switch. The same component is each tab of the Attributes entry; only the
// words change, and they come from `STAMP_ATTRIBUTE_LABELS`.

interface AttributeDictionaryPanelProps {
  collectionId: string;
  kind: StampAttributeKind;
  initialRows: StampAttributeData[];
  /** Languages needing a translation: the platforms' listing languages minus the collection's
   * default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name field is written in. */
  defaultLanguage: string;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AttributeDictionaryPanel({
  collectionId,
  kind,
  initialRows,
  titleLanguages,
  defaultLanguage,
}: AttributeDictionaryPanelProps) {
  const labels = STAMP_ATTRIBUTE_LABELS[kind];
  const router = useRouter();
  const refresh = () => router.refresh();
  const list = useReorderable(
    initialRows,
    (ids) => reorderStampAttributesAction(collectionId, kind, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.current;

  return (
    <>
      <AddRowAction label={`Add ${labels.noun}`} onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, labels.noun, labels.plural)}
            hint={`Drag a row to change the order ${labels.plural} are offered in on the stamp form.`}
            error={list.error}
            empty={list.items.length === 0 && `No ${labels.plural} yet.`}
          >
            <ListRows label={capitalize(labels.plural)}>
              {list.items.map((row) => (
                <ListRow
                  key={row.id}
                  selected={current?.id === row.id}
                  onSelect={() => sel.select(row.id)}
                  drag={list.drag(row.id)}
                >
                  <RowName>{row.name}</RowName>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : `New ${labels.noun}`}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateStampAttributeAction(kind, current.id, fd)
                  : createStampAttributeAction(collectionId, kind, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: `Delete ${labels.noun}`,
                      message: (
                        <>
                          Delete {labels.noun} <strong>{current.name}</strong>? This cannot be
                          undone.
                        </>
                      ),
                      run: () => deleteStampAttributeAction(kind, current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <AttributeFields
                kind={kind}
                row={current}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              No {labels.plural} yet. Nothing here is required — add the ones your catalogues use.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function AttributeFields({
  kind,
  row,
  titleLanguages,
  defaultLanguage,
}: {
  kind: StampAttributeKind;
  row: StampAttributeData | null;
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const labels = STAMP_ATTRIBUTE_LABELS[kind];
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations' placeholders show the live default-language text.
  const [name, setName] = useState(row?.name ?? "");
  const inputId = `f-attr-${kind}-name`;

  return (
    <Fields>
      <div>
        <LabelWithError htmlFor={inputId}>
          {translatable ? `Name — ${languageLabel(defaultLanguage)}` : "Name"}
        </LabelWithError>
        <TextInput
          id={inputId}
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={labels.example}
          autoFocus={!row}
          style={INPUT_STYLE}
        />
      </div>
      <TranslationRows
        languages={titleLanguages}
        hint={`What each language's platforms call this ${labels.noun}. Leave one blank to use the name above.`}
        fields={[{ key: "name", label: "Name", fallback: name, stored: row?.nameByLanguage }]}
      />
    </Fields>
  );
}
