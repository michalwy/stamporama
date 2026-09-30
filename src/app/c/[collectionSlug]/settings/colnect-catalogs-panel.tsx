"use client";

import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createColnectMappingAction,
  updateColnectMappingAction,
  deleteColnectMappingAction,
} from "@/app/actions/colnect";
import type { ColnectMappingData } from "@/lib/colnect";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
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
  countLabel,
  useListSelection,
} from "./list-detail";

/** Minimal local-vendor shape needed for the mapping select. */
export interface ColnectVendorOption {
  id: string;
  name: string;
  abbreviation: string;
}

interface ColnectCatalogsPanelProps {
  collectionId: string;
  initialMappings: ColnectMappingData[];
  vendors: ColnectVendorOption[];
}

/**
 * The Colnect page's Catalogs tab (#248, #1480): which of our catalogs each Colnect abbreviation
 * means, as a list beside the selected mapping's detail — the shape the dictionaries use (#1471).
 *
 * The list holds only the **exceptions**. Colnect prints numbers under its own abbreviations, and
 * one that is also ours maps to that catalog without a row; a row is added only where the two
 * differ (Colnect `Pol` → our Fischer). Anything still unmatched is ignored.
 */
export function ColnectCatalogsPanel({
  collectionId,
  initialMappings,
  vendors,
}: ColnectCatalogsPanelProps) {
  const router = useRouter();
  const sel = useListSelection(initialMappings);
  const current = sel.adding ? null : sel.current;
  const hasVendors = vendors.length > 0;

  return (
    <>
      <AddRowAction
        label="Add mapping"
        onAdd={() => sel.startAdding()}
        disabledHint={
          hasVendors ? undefined : "Add a catalog on the Catalogs page first, then map to it here."
        }
      />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialMappings.length, "mapping", "mappings")}
            hint="Colnect lists catalogue numbers under its own abbreviations (Mi, Sn, Yt, Sg, AFA, Pol…). Add a mapping only where Colnect's abbreviation differs from yours — Colnect Pol → your Fischer. An abbreviation without one maps to your catalog with the same abbreviation; anything still unmatched is ignored."
            empty={initialMappings.length === 0 && "No mappings yet."}
          >
            <ListRows label="Colnect catalog mappings">
              {initialMappings.map((mapping) => (
                <ListRow
                  key={mapping.id}
                  selected={current?.id === mapping.id}
                  onSelect={() => sel.select(mapping.id)}
                >
                  <span style={ABBR_BADGE}>{mapping.colnectAbbrev}</span>
                  <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
                    →
                  </span>
                  <RowName>
                    {mapping.vendorName}{" "}
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                      ({mapping.vendorAbbreviation})
                    </span>
                  </RowName>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? `${current.colnectAbbrev} → ${current.vendorName}` : "New mapping"}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateColnectMappingAction(current.id, fd)
                  : createColnectMappingAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                router.refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete Colnect mapping",
                      message: (
                        <>
                          Delete the mapping <strong>{current.colnectAbbrev}</strong> →{" "}
                          <strong>{current.vendorName}</strong>? This cannot be undone.
                        </>
                      ),
                      run: () => deleteColnectMappingAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        router.refresh();
                      },
                    }
                  : undefined
              }
            >
              <MappingFields mapping={current} vendors={vendors} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              {hasVendors
                ? "Abbreviations Colnect shares with your catalogs already match. Add a mapping only for one that differs."
                : "Add a catalog on the Catalogs page first, then map Colnect's abbreviations to it here."}
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function MappingFields({
  mapping,
  vendors,
}: {
  mapping: ColnectMappingData | null;
  vendors: ColnectVendorOption[];
}) {
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-colnect-abbrev">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Colnect abbreviation
            <InfoHint>
              As Colnect prints it beside a catalogue number, e.g. Pol for Fischer.
            </InfoHint>
          </span>
        </LabelWithError>
        <TextInput
          id="f-colnect-abbrev"
          name="colnectAbbrev"
          defaultValue={mapping?.colnectAbbrev ?? ""}
          placeholder="e.g. Pol"
          required
          autoFocus={!mapping}
          {...NO_AUTOFILL}
          style={{ ...INPUT_STYLE, maxWidth: "10rem" }}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-colnect-vendor">Maps to local catalog</LabelWithError>
        <select
          id="f-colnect-vendor"
          name="catalogVendorId"
          defaultValue={mapping?.catalogVendorId ?? ""}
          required
          style={INPUT_STYLE}
        >
          <option value="" disabled>
            — Select a catalog —
          </option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.abbreviation})
            </option>
          ))}
        </select>
      </div>
    </Fields>
  );
}

const ABBR_BADGE: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
