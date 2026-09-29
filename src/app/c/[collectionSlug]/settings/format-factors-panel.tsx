"use client";

import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createFormatFactorAction,
  updateFormatFactorAction,
  deleteFormatFactorAction,
} from "@/app/actions/format-factors";
import type { FormatFactorData } from "@/lib/format-factors";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { StampConditionData } from "@/lib/conditions";
import type { CollectionAreaData } from "@/lib/areas";
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
  ListGroupHeading,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  countLabel,
  useListSelection,
} from "./list-detail";

// Multipliers deriving a format's catalog price from the single's, for every stamp where no
// explicit price was recorded — the Formats entry's second tab, because the two are read together:
// the dictionary says what a block of four is, this says what one is worth. A list beside the
// selected multiplier (#1471), grouped by format; there is no order to drag, the grouping being the
// resolution's own.
//
// This panel covers the two scopes with no screen of their own: the **collection default** and an
// **area**. An issue's multipliers live on the issue, and are deliberately not listed here — a
// collection can hold one per issue per format, which is thousands of rows and not a list anybody
// reads. They are excluded at the query, not filtered out afterwards.
//
// Every row is the same shape — a format, a number, an optional area and an optional condition.
// The row with neither set is the collection default; there is no separate default field, because
// a second mechanism would need a second explanation.

interface FormatFactorsPanelProps {
  collectionId: string;
  initialFactors: FormatFactorData[];
  formats: StampFormatData[];
  conditions: StampConditionData[];
  areas: CollectionAreaData[];
}

/** Areas as an indented flat list — a full tree-select is more machinery than one optional
 *  anchor field needs, and the indentation carries the same information here. */
