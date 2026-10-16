"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { multiLineFormControl } from "@/app/control-style";
import { DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { FacebookPostTemplateField } from "@/app/c/[collectionSlug]/shared/facebook-post-template-field";
import { BuyerMessageTemplateField } from "@/app/c/[collectionSlug]/shared/buyer-message-template-field";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { FacebookGroupData, FacebookGroupList } from "@/lib/facebook-groups";
import {
  effectiveFacebookGroupSettings,
  FACEBOOK_AUCTION_DAYS_MAX,
  FACEBOOK_MULTI_LOT_LAYOUT_LABEL,
  FACEBOOK_MULTI_LOT_LAYOUTS,
  isFacebookGroupSetting,
  standingNoteUnused,
  usesRetiredPostPlaceholder,
  type FacebookGroupSetting,
  type FacebookGroupValues,
  type FacebookMultiLotLayout,
  type FacebookPostingSettings,
  type FacebookStartingPriceMode,
  type FacebookTemplateRole,
} from "@/lib/facebook-group-rules";
import { OFFER_LISTING_TYPE_LABEL, OFFER_LISTING_TYPES, type OfferListingType } from "@/lib/offer-rules";
import { REFRESH_QUICK_BUYS_DAYS_MAX } from "@/lib/offer-refresh-rules";
import {
  createFacebookGroupAction,
  deleteFacebookGroupAction,
  setFacebookGroupArchivedAction,
  updateFacebookDefaultsAction,
  updateFacebookGroupAction,
} from "@/app/actions/facebook";
import {
  FACEBOOK_CASE_PARAM,
  FACEBOOK_SETTINGS_CASES,
  facebookCustomCases,
  parseFacebookSettingsCase,
  type FacebookSettingsCase,
} from "./facebook-settings-cases";
import type { PlatformListItem } from "@/lib/platforms";
import { ModulePlatformTab } from "./module-platform-tab";
import { SETTINGS_FIELD_SELECT_STYLE } from "./settings-field-grid";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  DetailSections,
  FieldNote,
  INPUT_STYLE,
  InfoHint,
  ListDetail,
  ListGroupHeading,
  ListPane,
  ListRow,
  ListRows,
  RowName,
  RowTag,
  countLabel,
  useListSelection,
} from "./list-detail";

/*
 * Settings → Facebook (#1543; ADR-0061): the **groups** under the Facebook platform — list beside
 * detail, the dictionaries' shape (#1471) — and, on a tab of its own, the **Platform** (#1955): the
 * Facebook platform's own settings and its on/off switch, which replaced the choice of which contact
 * was Facebook.
 *
 * Facebook is one platform and its groups sit under it: the groups are what is configured here, and what a group holds is its customs — how a new offer there is sold, the post
 * templates for an auction and a quick buy (#1671), the standing note, and the defaults a new auction
 * there starts from. **Facebook's own row comes first** (#1661): the
 * settings every group follows, each of which a group may instead set custom for itself. Groups in
 * use are listed next and the archived ones under their own heading, still editable and brought
 * back from the pane.
 *
 * The pane takes the width beside the list (#1801) and is split into **tabs by case** (#1849): General,
 * Auctions, Quick buys, Several-lot posts, Buyer messages — each holding everything for that case and
 * nothing else, every template saying in a line when it is used. Facebook's pane and a group's are
 * the same tabs; a group's tab holding a setting of its own is marked, and the tab shown is kept in
 * the address while moving between rows.
 */

export function FacebookSettingsBody({
  part,
  collectionId,
  platform,
  groups,
}: {
  part: string | null;
  collectionId: string;
  platform: PlatformListItem;
  groups: FacebookGroupList;
}) {
  if (part === "platform") return <ModulePlatformTab collectionId={collectionId} platform={platform} />;
  return groups.platformId ? (
    <GroupsListDetail collectionId={collectionId} list={groups} />
  ) : (
    <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
      The Facebook platform is not set up yet. Reload the page to create it.
    </p>
  );
}

/** The list's first row: Facebook's own settings, which every group follows (#1661). Not a group id
 *  — a cuid never carries a colon. */
const DEFAULTS_ROW = "facebook:defaults";

