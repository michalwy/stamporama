"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextArea, TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { FacebookGroupData, FacebookGroupList } from "@/lib/facebook-groups";
import {
  FACEBOOK_AUCTION_DAYS_MAX,
  FACEBOOK_POST_PLACEHOLDERS,
  unknownPostPlaceholders,
  type FacebookGroupValues,
  type FacebookStartingPriceMode,
} from "@/lib/facebook-group-rules";
import {
  createFacebookGroupAction,
  deleteFacebookGroupAction,
  setFacebookGroupArchivedAction,
  setFacebookPlatformAction,
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
 * Facebook is one platform and its groups sit under it, so the page has no tabs: a group is the one
 * thing configured here, and what a group holds is its customs — the post template, the standing
 * note, and the defaults a new auction there starts from. Groups in use are listed first and the
 * archived ones under their own heading, still editable and brought back from the pane.
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

function GroupsListDetail({ collectionId, list }: { collectionId: string; list: FacebookGroupList }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const sel = useListSelection(list.groups);
  const current = sel.current;
  const inUse = list.groups.filter((g) => g.archivedAt === null);
  const archived = list.groups.filter((g) => g.archivedAt !== null);

  const row = (group: FacebookGroupData) => (
    <ListRow key={group.id} selected={current?.id === group.id} onSelect={() => sel.select(group.id)}>
      <RowName>{group.name}</RowName>
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
                The Facebook groups you auction in on {list.platformName}. Each keeps its own customs:
                how a post there reads, the note on shipping, payment and terms, and what a new
                auction starts from. Archive a group you no longer post in; one with offers cannot be
                deleted.
              </>
            }
            empty={
              list.groups.length === 0 &&
              "No groups yet. Add the groups you auction in — an auction on Facebook is posted in one."
            }
          >
            {inUse.length > 0 && <ListRows label="Facebook groups">{inUse.map(row)}</ListRows>}
            {archived.length > 0 && (
              <>
                <ListGroupHeading first={inUse.length === 0}>Archived</ListGroupHeading>
                <ListRows label="Archived Facebook groups">{archived.map(row)}</ListRows>
              </>
            )}
          </ListPane>
        }
        detail={
          sel.adding || current ? (
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
              <GroupFields group={current} platformCurrency={list.platformCurrency} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              {list.groups.length === 0
                ? "No groups yet. Add one to start the list."
                : "Choose a group to see its settings."}
            </DetailPlaceholder>
          )
        }
      />
    </>
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

/** What the pane's form saves. */
function groupInput(fd: FormData): FacebookGroupValues {
  const text = (key: string) => String(fd.get(key) ?? "");
  const mode = text("startingPriceMode");
  return {
    name: text("name"),
    url: text("url"),
    postTemplate: text("postTemplate"),
    standingNote: text("standingNote"),
    startingPriceMode: mode === "" ? null : (mode as FacebookStartingPriceMode),
    startingPriceValue: mode === "" ? null : optionalNumber(text("startingPriceValue")),
    bidIncrement: optionalNumber(text("bidIncrement")),
    auctionDays: optionalNumber(text("auctionDays")),
    closingTime: text("closingTime") || null,
    currency: text("currency") || null,
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

/**
 * One group's fields. **Every one is a named form control** (#1471) — the pane measures what is
 * unsaved off the form. The template, the starting-price mode and the currency are held in state as
 * well, because each is read back while it is typed.
 */
function GroupFields({
  group,
  platformCurrency,
}: {
  group: FacebookGroupData | null;
  platformCurrency: string | null;
}) {
  const [template, setTemplate] = useState(group?.postTemplate ?? "");
  const [mode, setMode] = useState<FacebookStartingPriceMode | "">(group?.startingPriceMode ?? "");
  const [currency, setCurrency] = useState(group?.currency ?? "");
  const unknown = unknownPostPlaceholders(template);
  const shownCurrency = currency || platformCurrency;

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
        <GroupLabel
          htmlFor="facebook-group-template"
          hint={
            <>
              The text a post in this group is prepared from. Each placeholder is filled in from the
              auction when the post is prepared; in a post holding several lots, each lot gets its own
              line. The standing note below is added after it.
            </>
          }
        >
          Post template
        </GroupLabel>
        <TextArea
          id="facebook-group-template"
          name="postTemplate"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          style={TEXTAREA_STYLE}
          {...NO_AUTOFILL}
        />
        <FieldNote>
          Placeholders:{" "}
          {FACEBOOK_POST_PLACEHOLDERS.map((p, i) => (
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
      </div>

      <div>
        <GroupLabel
          htmlFor="facebook-group-note"
          hint="Added to every post in this group, as written — how you ship, how buyers pay, and the group's own terms."
        >
          Shipping, payment and terms
        </GroupLabel>
        <TextArea
          id="facebook-group-note"
          name="standingNote"
          defaultValue={group?.standingNote ?? ""}
          style={{ ...TEXTAREA_STYLE, minHeight: "5rem" }}
          {...NO_AUTOFILL}
        />
      </div>

      <div>
        <GroupLabel hint="What a new auction in this group starts from. Each can be changed on the auction itself, and changing it here never changes an auction already made. Leave a field blank for no default.">
          New auctions
        </GroupLabel>
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
            <FieldNote>Starting price</FieldNote>
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
                    group?.startingPriceMode === mode && group.startingPriceValue != null
                      ? mode === "amount"
                        ? group.startingPriceValue.toFixed(2)
                        : String(group.startingPriceValue)
                      : ""
                  }
                  style={INPUT_STYLE}
                />
                <FieldNote>
                  {mode === "amount"
                    ? `Amount${shownCurrency ? `, in ${shownCurrency}` : ""}`
                    : "Percent of the copies' catalogue value"}
                </FieldNote>
              </>
            )}
          </div>
          <div>
            <NumericInput
              kind="amount"
              name="bidIncrement"
              aria-label="Bid increment"
              defaultValue={group?.bidIncrement?.toFixed(2) ?? ""}
              placeholder="—"
              style={INPUT_STYLE}
            />
            <FieldNote>Bid increment{shownCurrency ? `, in ${shownCurrency}` : ""}</FieldNote>
          </div>
          <div>
            <input
              name="auctionDays"
              aria-label="Days an auction runs"
              type="number"
              min={1}
              max={FACEBOOK_AUCTION_DAYS_MAX}
              step={1}
              defaultValue={group?.auctionDays == null ? "" : String(group.auctionDays)}
              placeholder="—"
              style={INPUT_STYLE}
            />
            <FieldNote>Days an auction runs</FieldNote>
          </div>
          <div>
            <input
              name="closingTime"
              aria-label="Closing time"
              type="time"
              defaultValue={group?.closingTime ?? ""}
              style={INPUT_STYLE}
            />
            <FieldNote>Closing time, on its last day</FieldNote>
          </div>
          <div>
            <select
              name="currency"
              aria-label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              style={{ ...SETTINGS_FIELD_SELECT_STYLE, width: "100%" }}
            >
              <option value="">
                {platformCurrency ? `The platform's (${platformCurrency})` : "The platform's"}
              </option>
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
            <FieldNote>Currency</FieldNote>
          </div>
        </div>
      </div>
    </Fields>
  );
}
