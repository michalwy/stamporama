"use client";

import { useRouter } from "next/navigation";
import { DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import {
  createCatalogVendorAction,
  updateCatalogVendorAction,
  deleteCatalogVendorAction,
  createCatalogNameAction,
  updateCatalogNameAction,
  deleteCatalogNameAction,
  createCatalogEditionAction,
  updateCatalogEditionAction,
  deleteCatalogEditionAction,
} from "@/app/actions/catalog";
import type { CatalogVendorData } from "@/lib/catalog";
import { Icon } from "@/app/icons";
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
  countLabel,
  useTreeSelection,
} from "./list-detail";
import { catalogNodeId, catalogNodes, catalogPane, type CatalogNode } from "./catalog-tree-model";

const CURRENCIES = [
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP",
  "HRK", "HUF", "INR", "JPY", "KZT", "MXN", "NOK", "PLN", "RON", "RUB",
  "SEK", "TRY", "UAH", "USD", "ZAR",
];

const CURRENT_YEAR = new Date().getFullYear();

interface CatalogPanelProps {
  collectionId: string;
  initialTree: CatalogVendorData[];
}

/**
 * The catalogues as a tree beside the selected item's fields (#1471): vendors, their catalog names,
 * and each name's editions, three levels in one list. Any level can be selected and edited in the
 * pane; a vendor's pane adds a catalog name under it and a catalog name's pane adds an edition, so
 * an add always happens where its parent is on screen.
 */
export function CatalogPanel({ collectionId, initialTree }: CatalogPanelProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const nodes = catalogNodes(initialTree);
  const sel = useTreeSelection(nodes.map(catalogNodeId));
  const pane = catalogPane(initialTree, sel.selection);
  const selectedId = pane.kind === "node" ? catalogNodeId(pane.node) : null;

  const onSaved = (isNew: boolean) => () => {
    if (isNew) sel.expectCreated();
    refresh();
  };
  const onDeleted = () => {
    sel.cleared();
    refresh();
  };

  return (
    <>
      <AddRowAction label="Add vendor" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialTree.length, "vendor", "vendors")}
            hint="A vendor, the catalogues it publishes, and the editions of each you price from. Select any of them to edit it; a vendor adds catalogues and a catalogue adds editions."
            empty={initialTree.length === 0 && "No catalog vendors yet."}
          >
            <ListRows label="Catalogs">
              {nodes.map((node) => (
                <CatalogRow
                  key={catalogNodeId(node)}
                  node={node}
                  selected={selectedId === catalogNodeId(node)}
                  onSelect={() => sel.select(catalogNodeId(node))}
                />
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          pane.kind === "none" ? (
            <DetailPlaceholder>No catalog vendors yet. Add the first — Michel, Scott, Fischer.</DetailPlaceholder>
          ) : pane.kind === "new-vendor" ? (
            <DetailForm
              key="new"
              title="New vendor"
              isNew
              onSave={(fd) => createCatalogVendorAction(collectionId, fd)}
              onSaved={onSaved(true)}
              onCancelNew={sel.cancelAdding}
            >
              <VendorFields isNew />
            </DetailForm>
          ) : pane.kind === "new-name" ? (
            <DetailForm
              key={`new:${pane.vendor.id}`}
              title="New catalog name"
              context={pane.vendor.name}
              isNew
              onSave={(fd) => createCatalogNameAction(pane.vendor.id, fd)}
              onSaved={onSaved(true)}
              onCancelNew={sel.cancelAdding}
            >
              <CatalogNameFields isNew />
            </DetailForm>
          ) : pane.kind === "new-edition" ? (
            <DetailForm
              key={`new:${pane.name.id}`}
              title="New edition"
              context={`${pane.vendor.name} › ${pane.name.name}`}
              isNew
              onSave={(fd) => createCatalogEditionAction(pane.name.id, fd)}
              onSaved={onSaved(true)}
              onCancelNew={sel.cancelAdding}
            >
              <EditionFields isNew />
            </DetailForm>
          ) : pane.node.level === "vendor" ? (
            <DetailForm
              key={pane.node.vendor.id}
              title={pane.node.vendor.name}
              isNew={false}
              headerAction={
                <AddChildButton onClick={() => sel.startAdding(catalogNodeId(pane.node))}>
                  Add catalog name
                </AddChildButton>
              }
              onSave={(fd) => updateCatalogVendorAction(catalogNodeId(pane.node), fd)}
              onSaved={onSaved(false)}
              remove={{
                title: "Delete vendor",
                message: (
                  <>
                    Delete vendor <strong>{pane.node.vendor.name}</strong>? This will also delete all
                    its catalog names and editions. This cannot be undone.
                  </>
                ),
                run: () => deleteCatalogVendorAction(catalogNodeId(pane.node)),
                onDone: onDeleted,
              }}
            >
              <VendorFields
                defaultName={pane.node.vendor.name}
                defaultAbbreviation={pane.node.vendor.abbreviation}
              />
            </DetailForm>
          ) : pane.node.level === "name" ? (
            <DetailForm
              key={pane.node.name.id}
              title={pane.node.name.name}
              context={pane.node.vendor.name}
              isNew={false}
              headerAction={
                <AddChildButton onClick={() => sel.startAdding(catalogNodeId(pane.node))}>
                  Add edition
                </AddChildButton>
              }
              onSave={(fd) => updateCatalogNameAction(catalogNodeId(pane.node), fd)}
              onSaved={onSaved(false)}
              remove={{
                title: "Delete catalog name",
                message: (
                  <>
                    Delete catalog name <strong>{pane.node.name.name}</strong>? All its editions will
                    also be deleted. This cannot be undone.
                  </>
                ),
                run: () => deleteCatalogNameAction(catalogNodeId(pane.node)),
                onDone: onDeleted,
              }}
            >
              <CatalogNameFields
                defaultName={pane.node.name.name}
                defaultCurrency={pane.node.name.currency}
              />
            </DetailForm>
          ) : (
            <DetailForm
              key={pane.node.edition.id}
              title={`Edition ${pane.node.edition.year}`}
              context={`${pane.node.vendor.name} › ${pane.node.name.name}`}
              isNew={false}
              onSave={(fd) => updateCatalogEditionAction(catalogNodeId(pane.node), fd)}
              onSaved={onSaved(false)}
              remove={{
                title: "Delete edition",
                message: (
                  <>
                    Delete edition <strong>{pane.node.edition.year}</strong>? This cannot be undone.
                  </>
                ),
                run: () => deleteCatalogEditionAction(catalogNodeId(pane.node)),
                onDone: onDeleted,
              }}
            >
              <EditionFields defaultYear={pane.node.edition.year} />
            </DetailForm>
          )
        }
      />
    </>
  );
}

