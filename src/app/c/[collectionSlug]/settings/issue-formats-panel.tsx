"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { issueFormatsQueryKey } from "@/app/c/[collectionSlug]/shared/use-issue-formats";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createStampIssueFormatAction,
  updateStampIssueFormatAction,
  deleteStampIssueFormatAction,
  reorderStampIssueFormatsAction,
} from "@/app/actions/stamp-issue-formats";
import type { StampIssueFormatData } from "@/lib/stamp-issue-formats";
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

// The issue-format dictionary (#2439) — the form a stamp was issued in: souvenir sheet, miniature
// sheet, tête-bêche, booklet pane — as a list beside the selected value (#1471). The conditions page
// without the symbol and the price-column switch: a name and an abbreviation, both translatable, and
// a chip colour (#728). Each row says how many stamps carry it, which is also why a delete can be
// refused. There is no "Stamp" row — no issue format is an ordinary stamp.

interface IssueFormatsPanelProps {
  collectionId: string;
  initialIssueFormats: StampIssueFormatData[];
  /** Languages needing a translation: the platforms' listing languages minus the collection's
   * default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name / Abbreviation fields are written in. */
  defaultLanguage: string;
}

export function IssueFormatsPanel({
  collectionId,
  initialIssueFormats,
  titleLanguages,
  defaultLanguage,
}: IssueFormatsPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // The filters read the dictionary through a client query (#2440), so a change here refreshes it too.
  const refresh = () => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: issueFormatsQueryKey(collectionId) });
  };
  const list = useReorderable(
    initialIssueFormats,
    (ids) => reorderStampIssueFormatsAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.adding ? null : sel.current;

  return (
    <>
      <AddRowAction label="Add issue format" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "issue format", "issue formats")}
            hint="Drag a row to change the order issue formats are offered in on the stamp form."
            error={list.error}
            empty={list.items.length === 0 && "No issue formats yet."}
          >
            <ListRows label="Issue formats">
              {list.items.map((row) => (
                <ListRow
                  key={row.id}
                  selected={current?.id === row.id}
                  onSelect={() => sel.select(row.id)}
                  drag={list.drag(row.id)}
                >
                  <RowName>{row.name}</RowName>
                  <span style={countStyle}>
                    {row.stampCount > 0 ? countLabel(row.stampCount, "stamp", "stamps") : "unused"}
                  </span>
                  <span style={abbrBadgeStyle(row.color)}>{row.abbreviation}</span>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New issue format"}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateStampIssueFormatAction(current.id, fd)
                  : createStampIssueFormatAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete issue format",
                      message: (
                        <>
                          Delete issue format <strong>{current.name}</strong>? This cannot be
                          undone.
                        </>
                      ),
                      run: () => deleteStampIssueFormatAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <IssueFormatFields
                row={current}
                newColor={nextTagColor(list.items.map((r) => r.color))}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              No issue formats yet. A stamp with none is an ordinary stamp.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function IssueFormatFields({
  row,
  newColor,
  titleLanguages,
  defaultLanguage,
}: {
  row: StampIssueFormatData | null;
  /** On an add, the first hue nobody is using. */
  newColor: TagColor | null;
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations' placeholders show the live default-language text.
  const [name, setName] = useState(row?.name ?? "");
  const [abbreviation, setAbbreviation] = useState(row?.abbreviation ?? "");
  const [color, setColor] = useState<TagColor | null>(row ? row.color : newColor);
  const suffix = translatable ? ` — ${languageLabel(defaultLanguage)}` : "";

  return (
    <Fields>
      <div style={{ display: "grid", gridTemplateColumns: "8rem minmax(0, 1fr)", gap: "0.75rem" }}>
        <div>
          <LabelWithError htmlFor="f-isf-abbr">Abbreviation{suffix}</LabelWithError>
          <TextInput
            id="f-isf-abbr"
            name="abbreviation"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            placeholder="e.g. Bl"
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <LabelWithError htmlFor="f-isf-name">Name{suffix}</LabelWithError>
          <TextInput
            id="f-isf-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Souvenir sheet"
            autoFocus={!row}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      <TranslationRows
        languages={titleLanguages}
        hint={
          <>
            What each language calls this issue format. Leave one blank to use the text above; the
            two fall back independently.
          </>
        }
        fields={[
          {
            key: "abbreviation",
            label: "Abbreviation",
            fallback: abbreviation,
            stored: row?.abbreviationByLanguage,
            narrow: true,
          },
          { key: "name", label: "Name", fallback: name, stored: row?.nameByLanguage },
        ]}
      />

      <div>
        <LabelWithError>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Colour
            <InfoHint>Tints this issue format&rsquo;s chip wherever a stamp shows it.</InfoHint>
          </span>
        </LabelWithError>
        <TagColorPicker value={color} onChange={setColor} />
      </div>
    </Fields>
  );
}

const countStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/** The row's abbreviation in the colour the value carries — the settings list is where a colour is
 * chosen, so it is the one list that must show the choice back. */
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