function areaOptions(areas: CollectionAreaData[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, CollectionAreaData[]>();
  for (const a of areas) {
    const siblings = byParent.get(a.parentId) ?? [];
    siblings.push(a);
    byParent.set(a.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of byParent.get(parentId) ?? []) {
      out.push({ id: a.id, label: `${"  ".repeat(depth)}${a.name}` });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** How a row's anchors read in the list. The unanchored row is named rather than left blank —
 *  "every area, every condition" is a fact worth stating. Issue anchors never reach this list. */
function anchorSummary(factor: FormatFactorData): string {
  const parts: string[] = [];
  if (factor.areaName) parts.push(factor.areaName);
  if (factor.conditionName) parts.push(factor.conditionName);
  return parts.length === 0 ? "Collection default" : parts.join(" · ");
}

const RANK_HINT =
  "A format's price is the single's price times its multiplier, unless a price was entered for that format — an entered price always wins. Where several could apply, the narrowest wins: issue first, then the nearest area, then condition. A single issue's multipliers are set from its row on the Issues list and are not shown here.";

export function FormatFactorsPanel({
  collectionId,
  initialFactors,
  formats,
  conditions,
  areas,
}: FormatFactorsPanelProps) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const formatName = new Map(formats.map((f) => [f.id, f.name]));
  // Grouped by format, and inside a group narrowest-anchor first, so a list reads the way the
  // resolution does: the exceptions above the default they fall back to.
  const grouped = formats
    .map((f) => ({
      format: f,
      rows: initialFactors
        .filter((r) => r.formatId === f.id)
        .sort((a, b) => anchorRank(b) - anchorRank(a)),
    }))
    .filter((g) => g.rows.length > 0);
  const orphaned = initialFactors.filter((r) => !formatName.has(r.formatId));
  // The list as drawn, so the pane opens on the first row the collector sees.
  const order = grouped.flatMap((g) => g.rows);
  const sel = useListSelection(order);
  const current = sel.current;

  return (
    <>
      <AddRowAction
        label="Add multiplier"
        onAdd={() => sel.startAdding()}
        disabledHint={formats.length === 0 ? "Add a format first — a multiplier is a format's." : undefined}
      />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialFactors.length, "multiplier", "multipliers")}
            hint={RANK_HINT}
            empty={
              initialFactors.length === 0 &&
              "No multipliers yet. Without one, a format shows a price only where you enter it by hand."
            }
          >
            {grouped.map((group, i) => (
              <div key={group.format.id}>
                <ListGroupHeading first={i === 0}>{group.format.name}</ListGroupHeading>
                <ListRows label={`${group.format.name} multipliers`}>
                  {group.rows.map((factor) => (
                    <ListRow
                      key={factor.id}
                      selected={current?.id === factor.id}
                      onSelect={() => sel.select(factor.id)}
                    >
                      <RowName>{anchorSummary(factor)}</RowName>
                      <span style={factorBadgeStyle}>×{factor.factor}</span>
                    </ListRow>
                  ))}
                </ListRows>
              </div>
            ))}
            {orphaned.length > 0 && (
              <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>
                {orphaned.length} multiplier(s) refer to a format that no longer exists.
              </p>
            )}
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={
                current
                  ? `${formatName.get(current.formatId) ?? "Format"} ×${current.factor}`
                  : "New multiplier"
              }
              context={current ? anchorSummary(current) : undefined}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateFormatFactorAction(current.id, fd)
                  : createFormatFactorAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete multiplier",
                      message: (
                        <>
                          Delete the ×{current.factor} multiplier for{" "}
                          <strong>{formatName.get(current.formatId) ?? "this format"}</strong> (
                          {anchorSummary(current)})? Prices derived from it stop being shown.
                        </>
                      ),
                      run: () => deleteFormatFactorAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <FactorFields
                defaults={current ?? undefined}
                formats={formats}
                conditions={conditions}
                areas={areas}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              {formats.length === 0
                ? "Add a format first: a multiplier says what one is worth."
                : "No multipliers yet. Add one to derive a format's price from the single's."}
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function FactorFields({
  defaults,
  formats,
  conditions,
  areas,
}: {
  defaults?: FormatFactorData;
  formats: StampFormatData[];
  conditions: StampConditionData[];
  areas: CollectionAreaData[];
}) {
  return (
    <Fields>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 8rem", gap: "0.75rem" }}>
        <div>
          <LabelWithError htmlFor="f-fac-format">Format</LabelWithError>
          <select
            id="f-fac-format"
            name="formatId"
            defaultValue={defaults?.formatId ?? ""}
            autoFocus={!defaults}
            style={INPUT_STYLE}
          >
            <option value="">Select a format…</option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <LabelWithError htmlFor="f-fac-factor">Multiplier</LabelWithError>
          <TextInput
            id="f-fac-factor"
            name="factor"
            inputMode="decimal"
            defaultValue={defaults ? String(defaults.factor) : ""}
            placeholder="e.g. 4.5"
            style={INPUT_STYLE}
          />
        </div>
      </div>
      <FieldNote>
        Applied to the single&apos;s price for this format, wherever no price of its own was entered.
      </FieldNote>

      <div>
        <LabelWithError htmlFor="f-fac-area">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Area
            <InfoHint>Covers every area below the one you pick.</InfoHint>
          </span>
        </LabelWithError>
        <select
          id="f-fac-area"
          name="collectionAreaId"
          defaultValue={defaults?.collectionAreaId ?? ""}
          style={INPUT_STYLE}
        >
          <option value="">Any area</option>
          {areaOptions(areas).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <LabelWithError htmlFor="f-fac-condition">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Condition
            <InfoHint>
              Where the multiple is scarcer in one condition than another — used blocks against
              mint, typically.
            </InfoHint>
          </span>
        </LabelWithError>
        <select
          id="f-fac-condition"
          name="conditionId"
          defaultValue={defaults?.conditionId ?? ""}
          style={INPUT_STYLE}
        >
          <option value="">Any condition</option>
          {conditions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </Fields>
  );
}

/** Display-only ordering inside a format group, mirroring the resolver's precedence. It cannot
 *  reproduce area *depth* — that depends on the stamp being priced, not on the row — so areas
 *  rank equally here and only the presence of an anchor counts. */
function anchorRank(factor: FormatFactorData): number {
  return (factor.collectionAreaId ? 2 : 0) + (factor.conditionId ? 1 : 0);
}

const factorBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
