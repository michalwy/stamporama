"use client";

import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createCarrierAction,
  updateCarrierAction,
  deleteCarrierAction,
} from "@/app/actions/carriers";
import type { CarrierData } from "@/lib/carriers";
import { TRACKING_CODE_TOKEN } from "@/lib/tracking-rules";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
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
  useListSelection,
} from "./list-detail";

const EXAMPLE_TEMPLATE = `https://emonitoring.poczta-polska.pl/?numer=${TRACKING_CODE_TOKEN}`;

interface CarriersPanelProps {
  collectionId: string;
  initialCarriers: CarrierData[];
}

/**
 * The collection's carriers (#491) — who actually moves the parcel, and where its consignments are
 * tracked — as a list beside the selected carrier's detail (#1476).
 *
 * A dictionary of the collection's, not of a platform's, which is the whole reason it exists
 * separately from the [shipping methods](../contacts) that point at it: postage is priced by the
 * marketplace, but Poczta Polska tracks an Allegro parcel and a Delcampe one at the same address,
 * and a template kept per platform would be the same line typed twice and stale once.
 */
export function CarriersPanel({ collectionId, initialCarriers }: CarriersPanelProps) {
  const router = useRouter();
  const sel = useListSelection(initialCarriers);
  const current = sel.adding ? null : sel.current;

  return (
    <>
      <AddRowAction label="Add carrier" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialCarriers.length, "carrier", "carriers")}
            hint="The post offices and couriers you send with. A platform's shipping methods name the carrier that posts by them, and a sale's tracking number then becomes a link to that carrier's tracking page."
            empty={initialCarriers.length === 0 && "No carriers yet."}
          >
            <ListRows label="Carriers">
              {initialCarriers.map((carrier) => (
                <ListRow
                  key={carrier.id}
                  selected={current?.id === carrier.id}
                  onSelect={() => sel.select(carrier.id)}
                >
                  <RowName>{carrier.name}</RowName>
                  {!carrier.trackingUrlTemplate && (
                    <span style={{ flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                      no tracking page
                    </span>
                  )}
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New carrier"}
              isNew={!current}
              onSave={(fd) =>
                current ? updateCarrierAction(current.id, fd) : createCarrierAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                router.refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete carrier",
                      message: (
                        <>
                          Delete carrier <strong>{current.name}</strong>? A carrier a shipping method
                          still posts with can&apos;t be deleted — detach it there first.
                        </>
                      ),
                      run: () => deleteCarrierAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        router.refresh();
                      },
                    }
                  : undefined
              }
            >
              <CarrierFields carrier={current} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              No carriers yet. Add one to turn tracking numbers into links.
            </DetailPlaceholder>
          )
        }
      />
    </>
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
