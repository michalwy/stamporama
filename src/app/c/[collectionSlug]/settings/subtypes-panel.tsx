"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createStampSubtypeAction,
  updateStampSubtypeAction,
  setSubtypeActsAsVariantAction,
  setDefaultSubtypeAction,
  deleteStampSubtypeAction,
  reorderStampSubtypesAction,
} from "@/app/actions/subtypes";
import type { StampSubtypeData } from "@/lib/subtypes";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { languageLabel } from "@/lib/languages";
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
  RowTag,
  TranslationRows,
  countLabel,
  useListSelection,
  useReorderable,
} from "./list-detail";

interface SubtypesPanelProps {
  collectionId: string;
  initialSubtypes: StampSubtypeData[];
  /** Languages needing a translation (#338): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name field is written in (#338). */
  defaultLanguage: string;
}

/**
 * The subtype dictionary as a list beside the selected subtype (#1471). The default stays a radio
 * on the rows, since it is a choice *between* them; *Acts as variant* is one subtype's own setting
 * and moved into its pane, saved with the rest, the rows showing it as a tag.
 */
export function SubtypesPanel({
  collectionId,
  initialSubtypes,
  titleLanguages,
  defaultLanguage,
}: SubtypesPanelProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const list = useReorderable(
    initialSubtypes,
    (ids) => reorderStampSubtypesAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.current;
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [isSettingDefault, startDefault] = useTransition();

  function makeDefault(id: string) {
    setDefaultError(null);
    startDefault(async () => {
      const result = await setDefaultSubtypeAction(id);
      if (result.status === "success") refresh();
      else if (result.status === "error") setDefaultError(result.message);
    });
  }

  return (
    <>
      <AddRowAction label="Add subtype" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "subtype", "subtypes")}
            hint="A subtype classifies a child stamp against its parent. The radio picks the default given to new child stamps; drag a row to change the order."
            error={list.error ?? defaultError}
            empty={list.items.length === 0 && "No subtypes yet."}
          >
            <ListRows label="Subtypes">
              {list.items.map((subtype) => (
                <ListRow
                  key={subtype.id}
                  selected={current?.id === subtype.id}
                  onSelect={() => sel.select(subtype.id)}
                  drag={list.drag(subtype.id)}
                  leading={
                    <Tooltip content={subtype.isDefault ? "Default subtype" : "Make default"}>
                      <input
                        type="radio"
                        name={`default-subtype-${collectionId}`}
                        aria-label={`Make ${subtype.name} the default subtype`}
                        checked={subtype.isDefault}
                        disabled={isSettingDefault || subtype.isDefault}
                        onChange={() => makeDefault(subtype.id)}
                        style={{ margin: 0 }}
                      />
                    </Tooltip>
                  }
                >
                  <RowName>{subtype.name}</RowName>
                  {subtype.isDefault && <RowTag tone="accent">Default</RowTag>}
                  {subtype.actsAsVariant && <RowTag>Variant</RowTag>}
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New subtype"}
              isNew={!current}
              onSave={async (fd) => {
                if (!current) return createStampSubtypeAction(collectionId, fd);
                const result = await updateStampSubtypeAction(current.id, fd);
                if (result.status !== "success") return result;
                // The switch has an action of its own (it was a toggle on the row); the pane saves
                // it with everything else, and only when it changed.
                const actsAsVariant = fd.get("actsAsVariant") === "on";
                return actsAsVariant === current.actsAsVariant
                  ? result
                  : setSubtypeActsAsVariantAction(current.id, actsAsVariant);
              }}
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete subtype",
                      message: (
                        <>
                          Delete subtype <strong>{current.name}</strong>? This cannot be undone.
                        </>
                      ),
                      run: () => deleteStampSubtypeAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <SubtypeFields
                subtype={current}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>No subtypes yet. Add one to start the list.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function SubtypeFields({
  subtype,
  titleLanguages,
  defaultLanguage,
}: {
  subtype: StampSubtypeData | null;
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations' placeholders show the live default-language text.
  const [name, setName] = useState(subtype?.name ?? "");

  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-subtype-name">
          {translatable ? `Name — ${languageLabel(defaultLanguage)}` : "Name"}
        </LabelWithError>
        <TextInput
          id="f-subtype-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Colour variety"
          autoFocus={!subtype}
          style={INPUT_STYLE}
        />
      </div>

      <TranslationRows
        languages={titleLanguages}
        hint={
          <>
            What each language&rsquo;s platforms call this subtype — the <code>{"{subtype}"}</code>{" "}
            token in listing texts. Leave one blank to use the name above.
          </>
        }
        fields={[{ key: "name", label: "Name", fallback: name, stored: subtype?.nameByLanguage }]}
      />

      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
        <input
          type="checkbox"
          name="actsAsVariant"
          defaultChecked={subtype?.actsAsVariant ?? true}
          style={{ marginTop: "0.15rem" }}
        />
        <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
          Acts as a variant
          <FieldNote>
            Its children make their parent an unknown-variant umbrella. Off for errors, plate flaws
            and overprints.
          </FieldNote>
        </span>
      </label>
    </Fields>
  );
}
