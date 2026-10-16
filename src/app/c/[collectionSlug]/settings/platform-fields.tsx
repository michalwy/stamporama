"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LabelWithError } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { CoverColorPicker } from "@/app/c/[collectionSlug]/shared/photo-cover-editor";
import { BuyerMessageTemplateField } from "@/app/c/[collectionSlug]/shared/buyer-message-template-field";
import { multiLineFormControl } from "@/app/control-style";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { COMMON_LANGUAGES } from "@/lib/languages";
import { COMMON_MARKETS } from "@/lib/market-anchoring";
import {
  DESCRIPTION_FORMAT_LABELS,
  normalizeDescriptionFormat,
  type DescriptionFormat,
} from "@/lib/description-format";
import { getCollageTemplatesAction } from "@/app/actions/collage-templates";
import { getShippingOptionsAction } from "@/app/actions/shipping-options";
import type { CollageTemplateData } from "@/lib/collage-templates";
import { normalizeCollageGridMode } from "@/lib/collage-template-rules";
import {
  DEFAULT_PHOTO_SIDES,
  MAX_PHOTO_COUNT_LIMIT,
  MAX_PHOTO_EDGE_LIMIT,
  MAX_PHOTO_FILE_SIZE_MIB_LIMIT,
  PHOTO_SIDES,
  PHOTO_SIDES_LABELS,
} from "@/lib/offer-photo-config";
import { MAX_LISTING_TEXT_LENGTH_LIMIT } from "@/lib/listing-text-limits";
import { OFFER_LISTING_TYPES, OFFER_LISTING_TYPE_LABEL } from "@/lib/offer-rules";
import { REFRESH_QUICK_BUYS_DAYS_MAX } from "@/lib/offer-refresh-rules";
import { FACEBOOK_PLATFORM_MODULE } from "@/lib/platform-modules";
import {
  DEFAULT_PHOTO_COVER_COLOR,
  DEFAULT_PHOTO_COVER_STYLE,
  PHOTO_COVER_STYLE_LABELS,
  PHOTO_COVER_STYLES,
} from "@/lib/photo-cover-rules";
import type { PlatformData } from "@/lib/platforms";
import { ListingTemplatesDialog, type ListingTemplates } from "./listing-templates-dialog";
import { ShippingOptionsDialog } from "./shipping-options-dialog";
import { DetailSections, FieldNote, Fields, INPUT_STYLE, InfoHint } from "./list-detail";

// A platform's settings (#1955; ADR-0071) — the fields the contact form's Platform tab carried until
// platforms became their own entity, market and currency included. One component, drawn inside a
// `DetailForm`: a generic platform's detail on Settings → Platforms, and each module platform's
// Platform tab on its own page. The form around it is the one Save; the field names are what
// `updatePlatformAction` reads.
//
// Four sections side by side where the pane has the room (`DetailSections`): the platform itself,
// what an offer and a sale on it start as, the listing texts, and the photos.

/** How many listing templates the platform can configure — the summary row counts against it. */
const TEMPLATE_COUNT = 4;

const SECTION_HEADING: React.CSSProperties = {
  margin: "0 0 0.875rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-secondary)",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h4 style={SECTION_HEADING}>{title}</h4>
      <Fields>{children}</Fields>
    </section>
  );
}

/** One optional hard platform limit — a photo limit (#308) or a listing-text cap (#403). Blank
 * means the platform states no limit, which is why the placeholder says so rather than showing 0. */
function LimitField({
  id,
  name,
  label,
  max,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  max: number;
  defaultValue: number | null | undefined;
}) {
  // A column with the input at its foot, so a row of limits keeps its inputs level when one label
  // wraps onto a second line and its neighbours do not.
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <LabelWithError htmlFor={id}>{label}</LabelWithError>
      <input
        id={id}
        name={name}
        type="number"
        step={1}
        min={1}
        max={max}
        defaultValue={defaultValue ?? ""}
        placeholder="no limit"
        style={INPUT_STYLE}
      />
    </div>
  );
}

const CHECK_LABEL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

