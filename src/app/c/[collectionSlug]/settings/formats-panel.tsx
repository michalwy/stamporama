"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createStampFormatAction,
  updateStampFormatAction,
  deleteStampFormatAction,
  reorderStampFormatsAction,
} from "@/app/actions/stamp-formats";
import type { StampFormatData } from "@/lib/stamp-formats";
import { PIECE_KINDS, PIECE_KIND_LABELS } from "@/lib/piece-valuation";
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

// The physical-format dictionary, as a list beside the selected format (#1471) — the conditions
// page's shape, because a format is the same kind of per-collection taxonomy, set up once and then
// left alone.
//
// Formats are translatable exactly as conditions are (#344), now that `{format}` / `{formatAbbr}`
// render one into a listing (#345): a German listing should read "Viererblock", not "Block of 4".

interface FormatsPanelProps {
  collectionId: string;
  initialFormats: StampFormatData[];
  /** Languages needing a translation (#344): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name / Abbreviation fields are written in (#344). */
  defaultLanguage: string;
}

export function FormatsPanel({
  collectionId,
  initialFormats,
  titleLanguages,
  defaultLanguage,
}: FormatsPanelProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const list = useReorderable(
    initialFormats,
    (ids) => reorderStampFormatsAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.current;

  return (
    <>
      <AddRowAction label="Add format" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "format", "formats")}
            hint="How a copy is physically attached — a pair, a block, a strip. A single stamp needs no entry: it is what a copy with no format already is. Drag a row to change the order formats are listed in."
            error={list.error}
            empty={list.items.length === 0 && "No formats yet."}
          >
            <ListRows label="Formats">
              {list.items.map((format) => (
                <ListRow
                  key={format.id}
                  selected={current?.id === format.id}
                  onSelect={() => sel.select(format.id)}
                  drag={list.drag(format.id)}
                >
                  <RowName>{format.name}</RowName>
                  {format.pieceKind && (
                    <span style={kindHintStyle}>{PIECE_KIND_LABELS[format.pieceKind]}</span>
                  )}
                  <span style={abbrBadgeStyle}>{format.abbreviation}</span>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New format"}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateStampFormatAction(current.id, fd)
                  : createStampFormatAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete format",
                      message: (
                        <>
                          Delete format <strong>{current.name}</strong>? Any multiplier rules for it
                          are deleted with it. This cannot be undone.
                        </>
                      ),
                      run: () => deleteStampFormatAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <FormatFields
                format={current}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>No formats yet. Add one to record pairs, blocks or strips.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function FormatFields({
  format,
  titleLanguages,
  defaultLanguage,
}: {
  format: StampFormatData | null;
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations' placeholders show the live default-language text.
  const [name, setName] = useState(format?.name ?? "");
  const [abbreviation, setAbbreviation] = useState(format?.abbreviation ?? "");
  const suffix = translatable ? ` — ${languageLabel(defaultLanguage)}` : "";

  return (
    <Fields>
      <div style={{ display: "grid", gridTemplateColumns: "8rem minmax(0, 1fr)", gap: "0.75rem" }}>
        <div>
          <LabelWithError htmlFor="f-fmt-abbr">Abbreviation{suffix}</LabelWithError>
          <TextInput
            id="f-fmt-abbr"
            name="abbreviation"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            placeholder="e.g. Blk4"
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <LabelWithError htmlFor="f-fmt-name">Name{suffix}</LabelWithError>
          <TextInput
            id="f-fmt-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Block of 4"
            autoFocus={!format}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      {/* What a copy in this format is (#2359): a cover or a fragment is valued by the piece's
          valuation method, and its prices are the stamp's Cover EF and On piece. */}
      <div style={{ maxWidth: "16rem" }}>
        <LabelWithError htmlFor="f-fmt-kind">Kind</LabelWithError>
        <select
          id="f-fmt-kind"
          name="pieceKind"
          defaultValue={format?.pieceKind ?? ""}
          style={{ ...INPUT_STYLE, cursor: "pointer" }}
        >
          <option value="">Neither</option>
          {PIECE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {PIECE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <div style={kindHintStyle}>
          {format && !format.pieceKind
            ? "Choosing a kind moves this format's prices to the stamps' Cover EF or On piece."
            : "A copy in it is valued by its valuation method."}
        </div>
      </div>

      <TranslationRows
        languages={titleLanguages}
        hint={
          <>
            What each language&rsquo;s platforms call this format — the <code>{"{format}"}</code> and{" "}
            <code>{"{formatAbbr}"}</code> tokens in listing titles. Leave one blank to use the text
            above; the two fall back independently.
          </>
        }
        fields={[
          {
            key: "abbreviation",
            label: "Abbreviation",
            fallback: abbreviation,
            stored: format?.abbreviationByLanguage,
            narrow: true,
          },
          { key: "name", label: "Name", fallback: name, stored: format?.nameByLanguage },
        ]}
      />
    </Fields>
  );
}

const kindHintStyle: React.CSSProperties = {
  marginTop: "0.25rem",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

const abbrBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