/** One item of the tree, indented by its level: a vendor with its abbreviation, a catalog name with
 *  its currency, an edition by its year. */
function CatalogRow({
  node,
  selected,
  onSelect,
}: {
  node: CatalogNode;
  selected: boolean;
  onSelect: () => void;
}) {
  if (node.level === "vendor") {
    return (
      <ListRow selected={selected} onSelect={onSelect}>
        <RowName strong>{node.vendor.name}</RowName>
        <span style={abbrBadgeStyle}>{node.vendor.abbreviation}</span>
      </ListRow>
    );
  }
  if (node.level === "name") {
    return (
      <ListRow selected={selected} onSelect={onSelect} depth={1}>
        <RowName>{node.name.name}</RowName>
        <span style={{ flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {node.name.currency}
        </span>
      </ListRow>
    );
  }
  return (
    <ListRow selected={selected} onSelect={onSelect} depth={2}>
      <RowName>
        <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", fontWeight: 400 }}>
          Edition {node.edition.year}
        </span>
      </RowName>
    </ListRow>
  );
}

function AddChildButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <DialogSecondaryButton onClick={onClick}>
      <Icon name="add" size="sm" />
      &nbsp;{children}
    </DialogSecondaryButton>
  );
}

function VendorFields({
  defaultName,
  defaultAbbreviation,
  isNew,
}: {
  defaultName?: string;
  defaultAbbreviation?: string;
  isNew?: boolean;
}) {
  return (
    <Fields>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 8rem", gap: "0.75rem" }}>
        <div>
          <LabelWithError htmlFor="f-vendor-name">Name</LabelWithError>
          <TextInput
            id="f-vendor-name"
            name="name"
            defaultValue={defaultName}
            placeholder="e.g. Michel"
            autoFocus={isNew}
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <LabelWithError htmlFor="f-vendor-abbr">Abbreviation</LabelWithError>
          <TextInput
            id="f-vendor-abbr"
            name="abbreviation"
            defaultValue={defaultAbbreviation}
            placeholder="e.g. Mi"
            style={INPUT_STYLE}
          />
        </div>
      </div>
    </Fields>
  );
}

function CatalogNameFields({
  defaultName,
  defaultCurrency,
  isNew,
}: {
  defaultName?: string;
  defaultCurrency?: string;
  isNew?: boolean;
}) {
  return (
    <Fields>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 8rem", gap: "0.75rem" }}>
        <div>
          <LabelWithError htmlFor="f-name-name">Name</LabelWithError>
          <TextInput
            id="f-name-name"
            name="name"
            defaultValue={defaultName}
            placeholder="e.g. Michel Deutschland"
            autoFocus={isNew}
            style={INPUT_STYLE}
          />
        </div>
        <div>
          <LabelWithError htmlFor="f-name-currency">Currency</LabelWithError>
          <select
            id="f-name-currency"
            name="currency"
            defaultValue={defaultCurrency ?? "EUR"}
            style={INPUT_STYLE}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Fields>
  );
}

function EditionFields({ defaultYear, isNew }: { defaultYear?: number; isNew?: boolean }) {
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-edition-year">Year</LabelWithError>
        <input
          id="f-edition-year"
          name="year"
          type="number"
          defaultValue={defaultYear ?? CURRENT_YEAR}
          min={1840}
          max={CURRENT_YEAR + 5}
          autoFocus={isNew}
          style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
        />
      </div>
    </Fields>
  );
}

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