function GroupsListDetail({ collectionId, list }: { collectionId: string; list: FacebookGroupList }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const rows = useMemo(() => [{ id: DEFAULTS_ROW }, ...list.groups], [list.groups]);
  const sel = useListSelection(rows);
  const onDefaults = !sel.adding && sel.current?.id === DEFAULTS_ROW;
  const current = list.groups.find((g) => g.id === sel.current?.id) ?? null;
  const inUse = list.groups.filter((g) => g.archivedAt === null);
  const archived = list.groups.filter((g) => g.archivedAt !== null);

  const row = (group: FacebookGroupData) => (
    <ListRow key={group.id} selected={current?.id === group.id} onSelect={() => sel.select(group.id)}>
      <RowName>{group.name}</RowName>
      {/* A group's own template still carrying a retired placeholder (#1671); one it follows is
          flagged on Facebook's row instead. */}
      {usesRetiredPostPlaceholder(group) && <RetiredTag />}
      {group.offerCount > 0 && <RowTag>{countLabel(group.offerCount, "offer", "offers")}</RowTag>}
    </ListRow>
  );

  return (
    <>
      <AddRowAction label="Add group" onAdd={sel.startAdding} />
      <ListDetail
        wide
        list={
          <ListPane
            caption={countLabel(inUse.length, "group", "groups")}
            hint={
              <>
                The Facebook groups you sell in on {list.platformName}. Every group follows
                Facebook&rsquo;s settings — whether a new offer is an auction or a quick buy, how a
                post reads, the note on shipping, payment and terms, and what a new auction starts
                from — unless it sets one custom for itself. Archive a group you no longer post in;
                one with offers cannot be deleted.
              </>
            }
          >
            <ListRows label="Facebook">
              <ListRow selected={onDefaults} onSelect={() => sel.select(DEFAULTS_ROW)}>
                <RowName strong>Facebook defaults</RowName>
                {usesRetiredPostPlaceholder(list.defaults) && <RetiredTag />}
              </ListRow>
            </ListRows>
            <ListGroupHeading>Groups</ListGroupHeading>
            {inUse.length > 0 ? (
              <ListRows label="Facebook groups">{inUse.map(row)}</ListRows>
            ) : (
              list.groups.length === 0 && (
                <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
                  No groups yet. Add the groups you sell in — an offer on Facebook is posted in one.
                </p>
              )
            )}
            {archived.length > 0 && (
              <>
                <ListGroupHeading>Archived</ListGroupHeading>
                <ListRows label="Archived Facebook groups">{archived.map(row)}</ListRows>
              </>
            )}
          </ListPane>
        }
        detail={
          onDefaults ? (
            <DetailForm
              key={DEFAULTS_ROW}
              title="Facebook defaults"
              context="Every group follows these unless it sets its own"
              isNew={false}
              onSave={(fd) => updateFacebookDefaultsAction(collectionId, settingsInput(fd))}
              onSaved={refresh}
            >
              <DefaultsFields defaults={list.defaults} platformCurrency={list.platformCurrency} />
            </DetailForm>
          ) : sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New group"}
              context={current?.archivedAt ? "Archived" : undefined}
              isNew={!current}
              headerAction={current ? <ArchiveButton group={current} onDone={refresh} /> : undefined}
              onSave={(fd) => {
                const input = groupInput(fd);
                return current
                  ? updateFacebookGroupAction(current.id, input)
                  : createFacebookGroupAction(collectionId, input);
              }}
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: `Delete ${current.name}`,
                      message: (
                        <>
                          <strong>{current.name}</strong> and its settings are deleted. No offer
                          names it, so nothing else changes.
                        </>
                      ),
                      // A group with offers is where sales happened: the button says so before it
                      // is pressed, and the server refuses it anyway.
                      disabledHint:
                        current.offerCount > 0
                          ? `${countLabel(current.offerCount, "offer names", "offers name")} this group, so it cannot be deleted — archive it instead.`
                          : undefined,
                      run: () => deleteFacebookGroupAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <GroupFields
                group={current}
                defaults={list.defaults}
                platformCurrency={list.platformCurrency}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>Choose a group to see its settings.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

/** A row whose template still carries a placeholder no longer offered (#1671): the collector removes
 *  it from the template, which is filled in until then. */
function RetiredTag() {
  return (
    <Tooltip content="A post template here still uses {catalog}, which is no longer offered — the catalogue numbers are in the title or description. It is filled in until you remove it.">
      <span style={{ display: "inline-flex" }}>
        <RowTag>
          <span style={{ color: "var(--color-warning)", textTransform: "none" }}>{"{catalog}"}</span>
        </RowTag>
      </span>
    </Tooltip>
  );
}

/** Archive the group, or bring it back — one click, no question: nothing is lost either way. */
function ArchiveButton({ group, onDone }: { group: FacebookGroupData; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const archived = group.archivedAt !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
      <DialogSecondaryButton
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await setFacebookGroupArchivedAction(group.id, !archived);
            if (result.status === "success") onDone();
            else setError(result.message);
          });
        }}
      >
        <Icon name={archived ? "restore" : "archive"} size="sm" />
        &nbsp;{archived ? "Restore" : "Archive"}
      </DialogSecondaryButton>
      {error && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</p>
      )}
    </div>
  );
}

/** A figure that may simply not have been stated: blank is `null`, not 0. */
function optionalNumber(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw);
}

/** The posting settings a pane's form holds — Facebook's, or a group's own. A setting a group
 *  follows has no control in the form, so it reads as blank here, which is what the save stores. */
function settingsInput(fd: FormData): FacebookPostingSettings {
  const text = (key: string) => String(fd.get(key) ?? "");
  const mode = text("startingPriceMode");
  return {
    // A group following Facebook sends no listing type; the save stores the blank one.
    listingType: text("listingType") === "fixed" ? "fixed" : "auction",
    mixedListingTypes: fd.get("mixedListingTypes") === "on",
    postTemplate: text("postTemplate"),
    quickBuyTemplate: text("quickBuyTemplate"),
    standingNote: text("standingNote"),
    startingPriceMode: mode === "" ? null : (mode as FacebookStartingPriceMode),
    startingPriceValue: mode === "" ? null : optionalNumber(text("startingPriceValue")),
    bidIncrement: optionalNumber(text("bidIncrement")),
    auctionDays: optionalNumber(text("auctionDays")),
    closingTime: text("closingTime") || null,
    refreshQuickBuysAfterDays: optionalNumber(text("refreshQuickBuysAfterDays")),
    buyerMessageTemplate: text("buyerMessageTemplate"),
    // A group following Facebook's layout sends none; the save stores the blank one.
    multiLotLayout: text("multiLotLayout") === "captions" ? "captions" : "text",
    auctionCaptionTemplate: text("auctionCaptionTemplate"),
    quickBuyCaptionTemplate: text("quickBuyCaptionTemplate"),
    captionPostTemplate: text("captionPostTemplate"),
  };
}

