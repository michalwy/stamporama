"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createStampConditionAction,
  updateStampConditionAction,
  deleteStampConditionAction,
  reorderStampConditionsAction,
} from "@/app/actions/conditions";
import type { StampConditionData } from "@/lib/conditions";
import { languageLabel } from "@/lib/languages";
import { TagColorPicker } from "@/app/c/[collectionSlug]/shared/tag-color-picker";
import { nextTagColor, tagColorTokens, type TagColor } from "@/lib/tag-colors";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  Fields,
  INPUT_STYLE,
  InfoHint,
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

interface ConditionsPanelProps {
  collectionId: string;
  initialConditions: StampConditionData[];
  /** Languages needing a translation (#294): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name / Abbreviation fields are written in (#294). */
  defaultLanguage: string;
}

/**
 * The condition dictionary as a list beside the selected condition's detail (#1471). The rows keep
 * what they did — the dragged order, the abbreviation in the condition's own colour — and every edit
 * happens in the pane beside them.
 */
export function ConditionsPanel({
  collectionId,
  initialConditions,
  titleLanguages,
  defaultLanguage,
}: ConditionsPanelProps) {
  const router = useRouter();
  // The chips that read this dictionary (#728) live on other screens and cache it for a minute, so
  // a recolour has to drop that cache as well as refresh this page — otherwise the colour a
  // collector just chose is the one thing the app does not show them.
  const queryClient = useQueryClient();
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["conditions", collectionId] });
    router.refresh();
  }

  const list = useReorderable(
    initialConditions,
    (ids) => reorderStampConditionsAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.adding ? null : sel.current;

  return (
    <>
      <AddRowAction label="Add condition" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "condition", "conditions")}
            hint="Drag a row to change the order conditions are listed in across the app."
            error={list.error}
            empty={list.items.length === 0 && "No conditions yet."}
          >
            <ListRows label="Conditions">
              {list.items.map((condition) => (
                <ListRow
                  key={condition.id}
                  selected={current?.id === condition.id}
                  onSelect={() => sel.select(condition.id)}
                  drag={list.drag(condition.id)}
                >
                  <RowName>{condition.name}</RowName>
                  <span style={abbrBadgeStyle(condition.color)}>{condition.abbreviation}</span>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New condition"}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateStampConditionAction(current.id, fd)
                  : createStampConditionAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete condition",
                      message: (
                        <>
                          Delete condition <strong>{current.name}</strong>? This cannot be undone.
                        </>
                      ),
                      run: () => deleteStampConditionAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <ConditionFields
                condition={current}
                newColor={nextTagColor(list.items.map((c) => c.color))}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>No conditions yet. Add one to start the list.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

/** Abbreviation, Symbol, Name — shared by the default-language row and its translations (#1748). */
const FIELD_COLUMNS = "8rem 6rem minmax(0, 1fr)";

function ConditionFields({
  condition,
  newColor,
  titleLanguages,
  defaultLanguage,
}: {
  condition: StampConditionData | null;
  /** On an add, the first hue nobody is using (#728). */
  newColor: TagColor | null;
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations' placeholders show the *live* default-language text a blank
  // entry falls back to.
  const [name, setName] = useState(condition?.name ?? "");
  const [abbreviation, setAbbreviation] = useState(condition?.abbreviation ?? "");
  const [color, setColor] = useState<TagColor | null>(
    condition ? condition.color : newColor
  );
  const suffix = translatable ? ` — ${languageLabel(defaultLanguage)}` : "";

  return (
    <Fields>
      {/* Bottom-aligned (#1748): a label that wraps — a long language name — grows upwards, so the
          three fields keep their tops on one line. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: FIELD_COLUMNS,
          gap: "0.75rem",
          alignItems: "end",
        }}
      >
        <div>
          <LabelWithError htmlFor="f-cond-abbr">Abbreviation{suffix}</LabelWithError>
          <TextInput
            id="f-cond-abbr"
            name="abbreviation"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            placeholder="e.g. MNH"
            style={INPUT_STYLE}
          />
        </div>
        {/* The catalogue symbol (#1739): optional, the same in every language — so no language
            suffix and no translation row — and uncontrolled, since nothing else reads it live. */}
        <div>
          <LabelWithError htmlFor="f-cond-symbol">
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
              Symbol
              <InfoHint>
                The catalogue symbol, for the <code>{"{conditionSymbol}"}</code> token in templates.
                The same in every language; left blank, the token prints nothing.
              </InfoHint>
            </span>
          </LabelWithError>
          <TextInput
            id="f-cond-symbol"
            name="symbol"
            defaultValue={condition?.symbol ?? ""}
            placeholder="e.g. **"
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <LabelWithError htmlFor="f-cond-name">Name{suffix}</LabelWithError>
          <TextInput
            id="f-cond-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mint Never Hinged"
            autoFocus={!condition}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      <TranslationRows
        languages={titleLanguages}
        hint={
          <>
            What each language&rsquo;s platforms call this condition — the <code>{"{condition}"}</code>{" "}
            and <code>{"{conditionAbbr}"}</code> tokens in listing titles. Leave one blank to use the
            text above; abbreviations are often left as they are.
          </>
        }
        fields={[
          {
            key: "abbreviation",
            label: "Abbreviation",
            fallback: abbreviation,
            stored: condition?.abbreviationByLanguage,
            narrow: true,
          },
          { key: "name", label: "Name", fallback: name, stored: condition?.nameByLanguage },
        ]}
        // Each translation under its own field; a symbol is not translated, so its column stays empty.
        align={{ gridTemplateColumns: FIELD_COLUMNS, columns: ["abbreviation", null, "name"] }}
      />

      <div>
        <LabelWithError>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Colour
            <InfoHint>
              Tints this condition&rsquo;s chip wherever copies, lines and lots are listed.
            </InfoHint>
          </span>
        </LabelWithError>
        <TagColorPicker value={color} onChange={setColor} />
      </div>
    </Fields>
  );
}

/** The row's own abbreviation badge, in the colour the entry carries (#728) — the settings list is
 * where a colour is chosen, so it is the one list that must show the choice back. */
function abbrBadgeStyle(color: string | null): React.CSSProperties {
  const tokens = tagColorTokens(color);
  return {
    flexShrink: 0,
    fontSize: "0.8125rem",
    color: tokens.color,
    background: tokens.background,
    border: `1px solid ${tokens.border}`,
    borderRadius: "0.25rem",
    padding: "0.1rem 0.4rem",
    fontFamily: "monospace",
  };
}
