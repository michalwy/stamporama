"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { FacebookGroupData, FacebookGroupList } from "@/lib/facebook-groups";
import {
  effectiveFacebookGroupSettings,
  FACEBOOK_AUCTION_DAYS_MAX,
  facebookPostPlaceholders,
  isFacebookGroupSetting,
  retiredPostPlaceholders,
  unknownPostPlaceholders,
  usesRetiredPostPlaceholder,
  type FacebookGroupSetting,
  type FacebookGroupValues,
  type FacebookPostingSettings,
  type FacebookStartingPriceMode,
} from "@/lib/facebook-group-rules";
import { OFFER_LISTING_TYPE_LABEL, OFFER_LISTING_TYPES, type OfferListingType } from "@/lib/offer-rules";
import {
  createFacebookGroupAction,
  deleteFacebookGroupAction,
  setFacebookGroupArchivedAction,
  setFacebookPlatformAction,
  updateFacebookDefaultsAction,
  updateFacebookGroupAction,
} from "@/app/actions/facebook";
import { MarketplacePlatformSelect } from "./marketplace-platform-select";
import { SETTINGS_FIELD_SELECT_STYLE } from "./settings-field-grid";
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
  RowTag,
  countLabel,
  useListSelection,
} from "./list-detail";

/*
 * Settings → Facebook (#1543; ADR-0061): which platform is Facebook, in the page header as on every
 * marketplace page, and the **groups** under it — list beside detail, the dictionaries' shape (#1471).
 *
 * Facebook is one platform and its groups sit under it, so the page has no tabs: the groups are what
 * is configured here, and what a group holds is its customs — how a new offer there is sold, the post
 * templates for an auction and a quick buy (#1671), the standing note, and the defaults a new auction
 * there starts from. **Facebook's own row comes first** (#1661): the
 * settings every group follows, each of which a group may instead set custom for itself. Groups in
 * use are listed next and the archived ones under their own heading, still editable and brought
 * back from the pane.
 */

export function FacebookSettingsBody({
  collectionId,
  platforms,
  platformId,
  groups,
}: {
  collectionId: string;
  platforms: { id: string; name: string }[];
  platformId: string | null;
  groups: FacebookGroupList;
}) {
  return (
    <>
      <MarketplacePlatformSelect
        id="facebook-platform"
        ariaLabel="Facebook platform"
        platforms={platforms}
        selectedId={platformId}
        save={(contactId) => setFacebookPlatformAction(collectionId, contactId)}
      />
      {groups.platformId ? (
        <GroupsListDetail collectionId={collectionId} list={groups} />
      ) : (
        <NoPlatform hasPlatforms={platforms.length > 0} />
      )}
    </>
  );
}