/** A summary of something kept in its own dialog, with the button that opens it. */
function SummaryRow({
  summary,
  muted,
  button,
  onOpen,
  disabled,
}: {
  summary: string;
  muted: boolean;
  button: string;
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <div
        style={{
          ...INPUT_STYLE,
          flex: 1,
          minWidth: 0,
          color: muted ? "var(--color-text-muted)" : "var(--color-text-primary)",
        }}
      >
        {summary}
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        style={{
          ...INPUT_STYLE,
          width: "auto",
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
          color: disabled ? "var(--color-text-muted)" : "var(--color-text-primary)",
        }}
      >
        {button}
      </button>
    </div>
  );
}

export interface PlatformFieldsProps {
  collectionId: string;
  /** The platform being edited; null while a generic platform is being added. */
  platform: PlatformData | null;
}

export function PlatformFields({ collectionId, platform }: PlatformFieldsProps) {
  const isModule = !!platform?.platformModule;
  const isFacebook = platform?.platformModule === FACEBOOK_PLATFORM_MODULE;
  const [coverColor, setCoverColor] = useState(platform?.coverColor ?? DEFAULT_PHOTO_COVER_COLOR);
  // The listing templates (#210, #266, #267) live in their own dialog — held here and submitted
  // through hidden fields, so the one Save carries them.
  const [templates, setTemplates] = useState<ListingTemplates>({
    titleTemplate: platform?.titleTemplate ?? "",
    descriptionTemplate: platform?.descriptionTemplate ?? "",
    privateNoteTemplate: platform?.privateNoteTemplate ?? "",
    tileLabelLeftTemplate: platform?.tileLabelLeftTemplate ?? "",
    tileLabelRightTemplate: platform?.tileLabelRightTemplate ?? "",
  });
  const [descriptionFormat, setDescriptionFormat] = useState<DescriptionFormat>(
    normalizeDescriptionFormat(platform?.descriptionFormat)
  );
  // Decides whether the default **starting price** exists at all (#449): that figure belongs to an
  // auction, and offering it on a quick-buy platform would ask for a number nothing reads.
  const [defaultListingType, setDefaultListingType] = useState(platform?.defaultListingType ?? "");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // The shipping options (#468, #1909) are records of their own, saved as they are edited — so only
  // a platform that already exists has them, and only their count is kept here for the summary.
  const [shippingOpen, setShippingOpen] = useState(false);
  const [shippingOptionCount, setShippingOptionCount] = useState<number | null>(null);
  // Controlled so a new shipping option defaults to the currency being configured right now.
  const [platformCurrency, setPlatformCurrency] = useState(platform?.platformCurrency ?? "");
  // So the template previews render in the language being configured.
  const [titleLanguage, setTitleLanguage] = useState(platform?.titleLanguage ?? "");
  const [collageTemplates, setCollageTemplates] = useState<CollageTemplateData[]>([]);
  const [defaultCollageTemplateId, setDefaultCollageTemplateId] = useState(
    platform?.defaultCollageTemplateId ?? ""
  );
  const [defaultGroupCollageTemplateId, setDefaultGroupCollageTemplateId] = useState(
    platform?.defaultGroupCollageTemplateId ?? ""
  );
  const configuredTemplates = Object.values(templates).filter((t) => t.trim()).length;
  // The form measures what is unsaved on its own input events; a value set from a dialog fires none,
  // so one is fired for it once the hidden fields hold the new value.
  const templatesFieldRef = useRef<HTMLInputElement>(null);
  function announceChange() {
    setTimeout(() => templatesFieldRef.current?.dispatchEvent(new Event("input", { bubbles: true })), 0);
  }

  useEffect(() => {
    let cancelled = false;
    getCollageTemplatesAction(collectionId)
      .then((rows) => {
        if (!cancelled) setCollageTemplates(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  const platformId = platform?.id;
  useEffect(() => {
    if (!platformId) return;
    let cancelled = false;
    getShippingOptionsAction(platformId)
      .then((rows) => {
        if (!cancelled) setShippingOptionCount(rows.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [platformId]);

  const templateLabel = (t: CollageTemplateData) =>
    `${t.name} (${
      normalizeCollageGridMode(t.gridMode) === "auto"
        ? `auto, up to ${t.rows} × ${t.columns}`
        : `${t.rows} × ${t.columns}`
    })`;

  return (
    <>
      <DetailSections>
        <Section title="Platform">
          {/* A module platform carries its module's name, fixed; a generic one is named here. */}
          {isModule ? (
            <input type="hidden" name="name" value={platform?.name ?? ""} />
          ) : (
            <div>
              <LabelWithError htmlFor="platform-name">Name</LabelWithError>
              <TextInput
                id="platform-name"
                name="name"
                defaultValue={platform?.name ?? ""}
                placeholder="e.g. eBay, a forum, a club's sales list"
                autoFocus={!platform}
                required
                style={INPUT_STYLE}
              />
              <FieldNote>Unique within the collection, and none of the module platforms&rsquo; names.</FieldNote>
            </div>
          )}

          <label style={CHECK_LABEL}>
            <input
              type="checkbox"
              name="enabled"
              value="true"
              defaultChecked={platform?.enabled ?? true}
              style={{ cursor: "pointer" }}
            />
            Switched on
            <InfoHint>
              A platform switched off is offered in no platform picker for a new offer, sale, purchase
              or auction. Everything already recorded on it keeps showing it.
            </InfoHint>
          </label>

          {/* Where results on it count when their auction house names no market (#1634). */}
          <div>
            <LabelWithError htmlFor="platform-market">Market</LabelWithError>
            <select
              id="platform-market"
              name="market"
              defaultValue={platform?.market ?? ""}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              <option value="">— not known (home market) —</option>
              {platform?.market && !COMMON_MARKETS.some((m) => m.code === platform.market) && (
                <option value={platform.market}>{platform.market}</option>
              )}
              {COMMON_MARKETS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label} ({m.code})
                </option>
              ))}
            </select>
            <FieldNote>The country it sells in, for results whose house names none.</FieldNote>
          </div>

          <div>
            <LabelWithError htmlFor="platform-notes">Notes</LabelWithError>
            <TextArea
              id="platform-notes"
              name="notes"
              rows={3}
              defaultValue={platform?.notes ?? ""}
              style={{ ...INPUT_STYLE, ...multiLineFormControl, resize: "vertical", minHeight: "4rem" }}
            />
          </div>
        </Section>

        <Section title="Offers and sales">
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="platform-currency">
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                  Currency
                  <InfoHint>
                    Every offer and sale on this platform uses it, and is locked to it. Changing it
                    later leaves existing offers and sales untouched.
                  </InfoHint>
                </span>
              </LabelWithError>
              <select
                id="platform-currency"
                name="platformCurrency"
                value={platformCurrency}
                onChange={(e) => setPlatformCurrency(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">— not set yet —</option>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="platform-title-language">
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                  Listing language
                  <InfoHint>
                    Generated text for this platform uses this language, falling back to the default
                    text where no translation is set.
                  </InfoHint>
                </span>
              </LabelWithError>
              <select
                id="platform-title-language"
                name="titleLanguage"
                value={titleLanguage}
                onChange={(e) => setTitleLanguage(e.target.value)}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">— default language —</option>
                {COMMON_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* What a new offer here starts as (#449). Not on Facebook: there a new offer is sold as
              its group says, set on the Facebook page's own tab (#1671). */}
          {isFacebook ? (
            <FieldNote>
              Whether a new offer here is an auction or a quick buy, and what it opens at, is set on
              the Facebook settings.
            </FieldNote>
          ) : (
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="platform-default-listing-type">
                  Default listing type (optional)
                </LabelWithError>
                <select
                  id="platform-default-listing-type"
                  name="defaultListingType"
                  value={defaultListingType}
                  onChange={(e) => setDefaultListingType(e.target.value)}
                  style={{ ...INPUT_STYLE, cursor: "pointer" }}
                >
                  <option value="">— no preference —</option>
                  {OFFER_LISTING_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {OFFER_LISTING_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <FieldNote>Pre-selects how a new offer here is sold.</FieldNote>
              </div>
              {defaultListingType === "auction" && (
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="platform-default-starting-price">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                      Default starting price
                      <InfoHint>
                        In the platform&rsquo;s currency, for a house you always open at the same
                        figure. Pre-fills a new auction only when neither the lot nor the copies&rsquo;
                        catalog value suggests a price — always editable afterwards.
                      </InfoHint>
                    </span>
                  </LabelWithError>
                  <NumericInput
                    kind="amount"
                    id="platform-default-starting-price"
                    name="defaultStartingPrice"
                    defaultValue={platform?.defaultStartingPrice ?? ""}
                    placeholder="—"
                    style={INPUT_STYLE}
                  />
                </div>
              )}
            </div>
          )}

          {/* The floor this platform lists at (#731): advisory, applied by hand beside a price. */}
          <div>
            <LabelWithError htmlFor="platform-minimum-price">Minimum price (optional)</LabelWithError>
            <NumericInput
              kind="amount"
              id="platform-minimum-price"
              name="minimumPrice"
              defaultValue={platform?.minimumPrice ?? ""}
              placeholder="—"
              style={INPUT_STYLE}
            />
            <FieldNote>
              Fills nothing on its own: click <strong>min</strong> beside an offer&rsquo;s price to apply it.
            </FieldNote>
          </div>

          {/* Not on Facebook: there the refresh and the buyer's message are Facebook's own settings,
              which its groups follow (#1661). */}
          {!isFacebook && (
            <div>
              <LabelWithError htmlFor="platform-refresh-quick-buys">
                Refresh quick buys after (days, optional)
              </LabelWithError>
              <input
                id="platform-refresh-quick-buys"
                name="refreshQuickBuysAfterDays"
                type="number"
                step={1}
                min={1}
                max={REFRESH_QUICK_BUYS_DAYS_MAX}
                defaultValue={platform?.refreshQuickBuysAfterDays ?? ""}
                placeholder="never"
                style={INPUT_STYLE}
              />
              <FieldNote>Marks an active quick buy up this long since it was posted, to post it again.</FieldNote>
            </div>
          )}

          {!isFacebook && (
            <div>
              <LabelWithError htmlFor="platform-buyer-message">Message to buyer (optional)</LabelWithError>
              <BuyerMessageTemplateField
                id="platform-buyer-message"
                defaultValue={platform?.buyerMessageTemplate ?? ""}
                style={{ ...INPUT_STYLE, ...multiLineFormControl, resize: "vertical", minHeight: "8rem" }}
              />
            </div>
          )}

          {/* Shipping options (#468, #1909): records of their own, saved as they are edited. */}
          <div>
            <LabelWithError>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                Shipping options
                <InfoHint>
                  The shipping buyers on this platform choose from, at what they pay for it, each linked
                  to a carrier service. Picking one on a sale fills in the postage from that service.
                </InfoHint>
              </span>
            </LabelWithError>
            <SummaryRow
              summary={
                platform
                  ? shippingOptionCount == null
                    ? "…"
                    : shippingOptionCount === 0
                      ? "None — a sale here names its own shipping"
                      : `${shippingOptionCount} option${shippingOptionCount === 1 ? "" : "s"}`
                  : "Available once the platform is added"
              }
              muted={!shippingOptionCount}
              button="Options…"
              onOpen={() => setShippingOpen(true)}
              disabled={!platform}
            />
          </div>
        </Section>

        <Section title="Listing texts">
          {/* Listing templates (#210, #266, #267, #312) and the description format (#319). */}
          <div>
            <input ref={templatesFieldRef} type="hidden" name="titleTemplate" value={templates.titleTemplate} />
            <input type="hidden" name="descriptionTemplate" value={templates.descriptionTemplate} />
            <input type="hidden" name="privateNoteTemplate" value={templates.privateNoteTemplate} />
            <input type="hidden" name="descriptionFormat" value={descriptionFormat} />
            <input type="hidden" name="tileLabelLeftTemplate" value={templates.tileLabelLeftTemplate} />
            <input type="hidden" name="tileLabelRightTemplate" value={templates.tileLabelRightTemplate} />
            <LabelWithError>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                Listing templates
                <InfoHint>
                  Title, description, private note and photo tile label for this platform&rsquo;s
                  listings, each generated from a {"{token}"} template with a live preview — and what the
                  description field accepts: plain text, HTML or Markdown.
                </InfoHint>
              </span>
            </LabelWithError>
            <SummaryRow
              summary={
                configuredTemplates
                  ? `${configuredTemplates} of ${TEMPLATE_COUNT} configured · ${DESCRIPTION_FORMAT_LABELS[descriptionFormat]} description`
                  : "None — listings use the catalog/copy label"
              }
              muted={!configuredTemplates}
              button="Templates…"
              onOpen={() => setTemplatesOpen(true)}
            />
          </div>

          {/* Listing text limits (#403): read live, never seeded; nothing is truncated against them. */}
          <div>
            <LabelWithError>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                Listing text limits
                <InfoHint>
                  How long this platform lets each text be — a character counter appears wherever the
                  offer&rsquo;s texts are written or copied. Delcampe refuses an upload row whose title is
                  over its cap, so the export refuses it first.
                </InfoHint>
              </span>
            </LabelWithError>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <LimitField
                id="platform-max-title-length"
                name="maxTitleLength"
                label="Max title"
                max={MAX_LISTING_TEXT_LENGTH_LIMIT}
                defaultValue={platform?.maxTitleLength}
              />
              <LimitField
                id="platform-max-description-length"
                name="maxDescriptionLength"
                label="Max description"
                max={MAX_LISTING_TEXT_LENGTH_LIMIT}
                defaultValue={platform?.maxDescriptionLength}
              />
              <LimitField
                id="platform-max-private-note-length"
                name="maxPrivateNoteLength"
                label="Max private note"
                max={MAX_LISTING_TEXT_LENGTH_LIMIT}
                defaultValue={platform?.maxPrivateNoteLength}
              />
            </div>
            <FieldNote>In characters. Blank where the platform states no limit.</FieldNote>
          </div>
        </Section>

        <Section title="Photos">
          {/* The limits are what the platform accepts, read live (#308); the defaults below are
              seeded onto every new offer and never reach back into prepared ones. */}
          <div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <LimitField
                id="platform-max-photos"
                name="maxPhotos"
                label="Max photos"
                max={MAX_PHOTO_COUNT_LIMIT}
                defaultValue={platform?.maxPhotos}
              />
              <LimitField
                id="platform-max-photo-edge"
                name="maxPhotoEdge"
                label="Max longest edge (px)"
                max={MAX_PHOTO_EDGE_LIMIT}
                defaultValue={platform?.maxPhotoEdge}
              />
              <LimitField
                id="platform-max-photo-size"
                name="maxPhotoFileSizeMib"
                label="Max file size (MiB)"
                max={MAX_PHOTO_FILE_SIZE_MIB_LIMIT}
                defaultValue={platform?.maxPhotoFileSizeMib}
              />
            </div>
            <FieldNote>What this platform accepts. Blank where it states no limit.</FieldNote>
          </div>

          {/* Covering symbols (#1665): read live, like the limits. */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 0.75rem" }}>
            <label style={CHECK_LABEL}>
              <input
                type="checkbox"
                name="coverSymbols"
                value="true"
                defaultChecked={platform?.coverSymbols ?? false}
                style={{ cursor: "pointer" }}
              />
              Cover symbols on offer photos
            </label>
            <label
              htmlFor="platform-cover-style"
              style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", marginLeft: "auto" }}
            >
              New covers start as
            </label>
            <select
              id="platform-cover-style"
              name="coverStyle"
              defaultValue={platform?.coverStyle ?? DEFAULT_PHOTO_COVER_STYLE}
              style={{ ...INPUT_STYLE, width: "auto", cursor: "pointer" }}
            >
              {PHOTO_COVER_STYLES.map((style) => (
                <option key={style} value={style}>
                  {PHOTO_COVER_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
            <Tooltip content="The colour of the first solid bar drawn. After that a new bar starts in the colour last used on this browser.">
              <label
                htmlFor="platform-cover-color"
                style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}
              >
                Bars in
              </label>
            </Tooltip>
            <CoverColorPicker id="platform-cover-color" value={coverColor} onChange={setCoverColor} />
            <input type="hidden" name="coverColor" value={coverColor} />
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="platform-photo-sides">Sides to photograph</LabelWithError>
              <select
                id="platform-photo-sides"
                name="photoSides"
                defaultValue={platform?.photoSides ?? DEFAULT_PHOTO_SIDES}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {PHOTO_SIDES.map((side) => (
                  <option key={side} value={side}>
                    {PHOTO_SIDES_LABELS[side]}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="platform-default-collage">Collage template</LabelWithError>
              {/* Carried by a hidden field: the select is disabled until the templates load, and a
                  disabled control submits nothing — which would clear the setting. */}
              <input type="hidden" name="defaultCollageTemplateId" value={defaultCollageTemplateId} />
              <select
                id="platform-default-collage"
                value={defaultCollageTemplateId}
                onChange={(e) => setDefaultCollageTemplateId(e.target.value)}
                disabled={collageTemplates.length === 0}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">
                  {collageTemplates.length === 0 ? "— none defined yet —" : "— none —"}
                </option>
                {collageTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {templateLabel(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* #521: single-copy sets on photos of their own while the limit above has room. */}
          <label style={CHECK_LABEL}>
            <input
              type="checkbox"
              name="photoPreferSingles"
              value="true"
              defaultChecked={platform?.photoPreferSingles ?? true}
              style={{ cursor: "pointer" }}
            />
            Single photos while the photo limit allows
          </label>

          {/* #1673: a set's series on photos of their own, laid out with the template beside. */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <Tooltip content="Every series a set holds two or more stamps of gets photos of its own, in the series' order, laid out with the template beside; with none, the collage template above.">
              <label style={{ ...CHECK_LABEL, flex: 1 }}>
                <input
                  type="checkbox"
                  name="photoGroupByChecklist"
                  value="true"
                  defaultChecked={platform?.photoGroupByChecklist ?? false}
                  style={{ cursor: "pointer" }}
                />
                Group series on their own photos
              </label>
            </Tooltip>
            <div style={{ flex: 1 }}>
              <input
                type="hidden"
                name="defaultGroupCollageTemplateId"
                value={defaultGroupCollageTemplateId}
              />
              <select
                aria-label="Series template"
                value={defaultGroupCollageTemplateId}
                onChange={(e) => setDefaultGroupCollageTemplateId(e.target.value)}
                disabled={collageTemplates.length === 0}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">Series: same as the collage template</option>
                {collageTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    Series: {templateLabel(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <FieldNote>Copied onto every new offer here; prepared offers keep theirs.</FieldNote>
        </Section>
      </DetailSections>

      {/* Portalled: the detail pane is sticky, a stacking context of its own, and a dialog left inside
          it would rank only within the pane. Outside the form, too, so its buttons submit nothing. */}
      {shippingOpen &&
        platform &&
        createPortal(
          <ShippingOptionsDialog
            collectionId={collectionId}
            platformId={platform.id}
            platformName={platform.name}
            defaultCurrency={platformCurrency || COMMON_CURRENCIES[0]}
            onClose={() => setShippingOpen(false)}
            onCountChange={setShippingOptionCount}
          />,
          document.body
        )}

      {templatesOpen &&
        createPortal(
          <ListingTemplatesDialog
            collectionId={collectionId}
            language={titleLanguage || null}
            templates={templates}
            descriptionFormat={descriptionFormat}
            onCancel={() => setTemplatesOpen(false)}
            onSave={(next, format) => {
              setTemplates(next);
              setDescriptionFormat(format);
              setTemplatesOpen(false);
              announceChange();
            }}
          />,
          document.body
        )}
    </>
  );
}