/** What a group's pane saves. */
function groupInput(fd: FormData): FacebookGroupValues {
  const text = (key: string) => String(fd.get(key) ?? "");
  return {
    name: text("name"),
    url: text("url"),
    ...settingsInput(fd),
    currency: text("currency") || null,
    custom: fd.getAll("custom").map(String).filter(isFacebookGroupSetting),
  };
}

/** A small heading over a group of fields in the pane. */
function GroupLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <LabelWithError htmlFor={htmlFor}>{children}</LabelWithError>
      {hint && <InfoHint>{hint}</InfoHint>}
    </div>
  );
}

const TEXTAREA_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  ...multiLineFormControl,
  minHeight: "8rem",
  resize: "vertical",
  fontFamily: "inherit",
  lineHeight: 1.5,
};

/** A post template is as wide as its section and tall enough for a typical post — a title, a few
 *  lines of description, the price and `{terms}` — without scrolling inside it (#1801). */
const POST_TEMPLATE_STYLE: React.CSSProperties = { ...TEXTAREA_STYLE, minHeight: "14rem" };

/** The hints the settings carry, said once for Facebook's pane and a group's alike. */
const HINTS = {
  listingType:
    "Whether a new offer here starts as an auction or a quick buy. Each offer can be changed on its own form.",
  mixedListingTypes:
    "Off, the lots of one post are all auctions or all quick buys. On, one post may hold both, each lot written from its own type's template.",
  postTemplate: (
    <>
      The text an auction&rsquo;s post is prepared from. Each placeholder is filled in from the offer
      when the post is prepared; in a post holding several lots, each lot gets its own line.{" "}
      <code>{"{terms}"}</code> puts the note on shipping, payment and terms where it stands — once, in
      the last lot.
    </>
  ),
  quickBuyTemplate: (
    <>
      The text a quick buy&rsquo;s post is prepared from, as an auction&rsquo;s is from its own. A
      quick buy has a price and no bidding: the first buyer to claim it takes it. It is never written
      from the auction template, nor an auction from this one.
    </>
  ),
  standingNote: (
    <>
      How you ship, how buyers pay, and the group&rsquo;s own terms, as written. A post carries it
      where its template puts <code>{"{terms}"}</code>, and only there.
    </>
  ),
  shared: "These apply to auctions and quick buys alike.",
  newAuctions:
    "What a new auction starts from. Each can be changed on the auction itself, and changing it here never changes an auction already made. Leave a field blank for no default.",
  buyerMessage:
    "What to pay, where, and what happens next — copied from a sale with Message to buyer. A sale whose offers are all from one group uses that group's message; any other sale uses Facebook's.",
  multiLot: (
    <>
      How a post holding several lots is laid out: every lot&rsquo;s text in the post&rsquo;s own text,
      or one photo per lot with the lot&rsquo;s text as that photo&rsquo;s caption — what some groups
      ask of single series or stamps offered together. Each post can choose otherwise until it is up.
      A captioned post&rsquo;s own text is shared by its lots — a heading, <code>{"{terms}"}</code>, the
      lots&rsquo; offer numbers.
    </>
  ),
  captions: (
    <>
      The text under each lot&rsquo;s photo in a captioned post, written from the template for the
      lot&rsquo;s type. A lot of several photos is joined into one, so one photo is one price.
    </>
  ),
} as const;

function money(value: number | null, currency: string | null): string {
  return value == null ? "None" : `${value.toFixed(2)}${currency ? ` ${currency}` : ""}`;
}

/** A setting's value as a sentence — what a group following Facebook shows instead of the field. */
function describeSetting(
  key: FacebookGroupSetting,
  s: FacebookPostingSettings,
  platformCurrency: string | null
): React.ReactNode {
  switch (key) {
    case "listingType":
      return OFFER_LISTING_TYPE_LABEL[s.listingType];
    case "mixedListingTypes":
      return s.mixedListingTypes ? "A post may mix auctions and quick buys" : "A post's lots share one type";
    case "multiLotLayout":
      return FACEBOOK_MULTI_LOT_LAYOUT_LABEL[s.multiLotLayout];
    case "postTemplate":
    case "quickBuyTemplate":
    case "standingNote":
    case "buyerMessageTemplate":
    case "auctionCaptionTemplate":
    case "quickBuyCaptionTemplate":
    case "captionPostTemplate": {
      const text = s[key].trim();
      return text ? <span style={{ whiteSpace: "pre-wrap" }}>{text}</span> : "None";
    }
    case "startingPrice":
      if (s.startingPriceMode === null || s.startingPriceValue == null) return "None";
      return s.startingPriceMode === "amount"
        ? money(s.startingPriceValue, platformCurrency)
        : `${s.startingPriceValue}% of catalogue value`;
    case "bidIncrement":
      return money(s.bidIncrement, platformCurrency);
    case "auctionDays":
      return s.auctionDays == null ? "None" : countLabel(s.auctionDays, "day", "days");
    case "closingTime":
      return s.closingTime ?? "None";
    case "refreshQuickBuysAfterDays":
      return s.refreshQuickBuysAfterDays == null
        ? "Never"
        : countLabel(s.refreshQuickBuysAfterDays, "day", "days");
    case "currency":
      return platformCurrency ? `The platform's, ${platformCurrency}` : "The platform's";
  }
}

