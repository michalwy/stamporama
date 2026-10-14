"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import {
  createCarrierAction,
  updateCarrierAction,
  deleteCarrierAction,
  createCarrierServiceAction,
  updateCarrierServiceAction,
  deleteCarrierServiceAction,
} from "@/app/actions/carriers";
import type { CarrierData, CarrierServiceData } from "@/lib/carriers";
import type { PackingSupplyData } from "@/lib/packing-supplies";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { TRACKING_CODE_TOKEN } from "@/lib/tracking-rules";
import { Icon } from "@/app/icons";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
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
  ListPane,
  ListRow,
  ListRows,
  RowName,
  countLabel,
  useTreeSelection,
} from "./list-detail";
import { carrierNodeId, carrierNodes, carrierPane, type CarrierNode } from "./carrier-tree-model";

const EXAMPLE_TEMPLATE = `https://emonitoring.poczta-polska.pl/?numer=${TRACKING_CODE_TOKEN}`;

interface CarriersPanelProps {
  collectionId: string;
  initialCarriers: CarrierData[];
  /** The collection's packing supplies (#1899) — what a service can list as a parcel's usual ones. */
  packingSupplies: PackingSupplyData[];
  /** The collection's base currency, the first guess for a new service's cost. */
  baseCurrency: string;
}

/**
 * The collection's carriers (#491) and their rate lists (#1909), as a tree beside the selected item's
 * fields — a carrier, and under it the services it offers with what each costs the collector. A
 * carrier's pane adds a service under it, as a vendor's adds a catalogue on the Catalogs page.
 *
 * The rate list is the collection's and tied to no platform: the cost of posting a letter has nothing
 * to do with where the stamp sold. A platform has shipping options at the **buyer's** price, each
 * linked to a service here (the contact dialog's Platform tab).
 */
export function CarriersPanel({
  collectionId,
  initialCarriers,
  packingSupplies,
  baseCurrency,
}: CarriersPanelProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const nodes = carrierNodes(initialCarriers);
  const sel = useTreeSelection(nodes.map(carrierNodeId));
  const pane = carrierPane(initialCarriers, sel.selection);
  const selectedId = pane.kind === "node" ? carrierNodeId(pane.node) : null;

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
      <AddRowAction label="Add carrier" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialCarriers.length, "carrier", "carriers")}
            hint="The post offices and couriers you send with, and what each of their services costs you. A platform's shipping options link to a service here: choosing one on a sale fills in the postage and the usual packing supplies, and the sale's tracking number becomes a link to the carrier's tracking page."
            empty={initialCarriers.length === 0 && "No carriers yet."}
          >
            <ListRows label="Carriers">
              {nodes.map((node) => (
                <CarrierRow
                  key={carrierNodeId(node)}
                  node={node}
                  selected={selectedId === carrierNodeId(node)}
                  onSelect={() => sel.select(carrierNodeId(node))}
                />
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          pane.kind === "none" ? (
            <DetailPlaceholder>
              No carriers yet. Add the first — Poczta Polska, InPost — and the services you send with.
            </DetailPlaceholder>
          ) : pane.kind === "new-carrier" ? (
            <DetailForm
              key="new"
              title="New carrier"
              isNew
              onSave={(fd) => createCarrierAction(collectionId, fd)}
              onSaved={onSaved(true)}
              onCancelNew={sel.cancelAdding}
            >
              <CarrierFields carrier={null} />
            </DetailForm>
          ) : pane.kind === "new-service" ? (
            <DetailForm
              key={`new:${pane.carrier.id}`}
              title="New service"
              context={pane.carrier.name}
              isNew
              onSave={(fd) => createCarrierServiceAction(pane.carrier.id, fd)}
              onSaved={onSaved(true)}
              onCancelNew={sel.cancelAdding}
            >
              <ServiceFields service={null} packingSupplies={packingSupplies} baseCurrency={baseCurrency} />
            </DetailForm>
          ) : pane.node.level === "carrier" ? (
            <DetailForm
              key={pane.node.carrier.id}
              title={pane.node.carrier.name}
              isNew={false}
              headerAction={
                <AddChildButton onClick={() => sel.startAdding(carrierNodeId(pane.node))}>
                  Add service
                </AddChildButton>
              }
              onSave={(fd) => updateCarrierAction(carrierNodeId(pane.node), fd)}
              onSaved={onSaved(false)}
              remove={{
                title: "Delete carrier",
                message: (
                  <>
                    Delete carrier <strong>{pane.node.carrier.name}</strong>? A carrier with services,
                    or one a sale names, can&apos;t be deleted.
                  </>
                ),
                run: () => deleteCarrierAction(carrierNodeId(pane.node)),
                onDone: onDeleted,
              }}
            >
              <CarrierFields carrier={pane.node.carrier} />
            </DetailForm>
          ) : (
            <DetailForm
              key={pane.node.service.id}
              title={pane.node.service.name}
              context={pane.node.carrier.name}
              isNew={false}
              onSave={(fd) => updateCarrierServiceAction(carrierNodeId(pane.node), fd)}
              onSaved={onSaved(false)}
              remove={{
                title: "Delete service",
                message: (
                  <>
                    Delete service <strong>{pane.node.service.name}</strong>? A service a platform&apos;s
                    shipping option is linked to can&apos;t be deleted — unlink it there first.
                  </>
                ),
                run: () => deleteCarrierServiceAction(carrierNodeId(pane.node)),
                onDone: onDeleted,
              }}
            >
              <ServiceFields
                service={pane.node.service}
                packingSupplies={packingSupplies}
                baseCurrency={baseCurrency}
              />
            </DetailForm>
          )
        }
      />
    </>
  );
}