/** What the page says before a platform is Facebook — and, with none, how to get one. */
function NoPlatform({ hasPlatforms }: { hasPlatforms: boolean }) {
  return (
    <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
      {hasPlatforms ? (
        <>
          Choose which of your platforms is Facebook at the top of this page. Your groups belong to
          that platform.
        </>
      ) : (
        <>
          This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
          under <strong>Contacts</strong>, then choose it as Facebook at the top of this page.
        </>
      )}
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
  minHeight: "8rem",
  resize: "vertical",
  fontFamily: "inherit",
  lineHeight: 1.5,
};

/** The hints the settings carry, said once for Facebook's pane and a group's alike. */
const HINTS = {
  listingType:
    "Whether a new offer here starts as an auction or a quick buy. Each offer can be changed on its own form.",
  mixedListingTypes:
    "Off, the lots of one post are all auctions or all quick buys. On, one post may hold both, each lot written from its own type's template.",
  postTemplate: (
    <>
      The text an auction&rsquo;s post is prepared from. Each placeholder is filled in from the offer
      when the post is prepared; in a post holding several lots, each lot gets its own line. The note
      on shipping, payment and terms is added after it.
    </>
  ),
  quickBuyTemplate: (
    <>
      The text a quick buy&rsquo;s post is prepared from, the same way. A quick buy is never written
      from the auction template, nor an auction from this one.
    </>
  ),
  standingNote:
    "Added to every post, as written — how you ship, how buyers pay, and the group's own terms.",
  shared: "These apply to auctions and quick buys alike.",
  newAuctions:
    "What a new auction starts from. Each can be changed on the auction itself, and changing it here never changes an auction already made. Leave a field blank for no default.",
  quickBuys:
    "A quick buy has a price and no bidding: the first buyer to claim it takes it. Its price is set on each offer.",
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
    case "postTemplate":
    case "quickBuyTemplate":
    case "standingNote": {
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
    case "currency":
      return platformCurrency ? `The platform's, ${platformCurrency}` : "The platform's";
  }
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
  return (
    <Fields>
      <div>
        <GroupLabel hint={HINTS.shared}>Every offer</GroupLabel>
        <div style={FIGURE_GRID}>
          <div>
            <span style={SMALL_LABEL}>A new offer starts as</span>
            <ListingTypeField initial={defaults.listingType} />
          </div>
          <div>
            <span style={SMALL_LABEL}>Currency</span>
            <div style={{ ...INPUT_STYLE, display: "flex", alignItems: "center", color: "var(--color-text-muted)" }}>
              {platformCurrency ?? "Not set yet"}
            </div>
            <FieldNote>The platform&rsquo;s own, set on its contact</FieldNote>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <MixedListingTypesField initial={defaults.mixedListingTypes} />
          </div>
        </div>
      </div>
      <div>
        <GroupLabel htmlFor="facebook-standing-note" hint={HINTS.standingNote}>
          Shipping, payment and terms
        </GroupLabel>
        <StandingNoteField id="facebook-standing-note" initial={defaults.standingNote} />
      </div>
      <div>
        <GroupLabel hint={HINTS.newAuctions}>New auctions</GroupLabel>
        <div style={FIGURE_GRID}>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={SMALL_LABEL}>Post template</span>
            <PostTemplateField id="facebook-post-template" listingType="auction" initial={defaults.postTemplate} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={SMALL_LABEL}>Starting price</span>
            <StartingPriceField initial={defaults} currency={platformCurrency} />
          </div>
          <div>
            <span style={SMALL_LABEL}>Bid increment</span>
            <BidIncrementField initial={defaults.bidIncrement} />
            {platformCurrency && <FieldNote>In {platformCurrency}</FieldNote>}
          </div>
          <div>
            <span style={SMALL_LABEL}>Days an auction runs</span>
            <AuctionDaysField initial={defaults.auctionDays} />
          </div>
          <div>
            <span style={SMALL_LABEL}>Closing time</span>
            <ClosingTimeField initial={defaults.closingTime} />
            <FieldNote>On its last day</FieldNote>
          </div>
        </div>
      </div>
      <div>
        <GroupLabel hint={HINTS.quickBuys}>Quick buys</GroupLabel>
        <span style={SMALL_LABEL}>Post template</span>
        <PostTemplateField id="facebook-quick-buy-template" listingType="fixed" initial={defaults.quickBuyTemplate} />
      </div>
    </Fields>
  );
}

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
 * is a change the pane sees.
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
  const setting = (key: FacebookGroupSetting) => ({
    custom: own(key),
    onCustom: (on: boolean) =>
      setCustom((c) => (on ? [...c, key] : c.filter((k) => k !== key))),
    following: describeSetting(key, defaults, platformCurrency),
    settingKey: key,
  });

  return (
    <Fields>
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

      <div>
        <GroupLabel hint={HINTS.shared}>Every offer</GroupLabel>
        <div style={FIGURE_GRID}>
          <FollowableSetting label="A new offer starts as" small {...setting("listingType")}>
            <ListingTypeField initial={start.listingType} />
          </FollowableSetting>
          <FollowableSetting label="Currency" small {...setting("currency")}>
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
          </FollowableSetting>
          <div style={{ gridColumn: "1 / -1" }}>
            <FollowableSetting label="Lots of one post" small {...setting("mixedListingTypes")}>
              <MixedListingTypesField initial={start.mixedListingTypes} />
            </FollowableSetting>
          </div>
        </div>
      </div>

      <FollowableSetting
        label="Shipping, payment and terms"
        htmlFor="facebook-group-note"
        hint={HINTS.standingNote}
        {...setting("standingNote")}
      >
        <StandingNoteField id="facebook-group-note" initial={start.standingNote} />
      </FollowableSetting>

      <div>
        <GroupLabel hint={HINTS.newAuctions}>New auctions</GroupLabel>
        <div style={FIGURE_GRID}>
          <div style={{ gridColumn: "1 / -1" }}>
            <FollowableSetting label="Post template" small {...setting("postTemplate")}>
              <PostTemplateField id="facebook-group-template" listingType="auction" initial={start.postTemplate} />
            </FollowableSetting>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <FollowableSetting label="Starting price" small {...setting("startingPrice")}>
              <StartingPriceField initial={start} currency={shownCurrency} />
            </FollowableSetting>
          </div>
          <FollowableSetting
            label="Bid increment"
            note={shownCurrency ? `In ${shownCurrency}` : undefined}
            small
            {...setting("bidIncrement")}
          >
            <BidIncrementField initial={start.bidIncrement} />
          </FollowableSetting>
          <FollowableSetting label="Days an auction runs" small {...setting("auctionDays")}>
            <AuctionDaysField initial={start.auctionDays} />
          </FollowableSetting>
          <FollowableSetting label="Closing time" note="On its last day" small {...setting("closingTime")}>
            <ClosingTimeField initial={start.closingTime} />
          </FollowableSetting>
        </div>
      </div>

      <div>
        <GroupLabel hint={HINTS.quickBuys}>Quick buys</GroupLabel>
        <FollowableSetting label="Post template" small {...setting("quickBuyTemplate")}>
          <PostTemplateField id="facebook-group-quick-buy-template" listingType="fixed" initial={start.quickBuyTemplate} />
        </FollowableSetting>
      </div>
    </Fields>
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
  note,
  small,
  settingKey,
  custom,
  onCustom,
  following,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  /** What the label leaves out, said under the field while it is the group's own (#1670). */
  note?: React.ReactNode;
  /** A figure under *New auctions*: its label is the small one the grid's fields carry. */
  small?: boolean;
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
      {custom ? (
        <>
          {children}
          {note && <FieldNote>{note}</FieldNote>}
        </>
      ) : (
        <div
          style={{
            ...INPUT_STYLE,
            minHeight: undefined,
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

/** A post template — an auction's or a quick buy's (#1671) — with its type's placeholders named under
 *  it, an unknown one called out as typed, and a retired one flagged so it is removed. */
function PostTemplateField({
  id,
  listingType,
  initial,
}: {
  id: string;
  listingType: OfferListingType;
  initial: string;
}) {
  const [template, setTemplate] = useState(initial);
  const unknown = unknownPostPlaceholders(template, listingType);
  const retired = retiredPostPlaceholders(template);
  return (
    <>
      <TextArea
        id={id}
        name={listingType === "auction" ? "postTemplate" : "quickBuyTemplate"}
        aria-label={`${OFFER_LISTING_TYPE_LABEL[listingType]} post template`}
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        style={TEXTAREA_STYLE}
        {...NO_AUTOFILL}
      />
      <FieldNote>
        Placeholders:{" "}
        {facebookPostPlaceholders(listingType).map((p, i) => (
          <span key={p.token}>
            {i > 0 && ", "}
            <code>{p.token}</code> {p.label.toLowerCase()}
          </span>
        ))}
        .
      </FieldNote>
      {unknown.length > 0 && (
        <FieldNote>
          <span style={{ color: "var(--color-warning)" }}>
            Not a placeholder, so it stays as typed: {unknown.join(", ")}.
          </span>
        </FieldNote>
      )}
      {retired.length > 0 && (
        <FieldNote>
          <span style={{ color: "var(--color-warning)" }}>
            {retired.join(", ")} is no longer offered — the catalogue numbers are in the title or
            description. Remove it; until then it is still filled in.
          </span>
        </FieldNote>
      )}
    </>
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

function StandingNoteField({ id, initial }: { id: string; initial: string }) {
  return (
    <TextArea
      id={id}
      name="standingNote"
      defaultValue={initial}
      style={{ ...TEXTAREA_STYLE, minHeight: "5rem" }}
      {...NO_AUTOFILL}
    />
  );
}

/** The starting price: its kind, and the figure beside it once there is one. */
function StartingPriceField({
  initial,
  currency,
}: {
  initial: Pick<FacebookPostingSettings, "startingPriceMode" | "startingPriceValue">;
  currency: string | null;
}) {
  const [mode, setMode] = useState<FacebookStartingPriceMode | "">(initial.startingPriceMode ?? "");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
      <div>
        <select
          name="startingPriceMode"
          aria-label="Starting price"
          value={mode}
          onChange={(e) => setMode(e.target.value as FacebookStartingPriceMode | "")}
          style={{ ...SETTINGS_FIELD_SELECT_STYLE, width: "100%" }}
        >
          <option value="">No starting price</option>
          <option value="amount">Starting price: an amount</option>
          <option value="catalogPercent">Starting price: % of catalogue value</option>
        </select>
      </div>
      <div>
        {mode !== "" && (
          <>
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
          </>
        )}
      </div>
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