/** What each template is used for, said in one line under its label (#1849), so the collector can
 *  tell the seven texts apart without opening the guide. */
const USED_WHEN = {
  postTemplate: "A post of one auction, and each auction in a post with every lot in its text",
  quickBuyTemplate: "A post of one quick buy, and each quick buy in a post with every lot in its text",
  auctionCaptionTemplate: "An auction lot's photo caption, in a post with captions",
  quickBuyCaptionTemplate: "A quick-buy lot's photo caption, in a post with captions",
  captionPostTemplate: "The text above a post with captions",
  buyerMessageTemplate: "The message to the buyer, copied from a sale with Message to buyer",
} as const;

/** How one setting is drawn in a pane: its label and the field. */
interface SlotProps {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  /** What a template is used for (#1849), one line under its label. */
  usedWhen?: string;
  /** What the label leaves out, said under the field (#1670). */
  note?: React.ReactNode;
  /** A figure in a grid: its label is the small one. */
  small?: boolean;
}

/** Facebook's pane draws a setting as its label and field; a group's as *Same as Facebook* or its
 *  own (#1661). The tabs are laid out once, for both, through this. */
type Slot = (key: FacebookGroupSetting, props: SlotProps, field: React.ReactNode) => React.ReactNode;

/**
 * The pane's settings in **tabs by case** (#1849, amending #1801's grid): each tab holds everything
 * for one case and nothing else — what is shared, auctions, quick buys, posts of several lots, the
 * buyer's message — so a template is found by what it is for. Which setting is on which tab is
 * `facebook-settings-cases.ts`. Within a tab the sections keep #1801's rule: the width beside the
 * list, two to a row, no field across the window.
 */
function FacebookSettingsTabs({
  idPrefix,
  slot,
  start,
  texts,
  setText,
  currency,
  currencyField,
  noteUnused,
  noteWarning,
  marked,
}: {
  idPrefix: string;
  slot: Slot;
  /** What each field opens with. */
  start: FacebookPostingSettings;
  texts: PostTexts;
  setText: (key: keyof PostTexts) => (value: string) => void;
  /** The currency the figures are in. */
  currency: string | null;
  currencyField: React.ReactNode;
  /** No template the pane's posts use places the note (#1689). */
  noteUnused: boolean;
  /** Said under the note when it is followed rather than the pane's own. */
  noteWarning?: React.ReactNode;
  /** The tabs holding settings of a group's own. */
  marked: ReadonlySet<FacebookSettingsCase>;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const panels: Record<FacebookSettingsCase, React.ReactNode> = {
    general: (
      <>
        <div>
          <GroupLabel hint={HINTS.shared}>Every offer</GroupLabel>
          <div style={FIGURE_GRID}>
            {slot("listingType", { label: "A new offer starts as", small: true }, (
              <ListingTypeField initial={start.listingType} />
            ))}
            {slot("currency", { label: "Currency", small: true }, currencyField)}
            <div style={{ gridColumn: "1 / -1" }}>
              {slot("mixedListingTypes", { label: "Lots of one post", small: true }, (
                <MixedListingTypesField initial={start.mixedListingTypes} />
              ))}
            </div>
          </div>
        </div>
        <div>
          {slot(
            "standingNote",
            { label: "Shipping, payment and terms", htmlFor: id("note"), hint: HINTS.standingNote },
            <StandingNoteField
              id={id("note")}
              value={texts.standingNote}
              onChange={setText("standingNote")}
              unused={noteUnused}
            />
          )}
          {noteWarning}
        </div>
      </>
    ),
    auctions: (
      <>
        {slot(
          "postTemplate",
          {
            label: "Post template",
            htmlFor: id("post-template"),
            hint: HINTS.postTemplate,
            usedWhen: USED_WHEN.postTemplate,
          },
          <PostTemplateField
            id={id("post-template")}
            listingType="auction"
            value={texts.postTemplate}
            onChange={setText("postTemplate")}
          />
        )}
        {slot(
          "auctionCaptionTemplate",
          {
            label: "Caption",
            htmlFor: id("auction-caption-template"),
            hint: HINTS.captions,
            usedWhen: USED_WHEN.auctionCaptionTemplate,
          },
          <CaptionTemplateField
            id={id("auction-caption-template")}
            role="caption"
            listingType="auction"
            value={texts.auctionCaptionTemplate}
            onChange={setText("auctionCaptionTemplate")}
          />
        )}
        <div>
          <GroupLabel hint={HINTS.newAuctions}>New auctions</GroupLabel>
          <div style={FIGURE_GRID}>
            {slot("startingPrice", { label: "Starting price", small: true }, (
              <StartingPriceField initial={start} currency={currency} />
            ))}
            {slot(
              "bidIncrement",
              { label: "Bid increment", small: true, note: currency ? `In ${currency}` : undefined },
              <BidIncrementField initial={start.bidIncrement} />
            )}
            {slot("auctionDays", { label: "Days an auction runs", small: true }, (
              <AuctionDaysField initial={start.auctionDays} />
            ))}
            {slot("closingTime", { label: "Closing time", small: true, note: "On its last day" }, (
              <ClosingTimeField initial={start.closingTime} />
            ))}
          </div>
        </div>
      </>
    ),
    "quick-buys": (
      <>
        {slot(
          "quickBuyTemplate",
          {
            label: "Post template",
            htmlFor: id("quick-buy-template"),
            hint: HINTS.quickBuyTemplate,
            usedWhen: USED_WHEN.quickBuyTemplate,
          },
          <PostTemplateField
            id={id("quick-buy-template")}
            listingType="fixed"
            value={texts.quickBuyTemplate}
            onChange={setText("quickBuyTemplate")}
          />
        )}
        {slot(
          "quickBuyCaptionTemplate",
          {
            label: "Caption",
            htmlFor: id("quick-buy-caption-template"),
            hint: HINTS.captions,
            usedWhen: USED_WHEN.quickBuyCaptionTemplate,
          },
          <CaptionTemplateField
            id={id("quick-buy-caption-template")}
            role="caption"
            listingType="fixed"
            value={texts.quickBuyCaptionTemplate}
            onChange={setText("quickBuyCaptionTemplate")}
          />
        )}
        {slot("refreshQuickBuysAfterDays", { label: REFRESH_LABEL, note: REFRESH_NOTE }, (
          <RefreshDaysField initial={start.refreshQuickBuysAfterDays} />
        ))}
      </>
    ),
    "several-lots": (
      <>
        {slot("multiLotLayout", { label: "Layout", hint: HINTS.multiLot }, (
          <MultiLotLayoutField initial={start.multiLotLayout} />
        ))}
        {slot(
          "captionPostTemplate",
          {
            label: "Captioned post text",
            htmlFor: id("caption-post-template"),
            usedWhen: USED_WHEN.captionPostTemplate,
          },
          <CaptionTemplateField
            id={id("caption-post-template")}
            role="captionPost"
            listingType="auction"
            value={texts.captionPostTemplate}
            onChange={setText("captionPostTemplate")}
          />
        )}
      </>
    ),
    "buyer-messages": slot(
      "buyerMessageTemplate",
      {
        label: "Message to buyer",
        htmlFor: id("buyer-message"),
        hint: HINTS.buyerMessage,
        usedWhen: USED_WHEN.buyerMessageTemplate,
      },
      <BuyerMessageTemplateField
        id={id("buyer-message")}
        defaultValue={start.buyerMessageTemplate}
        style={TEXTAREA_STYLE}
      />
    ),
  };
  return <CaseTabs panels={panels} marked={marked} />;
}

/** The tab shown — `&case=` — read from the address and written back without the router, as
 *  `&row=` is, so it stays while the collector moves between the defaults and the groups. Choosing a
 *  tab is not leaving the pane: the form is one, so nothing asks. */
function useFacebookCase() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const shown = parseFacebookSettingsCase(searchParams.get(FACEBOOK_CASE_PARAM));
  const choose = useCallback(
    (key: FacebookSettingsCase) => {
      const params = new URLSearchParams(window.location.search);
      // The first tab is the default, left out of the address like the others.
      if (key === FACEBOOK_SETTINGS_CASES[0].key) params.delete(FACEBOOK_CASE_PARAM);
      else params.set(FACEBOOK_CASE_PARAM, key);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname]
  );
  return { shown, choose };
}

