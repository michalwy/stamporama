"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createCertificateStatusAction,
  updateCertificateStatusAction,
  deleteCertificateStatusAction,
  reorderCertificateStatusesAction,
} from "@/app/actions/certificate-statuses";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import { languageLabel } from "@/lib/languages";
import { TagColorPicker } from "@/app/c/[collectionSlug]/shared/tag-color-picker";
import { nextTagColor, tagColorTokens, type TagColor } from "@/lib/tag-colors";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { formatPricePercent } from "@/lib/certificate-price-fill";
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

interface CertificateStatusesPanelProps {
  collectionId: string;
  initialStatuses: CertificateStatusData[];
  /** Languages needing a translation (#294): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain Name / Abbreviation fields are written in (#294). */
  defaultLanguage: string;
}

/** The certificate-status dictionary as a list beside the selected status (#1471) — the conditions
 *  page's shape, with the price against no certificate (#1242) beside the colour. */
export function CertificateStatusesPanel({
  collectionId,
  initialStatuses,
  titleLanguages,
  defaultLanguage,
}: CertificateStatusesPanelProps) {
  const router = useRouter();
  // The chips that read this dictionary (#728) cache it on other screens — see the conditions page.
  const queryClient = useQueryClient();
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["certificate-statuses", collectionId] });
    router.refresh();
  }

  const list = useReorderable(
    initialStatuses,
    (ids) => reorderCertificateStatusesAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.adding ? null : sel.current;

  return (
    <>
      <AddRowAction label="Add certificate status" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "status", "statuses")}
            hint="Drag a row to change the order certificate statuses are listed in across the app. A copy with no certificate needs no entry here."
            error={list.error}
            empty={list.items.length === 0 && "No certificate statuses yet."}
          >
            <ListRows label="Certificate statuses">
              {list.items.map((status) => (
                <ListRow
                  key={status.id}
                  selected={current?.id === status.id}
                  onSelect={() => sel.select(status.id)}
                  drag={list.drag(status.id)}
                >
                  <RowName>{status.name}</RowName>
                  {status.pricePercent != null && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: "0.8125rem",
                        color: "var(--color-text-muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatPricePercent(status.pricePercent)}
                    </span>
                  )}
                  <span style={abbrBadgeStyle(status.color)}>{status.abbreviation}</span>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New certificate status"}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateCertificateStatusAction(current.id, fd)
                  : createCertificateStatusAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete certificate status",
                      message: (
                        <>
                          Delete certificate status <strong>{current.name}</strong>? This cannot be
                          undone.
                        </>
                      ),
                      run: () => deleteCertificateStatusAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <CertificateStatusFields
                status={current}
                newColor={nextTagColor(list.items.map((s) => s.color))}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              No certificate statuses yet. Add the ones you use — a copy with none needs no entry.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function CertificateStatusFields({
  status,
  newColor,
  titleLanguages,
  defaultLanguage,
}: {
  status: CertificateStatusData | null;
  /** On an add, the first hue nobody is using — as on conditions (#728). */
  newColor: TagColor | null;
  titleLanguages: string[];
  defaultLanguage: string;
}) {
  const translatable = titleLanguages.length > 0;
  // Controlled so the translations' placeholders show the live default-language text.
  const [name, setName] = useState(status?.name ?? "");
  const [abbreviation, setAbbreviation] = useState(status?.abbreviation ?? "");
  const [color, setColor] = useState<TagColor | null>(status ? status.color : newColor);
  const suffix = translatable ? ` — ${languageLabel(defaultLanguage)}` : "";

  return (
    <Fields>
      <div style={{ display: "grid", gridTemplateColumns: "8rem minmax(0, 1fr)", gap: "0.75rem" }}>
        <div>
          <LabelWithError htmlFor="f-cert-abbr">Abbreviation{suffix}</LabelWithError>
          <TextInput
            id="f-cert-abbr"
            name="abbreviation"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            placeholder="e.g. Cert"
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <LabelWithError htmlFor="f-cert-name">Name{suffix}</LabelWithError>
          <TextInput
            id="f-cert-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Certificate"
            autoFocus={!status}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      <TranslationRows
        languages={titleLanguages}
        hint={
          <>
            What each language&rsquo;s platforms call this status — the{" "}
            <code>{"{certificate}"}</code> and <code>{"{certificateAbbr}"}</code> tokens in listing
            titles. Leave one blank to use the text above.
          </>
        }
        fields={[
          {
            key: "abbreviation",
            label: "Abbreviation",
            fallback: abbreviation,
            stored: status?.abbreviationByLanguage,
            narrow: true,
          },
          { key: "name", label: "Name", fallback: name, stored: status?.nameByLanguage },
        ]}
      />

      <div>
        <LabelWithError>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Colour
            <InfoHint>Tints this status&rsquo;s chip wherever copies, lines and lots are listed.</InfoHint>
          </span>
        </LabelWithError>
        <TagColorPicker value={color} onChange={setColor} />
      </div>

      <div>
        <LabelWithError htmlFor="f-cert-percent">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Price against no certificate
            <InfoHint>
              What a copy with this certificate is worth against the plain catalogue price, as a
              whole percentage. The catalogue value grids use it to fill this status&rsquo;s empty
              prices from the None price in one press. Leave it empty and the fill leaves this status
              alone.
            </InfoHint>
          </span>
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          {/* Uncontrolled and read back from FormData: nothing else on the form reads it while typed. */}
          <NumericInput
            kind="number"
            id="f-cert-percent"
            name="pricePercent"
            inputMode="numeric"
            defaultValue={status?.pricePercent == null ? "" : String(status.pricePercent)}
            placeholder="e.g. 120"
            style={{ ...INPUT_STYLE, maxWidth: "6rem", textAlign: "right" }}
          />
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>%</span>
        </div>
      </div>
    </Fields>
  );
}

/** The row's own abbreviation badge, in the status's colour (#728) — see the conditions page. */
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