/** One item of the tree: a carrier, or one of its services indented under it with its cost. */
function CarrierRow({
  node,
  selected,
  onSelect,
}: {
  node: CarrierNode;
  selected: boolean;
  onSelect: () => void;
}) {
  if (node.level === "carrier") {
    return (
      <ListRow selected={selected} onSelect={onSelect}>
        <RowName strong>{node.carrier.name}</RowName>
        {!node.carrier.trackingUrlTemplate && (
          <span style={{ flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            no tracking page
          </span>
        )}
      </ListRow>
    );
  }
  return (
    <ListRow selected={selected} onSelect={onSelect} depth={1}>
      <RowName>{node.service.name}</RowName>
      <span
        style={{
          flexShrink: 0,
          fontSize: "0.8125rem",
          color: "var(--color-text-muted)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {node.service.cost} {node.service.currency}
      </span>
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

function CarrierFields({ carrier }: { carrier: CarrierData | null }) {
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-carrier-name">Name</LabelWithError>
        <TextInput
          id="f-carrier-name"
          name="name"
          defaultValue={carrier?.name ?? ""}
          placeholder="e.g. Poczta Polska"
          required
          autoFocus={!carrier}
          {...NO_AUTOFILL}
          style={INPUT_STYLE}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-carrier-template">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Tracking address
            <InfoHint>
              Where this carrier looks a parcel up, with {TRACKING_CODE_TOKEN} standing in for the
              tracking number — e.g. {EXAMPLE_TEMPLATE}. Leave it blank if the carrier has no
              tracking page: sales still record the number, it just isn&apos;t a link.
            </InfoHint>
          </span>
        </LabelWithError>
        <TextInput
          id="f-carrier-template"
          name="trackingUrlTemplate"
          defaultValue={carrier?.trackingUrlTemplate ?? ""}
          placeholder={EXAMPLE_TEMPLATE}
          {...NO_AUTOFILL}
          style={INPUT_STYLE}
        />
        <FieldNote>
          <code>{TRACKING_CODE_TOKEN}</code> stands in for the tracking number. Blank: no link.
        </FieldNote>
      </div>
    </Fields>
  );
}

/** One row of the draft's usual supplies (#1899); the quantity is the field's text until saved. */
interface DraftSupply {
  supplyId: string;
  quantity: string;
}

/**
 * A service's fields: its name, what it costs the collector, and the packing supplies a parcel sent
 * this way usually takes (#1899). The supplies are kept in state and submitted as JSON in a hidden
 * field, so the form measures and reverts them like any other field.
 */
function ServiceFields({
  service,
  packingSupplies,
  baseCurrency,
}: {
  service: CarrierServiceData | null;
  packingSupplies: PackingSupplyData[];
  baseCurrency: string;
}) {
  const [supplies, setSupplies] = useState<DraftSupply[]>(
    () => service?.supplies.map((s) => ({ supplyId: s.supplyId, quantity: String(s.quantity) })) ?? []
  );
  const currency = service?.currency ?? baseCurrency;
  const known: readonly string[] = COMMON_CURRENCIES;
  const currencies = known.includes(currency) ? known : [currency, ...known];
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-service-name">Name</LabelWithError>
        <TextInput
          id="f-service-name"
          name="name"
          defaultValue={service?.name ?? ""}
          placeholder="e.g. List polecony ekonomiczny"
          required
          autoFocus={!service}
          {...NO_AUTOFILL}
          style={INPUT_STYLE}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "10rem 8rem", gap: "0.75rem" }}>
        <div>
          <LabelWithError htmlFor="f-service-cost">
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
              Cost to you
              <InfoHint>
                What sending by this service usually costs you. Choosing a shipping option linked to
                it fills in a sale&apos;s postage with it, still editable there. Changing it never
                touches a sale already recorded.
              </InfoHint>
            </span>
          </LabelWithError>
          <NumericInput
            kind="amount"
            id="f-service-cost"
            name="cost"
            defaultValue={service?.cost ?? ""}
            placeholder="0.00"
            required
            style={{ ...INPUT_STYLE, textAlign: "right" }}
          />
        </div>
        <div>
          <LabelWithError htmlFor="f-service-currency">Currency</LabelWithError>
          <select
            id="f-service-currency"
            name="currency"
            defaultValue={currency}
            style={{ ...INPUT_STYLE, cursor: "pointer" }}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      {packingSupplies.length > 0 && (
        <SuppliesField supplies={supplies} setSupplies={setSupplies} packingSupplies={packingSupplies} />
      )}
    </Fields>
  );
}

/** The service's usual packing supplies: a supply and a quantity per row, each supply once. */
function SuppliesField({
  supplies,
  setSupplies,
  packingSupplies,
}: {
  supplies: DraftSupply[];
  setSupplies: (next: DraftSupply[]) => void;
  packingSupplies: PackingSupplyData[];
}) {
  const listed = new Set(supplies.map((s) => s.supplyId));
  const unlisted = packingSupplies.filter((p) => !listed.has(p.id));
  const update = (i: number, patch: Partial<DraftSupply>) =>
    setSupplies(supplies.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div>
      <LabelWithError>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
          Packed with
          <InfoHint>
            The packing supplies a parcel sent this way usually takes. Choosing a shipping option
            linked to this service fills them in as the sale&apos;s supply lines, still editable there.
          </InfoHint>
        </span>
      </LabelWithError>
      <input
        type="hidden"
        name="supplies"
        value={JSON.stringify(
          supplies.map((s) => ({ supplyId: s.supplyId, quantity: Number(s.quantity.trim()) }))
        )}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {supplies.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <select
              value={s.supplyId}
              onChange={(e) => update(i, { supplyId: e.target.value })}
              aria-label="Packing supply"
              style={{ ...INPUT_STYLE, flex: 1, cursor: "pointer" }}
            >
              {packingSupplies
                .filter((p) => p.id === s.supplyId || !listed.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <span style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>×</span>
            <TextInput
              value={s.quantity}
              onChange={(e) => update(i, { quantity: e.target.value })}
              inputMode="numeric"
              aria-label="Quantity"
              {...NO_AUTOFILL}
              style={{ ...INPUT_STYLE, width: "4.5rem", textAlign: "right" }}
            />
            <DialogSecondaryButton
              aria-label="Remove supply"
              onClick={() => setSupplies(supplies.filter((_, j) => j !== i))}
            >
              <Icon name="close" size="sm" />
            </DialogSecondaryButton>
          </div>
        ))}
        {unlisted.length > 0 && (
          <div>
            <DialogSecondaryButton
              onClick={() => setSupplies([...supplies, { supplyId: unlisted[0].id, quantity: "1" }])}
            >
              <Icon name="add" size="sm" />
              &nbsp;Add supply
            </DialogSecondaryButton>
          </div>
        )}
        {supplies.length === 0 && unlisted.length > 0 && (
          <FieldNote>None — a sale choosing it fills in no supplies.</FieldNote>
        )}
      </div>
    </div>
  );
}