/**
 * The tab bar and its panels. **Every panel stays mounted** and the others are only hidden: a tab is
 * grouping inside one form, and a hidden panel's fields must still reach `FormData` — a save would
 * otherwise blank what it does not show, and *unsaved* would read a tab switch as a change.
 */
function CaseTabs({
  panels,
  marked,
}: {
  panels: Record<FacebookSettingsCase, React.ReactNode>;
  marked: ReadonlySet<FacebookSettingsCase>;
}) {
  const { shown, choose } = useFacebookCase();
  return (
    <div>
      <div
        role="tablist"
        aria-label="Facebook settings"
        style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginBottom: "1.25rem" }}
      >
        {FACEBOOK_SETTINGS_CASES.map(({ key, label }) => {
          const active = key === shown;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`facebook-case-${key}`}
              aria-selected={active}
              aria-controls={`facebook-case-panel-${key}`}
              onClick={() => choose(key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: active ? 600 : 400,
                color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: "-1px",
              }}
            >
              {label}
              {marked.has(key) && <CustomMark />}
            </button>
          );
        })}
      </div>
      {FACEBOOK_SETTINGS_CASES.map(({ key }) => (
        <div
          key={key}
          role="tabpanel"
          id={`facebook-case-panel-${key}`}
          aria-labelledby={`facebook-case-${key}`}
          hidden={key !== shown}
        >
          <DetailSections>{panels[key]}</DetailSections>
        </div>
      ))}
    </div>
  );
}

/** A group's tab holding a setting of its own (#1849), so its customs can be found. */
function CustomMark() {
  return (
    <Tooltip content="Holds settings of this group's own">
      <span
        role="img"
        aria-label="Has custom settings"
        style={{
          display: "inline-block",
          width: "0.4375rem",
          height: "0.4375rem",
          borderRadius: "50%",
          background: "var(--color-accent)",
        }}
      />
    </Tooltip>
  );
}

/** A template's *used when* line (#1849), between its label and its field. */
function UsedWhen({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "block",
        margin: "0.125rem 0 0.375rem",
        fontSize: "0.75rem",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Facebook's own settings (#1661) — what every group follows unless it sets its own. The currency is
 * not one of them: it is the platform's own (#196), stated on its contact, so it is said here rather
 * than edited.
 */
function DefaultsFields({
  defaults,
  platformCurrency,
}: {
  defaults: FacebookPostingSettings;
  platformCurrency: string | null;
}) {
  // The texts the note's warning reads (#1689), held here so it answers while either is typed.
  const [texts, setTexts] = useState<PostTexts>(() => postTexts(defaults));
  const setText = (key: keyof PostTexts) => (value: string) => setTexts((t) => ({ ...t, [key]: value }));
  const slot: Slot = (key, { label, htmlFor, hint, usedWhen, note, small }, field) => (
    <div key={key}>
      {small ? (
        <span style={SMALL_LABEL}>{label}</span>
      ) : (
        <GroupLabel htmlFor={htmlFor} hint={hint}>
          {label}
        </GroupLabel>
      )}
      {usedWhen && <UsedWhen>{usedWhen}</UsedWhen>}
      {field}
      {note && <FieldNote>{note}</FieldNote>}
    </div>
  );
  return (
    <FacebookSettingsTabs
      idPrefix="facebook"
      slot={slot}
      start={defaults}
      texts={texts}
      setText={setText}
      currency={platformCurrency}
      currencyField={
        <>
          <div style={{ ...INPUT_STYLE, display: "flex", alignItems: "center", color: "var(--color-text-muted)" }}>
            {platformCurrency ?? "Not set yet"}
          </div>
          <FieldNote>The platform&rsquo;s own, set on its contact</FieldNote>
        </>
      }
      noteUnused={standingNoteUnused(texts)}
      marked={NO_CASES}
    />
  );
}

/** Facebook's own pane marks no tab: every setting there is its own. */
const NO_CASES: ReadonlySet<FacebookSettingsCase> = new Set();

/** The label a field inside a section carries — the small one the figures' grid uses. */
const SMALL_LABEL: React.CSSProperties = {
  display: "block",
  marginBottom: "0.25rem",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

const FIGURE_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0.75rem 0.5rem",
};

/**
 * One group's fields. **Every one is a named form control** (#1471) — the pane measures what is
 * unsaved off the form. Each setting either follows Facebook, shown with the value it follows, or is
 * custom for this group, with its field (#1661); the switch is the `custom` control, so turning it
 * is a change the pane sees. The name and link are the group itself, not settings, so they sit above
 * the tabs.
 */
function GroupFields({
  group,
  defaults,
  platformCurrency,
}: {
  group: FacebookGroupData | null;
  defaults: FacebookPostingSettings;
  platformCurrency: string | null;
}) {
  const [custom, setCustom] = useState<FacebookGroupSetting[]>(group?.custom ?? []);
  const [currency, setCurrency] = useState(group?.currency ?? platformCurrency ?? "");
  const own = (key: FacebookGroupSetting) => custom.includes(key);
  // What a field switched to custom starts from: the group's own value where it had one, else the
  // value it was following — so a custom setting is a change made to Facebook's, not a blank.
  const start = group
    ? effectiveFacebookGroupSettings(group, defaults)
    : { ...defaults, currency: null };
  const shownCurrency = own("currency") ? currency || null : platformCurrency;
  // The group's own texts, held here so the note's warning (#1689) reads what is typed; a followed one
  // is read from Facebook's instead.
  const [texts, setTexts] = useState<PostTexts>(() => postTexts(start));
  const setText = (key: keyof PostTexts) => (value: string) => setTexts((t) => ({ ...t, [key]: value }));
  const posting = {
    postTemplate: own("postTemplate") ? texts.postTemplate : defaults.postTemplate,
    quickBuyTemplate: own("quickBuyTemplate") ? texts.quickBuyTemplate : defaults.quickBuyTemplate,
    captionPostTemplate: own("captionPostTemplate") ? texts.captionPostTemplate : defaults.captionPostTemplate,
    standingNote: own("standingNote") ? texts.standingNote : defaults.standingNote,
  };
  const slot: Slot = (key, props, field) => (
    <FollowableSetting
      key={key}
      {...props}
      settingKey={key}
      custom={own(key)}
      onCustom={(on: boolean) => {
        setCustom((c) => (on ? [...c, key] : c.filter((k) => k !== key)));
        // A text switched to custom starts again from what it followed, as a field shown afresh would.
        if (on && isPostText(key)) setText(key)(start[key]);
      }}
      following={describeSetting(key, defaults, platformCurrency)}
    >
      {field}
    </FollowableSetting>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <DetailSections>
        <div>
          <LabelWithError htmlFor="facebook-group-name">Name</LabelWithError>
          <TextInput
            id="facebook-group-name"
            name="name"
            defaultValue={group?.name ?? ""}
            placeholder="e.g. Znaczki — aukcje"
            autoFocus={!group}
            style={INPUT_STYLE}
            {...NO_AUTOFILL}
          />
          <FieldNote>What you call it here — usually the group&rsquo;s own name.</FieldNote>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <LabelWithError htmlFor="facebook-group-url">Link</LabelWithError>
            {group && (
              <a
                href={group.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${group.name} on Facebook`}
                style={{ display: "inline-flex", color: "var(--color-text-muted)" }}
              >
                <Icon name="externalLink" size="sm" />
              </a>
            )}
          </div>
          <TextInput
            id="facebook-group-url"
            name="url"
            type="url"
            defaultValue={group?.url ?? ""}
            placeholder="https://www.facebook.com/groups/…"
            style={INPUT_STYLE}
            {...NO_AUTOFILL}
          />
        </div>
      </DetailSections>

      <FacebookSettingsTabs
        idPrefix="facebook-group"
        slot={slot}
        start={start}
        texts={texts}
        setText={setText}
        currency={shownCurrency}
        currencyField={
          <select
            name="currency"
            aria-label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            style={{ ...SETTINGS_FIELD_SELECT_STYLE, width: "100%" }}
          >
            <option value="">Choose a currency</option>
            {COMMON_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
            {/* A stored code outside the common list still reads as itself. */}
            {group?.currency && !(COMMON_CURRENCIES as readonly string[]).includes(group.currency) && (
              <option value={group.currency}>{group.currency}</option>
            )}
          </select>
        }
        noteUnused={standingNoteUnused(posting)}
        // A followed note no template here uses is said too: the note is Facebook's, the gap is this
        // group's.
        noteWarning={!own("standingNote") && standingNoteUnused(posting) ? <UnusedNote /> : undefined}
        marked={facebookCustomCases(custom)}
      />
    </div>
  );
}

/**
 * One of a group's settings (#1661): **Same as Facebook**, with the value it follows, or **Custom for
 * this group**, with its field. The switch is a checkbox named `custom` carrying the setting's key —
 * what the save reads — and switching it back drops the field, so the group keeps no value of its own.
 */
function FollowableSetting({
  label,
  htmlFor,
  hint,
  usedWhen,
  note,
  small,
  settingKey,
  custom,
  onCustom,
  following,
  children,
}: SlotProps & {
  settingKey: FacebookGroupSetting;
  custom: boolean;
  onCustom: (on: boolean) => void;
  following: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: small ? "0.25rem" : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {small ? (
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{label}</span>
          ) : (
            <GroupLabel htmlFor={custom ? htmlFor : undefined} hint={hint}>
              {label}
            </GroupLabel>
          )}
        </div>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <input
            type="checkbox"
            name="custom"
            value={settingKey}
            checked={custom}
            onChange={(e) => onCustom(e.target.checked)}
          />
          {/* A figure's half of the grid has no room for the whole phrase; its pane says it once. */}
          {small ? "Custom" : "Custom for this group"}
        </label>
      </div>
      {/* Said whether the template is followed or the group's own: it is what the template is for. */}
      {usedWhen && <UsedWhen>{usedWhen}</UsedWhen>}
      {custom ? (
        <>
          {children}
          {note && <FieldNote>{note}</FieldNote>}
        </>
      ) : (
        <div
          style={{
            ...INPUT_STYLE,
            // A followed setting can be a whole post template, so the box grows; one line of it
            // fits the shared height, level with an own setting beside it (#1751).
            ...multiLineFormControl,
            paddingTop: "0.375rem",
            paddingBottom: "0.375rem",
            display: "flex",
            gap: "0.375rem",
            alignItems: "baseline",
            background: "var(--color-bg-subtle)",
            borderStyle: "dashed",
            color: "var(--color-text-muted)",
          }}
        >
          <span style={{ flexShrink: 0 }}>Same as Facebook:</span>
          <span style={{ color: "var(--color-text-primary)", minWidth: 0 }}>{following}</span>
        </div>
      )}
    </div>
  );
}

/** A post template in a settings pane: the shared field (#1780), submitted under its type's name. */
function PostTemplateField({
  id,
  listingType,
  value,
  onChange,
}: {
  id: string;
  listingType: OfferListingType;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FacebookPostTemplateField
      id={id}
      name={listingType === "auction" ? "postTemplate" : "quickBuyTemplate"}
      listingType={listingType}
      value={value}
      onChange={onChange}
      style={POST_TEMPLATE_STYLE}
    />
  );
}

/** A captioned post's template in a settings pane (#1841): a lot's caption for its type, or the
 *  post's shared text — the shared field, submitted under its own name. */
function CaptionTemplateField({
  id,
  role,
  listingType,
  value,
  onChange,
}: {
  id: string;
  role: Exclude<FacebookTemplateRole, "post">;
  listingType: OfferListingType;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FacebookPostTemplateField
      id={id}
      name={
        role === "captionPost"
          ? "captionPostTemplate"
          : listingType === "auction"
            ? "auctionCaptionTemplate"
            : "quickBuyCaptionTemplate"
      }
      listingType={listingType}
      role={role}
      value={value}
      onChange={onChange}
      style={TEXTAREA_STYLE}
    />
  );
}

/** How a post of several lots is laid out (#1841). */
function MultiLotLayoutField({ initial }: { initial: FacebookMultiLotLayout }) {
  return (
    <select
      name="multiLotLayout"
      aria-label="Layout of a post of several lots"
      defaultValue={initial}
      style={{ ...SETTINGS_FIELD_SELECT_STYLE, width: "100%" }}
    >
      {FACEBOOK_MULTI_LOT_LAYOUTS.map((l) => (
        <option key={l} value={l}>
          {FACEBOOK_MULTI_LOT_LAYOUT_LABEL[l]}
        </option>
      ))}
    </select>
  );
}

/** How a new offer starts (#1671): an auction, or a quick buy. */
function ListingTypeField({ initial }: { initial: OfferListingType }) {
  return (
    <select
      name="listingType"
      aria-label="A new offer starts as"
      defaultValue={initial}
      style={{ ...SETTINGS_FIELD_SELECT_STYLE, width: "100%" }}
    >
      {/* Auction first: it is what every Facebook offer was before quick buys. */}
      {[...OFFER_LISTING_TYPES].reverse().map((t) => (
        <option key={t} value={t}>
          {OFFER_LISTING_TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

/** Whether one post may hold auctions and quick buys together (#1671). */
function MixedListingTypesField({ initial }: { initial: boolean }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.875rem" }}>
      <input type="checkbox" name="mixedListingTypes" defaultChecked={initial} />
      A post may mix auctions and quick buys
      <InfoHint>{HINTS.mixedListingTypes}</InfoHint>
    </label>
  );
}

/** The texts a post is written from — the templates, a captioned post's too (#1841), and the note —
 *  as a pane holds them. */
const POST_TEXT_KEYS = [
  "postTemplate",
  "quickBuyTemplate",
  "standingNote",
  "auctionCaptionTemplate",
  "quickBuyCaptionTemplate",
  "captionPostTemplate",
] as const;
type PostTexts = Pick<FacebookPostingSettings, (typeof POST_TEXT_KEYS)[number]>;

function postTexts(s: PostTexts): PostTexts {
  return {
    postTemplate: s.postTemplate,
    quickBuyTemplate: s.quickBuyTemplate,
    standingNote: s.standingNote,
    auctionCaptionTemplate: s.auctionCaptionTemplate,
    quickBuyCaptionTemplate: s.quickBuyCaptionTemplate,
    captionPostTemplate: s.captionPostTemplate,
  };
}

function isPostText(key: FacebookGroupSetting): key is keyof PostTexts {
  return (POST_TEXT_KEYS as readonly string[]).includes(key);
}

/** The note on shipping, payment and terms, and — since nothing appends it any more (#1689) — the
 *  warning that no template puts it anywhere. */
function StandingNoteField({
  id,
  value,
  onChange,
  unused,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  unused: boolean;
}) {
  return (
    <>
      <TextArea
        id={id}
        name="standingNote"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...TEXTAREA_STYLE, minHeight: "5rem" }}
        {...NO_AUTOFILL}
      />
      {unused && <UnusedNote />}
    </>
  );
}

function UnusedNote() {
  return (
    <FieldNote>
      <span style={{ color: "var(--color-warning)" }}>
        No post carries this note: no post template has <code>{"{terms}"}</code>.
      </span>
    </FieldNote>
  );
}

/** The starting price: its kind, and the figure under it once there is one — the field has half of
 *  *New auctions*' row, beside the bid increment (#1685). */
function StartingPriceField({
  initial,
  currency,
}: {
  initial: Pick<FacebookPostingSettings, "startingPriceMode" | "startingPriceValue">;
  currency: string | null;
}) {
  const [mode, setMode] = useState<FacebookStartingPriceMode | "">(initial.startingPriceMode ?? "");
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div>
        <select
          name="startingPriceMode"
          aria-label="Starting price"
          value={mode}
          onChange={(e) => setMode(e.target.value as FacebookStartingPriceMode | "")}
          style={{ ...SETTINGS_FIELD_SELECT_STYLE, width: "100%" }}
        >
          <option value="">No starting price</option>
          {/* The label above says *Starting price*; half a row has no room to say it again. */}
          <option value="amount">An amount</option>
          <option value="catalogPercent">% of catalogue value</option>
        </select>
      </div>
      {mode !== "" && (
        <div>
          <NumericInput
            key={mode}
            kind={mode === "amount" ? "amount" : "number"}
            name="startingPriceValue"
            aria-label={mode === "amount" ? "Starting price amount" : "Percentage of catalogue value"}
            defaultValue={
              initial.startingPriceMode === mode && initial.startingPriceValue != null
                ? mode === "amount"
                  ? initial.startingPriceValue.toFixed(2)
                  : String(initial.startingPriceValue)
                : ""
            }
            style={INPUT_STYLE}
          />
          <FieldNote>
            {mode === "amount"
              ? `Amount${currency ? `, in ${currency}` : ""}`
              : "Percent of the copies' catalogue value"}
          </FieldNote>
        </div>
      )}
    </div>
  );
}

function BidIncrementField({ initial }: { initial: number | null }) {
  return (
    <NumericInput
      kind="amount"
      name="bidIncrement"
      aria-label="Bid increment"
      defaultValue={initial?.toFixed(2) ?? ""}
      placeholder="—"
      style={INPUT_STYLE}
    />
  );
}

function AuctionDaysField({ initial }: { initial: number | null }) {
  return (
    <input
      name="auctionDays"
      aria-label="Days an auction runs"
      type="number"
      min={1}
      max={FACEBOOK_AUCTION_DAYS_MAX}
      step={1}
      defaultValue={initial == null ? "" : String(initial)}
      placeholder="—"
      style={INPUT_STYLE}
    />
  );
}

/** When an active quick buy needs posting again (#1718): a post a few days old is seen by nobody. */
const REFRESH_LABEL = "Refresh quick buys after (days)";
const REFRESH_NOTE = "Marks a quick buy up this long since it was posted. Empty: never";

function RefreshDaysField({ initial }: { initial: number | null }) {
  return (
    <input
      name="refreshQuickBuysAfterDays"
      aria-label={REFRESH_LABEL}
      type="number"
      min={1}
      max={REFRESH_QUICK_BUYS_DAYS_MAX}
      step={1}
      defaultValue={initial == null ? "" : String(initial)}
      placeholder="Never"
      style={INPUT_STYLE}
    />
  );
}

function ClosingTimeField({ initial }: { initial: string | null }) {
  return (
    <input
      name="closingTime"
      aria-label="Closing time"
      type="time"
      defaultValue={initial ?? ""}
      style={INPUT_STYLE}
    />
  );
}
