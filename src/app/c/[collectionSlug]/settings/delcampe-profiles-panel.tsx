"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import type {
  DelcampeListingProfileData,
  DelcampeListingProfileList,
} from "@/lib/delcampe-listing-profile";
import {
  DELCAMPE_PROFILE_DEFAULTS,
  DELCAMPE_PROMOTION_OPTIONS,
  DELCAMPE_RENEW_DURATION_MAX,
  DELCAMPE_RENEW_TOTAL_COUNT_MAX,
  delcampeAuctionGaps,
  delcampeMinimumBidStep,
  type DelcampeListingProfileValues,
  type DelcampePromotionKey,
} from "@/lib/delcampe-listing-profile-rules";
import {
  createDelcampeListingProfileAction,
  deleteDelcampeListingProfileAction,
  setDefaultDelcampeListingProfileAction,
  updateDelcampeListingProfileAction,
} from "@/app/actions/delcampe";
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
  RowTag,
  countLabel,
  useListSelection,
} from "./list-detail";

// Settings → Delcampe → Listing profiles (#608; ADR-0034), the page's first tab (#1479): a list
// beside the selected profile's detail, the shared shape the dictionaries use (#1471) — everything
// an Easy Uploader row carries that no offer knows about itself.
//
// A collector has one profile, occasionally two — the second being the heavier lots' shipping model
// — so what earns the room is the **detail**, and the one thing worth saying beside a field in it is
// that the shipping model is a *name*: Delcampe's own list cannot be read from here, so a model
// renamed there is a rejected upload and not a fault in the export.
//
// The **auction group** (#620) is the same kind of thing said twice more. Its two counts are blank
// until typed — there were no auctions to observe, so nothing was seeded — and its closing day and
// hour are text cells written into the file verbatim, for the shipping model's reason. The pane reads
// the group back as what an auction row *would* carry, or as the sentence saying an auction cannot be
// exported yet, and the list tags a profile that cannot. What a profile is for, and the reasoning
// behind each group, is behind the ⓘ hints and in the user guide (#1479, following #1430).

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

/** Two decimals, the notation this screen reads in. The upload file writes a decimal **comma**
 *  instead — that is the export's business (#610), not this screen's. */
function money(value: number): string {
  return value.toFixed(2);
}

/** What this profile would upload an **auction** as (#620), or why it could not — the same gaps the
 *  export refuses on, read from the same function, so the panel and a refused batch cannot disagree
 *  about whether a profile is ready for auctions. */
function auctionSummary(values: {
  auctionDuration: number | null;
  auctionRenewTotalCount: number | null;
  auctionEndDay: string;
  auctionEndTime: string;
}): string {
  const gaps = delcampeAuctionGaps(values);
  if (gaps.length > 0) return `Auctions: not set up — no ${gaps.join(", no ")}`;
  const closing = [values.auctionEndDay, values.auctionEndTime].filter(Boolean).join(" ");
  return `Auctions: ${values.auctionDuration} days, up to ${values.auctionRenewTotalCount}×${
    closing ? `, closing ${closing}` : ", no closing day or hour stated"
  }`;
}

export function DelcampeProfilesPanel({
  collectionId,
  list,
  noPlatform,
}: {
  collectionId: string;
  list: DelcampeListingProfileList;
  /** What the tab says while no platform is Delcampe. */
  noPlatform: React.ReactNode;
}) {
  if (!list.platformId) return <>{noPlatform}</>;
  return <ProfilesListDetail collectionId={collectionId} list={list} />;
}

function ProfilesListDetail({
  collectionId,
  list,
}: {
  collectionId: string;
  list: DelcampeListingProfileList;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const sel = useListSelection(list.profiles);
  const current = sel.current;
  const [notice, setNotice] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [isSettingDefault, startDefault] = useTransition();

  function makeDefault(profile: DelcampeListingProfileData) {
    setDefaultError(null);
    startDefault(async () => {
      const result = await setDefaultDelcampeListingProfileAction(profile.id);
      if (result.status === "success") refresh();
      else setDefaultError(result.message);
    });
  }

  return (
    <>
      <AddRowAction
        label="Add profile"
        onAdd={() => {
          setNotice(null);
          sel.startAdding();
        }}
      />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.profiles.length, "profile", "profiles")}
            hint={
              <>
                What every listing on {list.platformName} is uploaded with beyond the offer itself:
                the shipping model, how the listing renews, the paid promotions and the bid step. The
                radio picks the default — what a listing goes up with unless its offer names another.
                A second profile is how a heavier lot gets a different shipping model.
              </>
            }
            error={defaultError}
            empty={
              list.profiles.length === 0 &&
              "No profiles yet. An upload file needs one — every row states a shipping model."
            }
          >
            {notice && <p style={{ ...helpTextStyle, margin: "0 0 0.5rem" }}>{notice}</p>}
            <ListRows label="Listing profiles">
              {list.profiles.map((profile) => (
                <ListRow
                  key={profile.id}
                  selected={current?.id === profile.id}
                  onSelect={() => sel.select(profile.id)}
                  leading={
                    <Tooltip content={profile.isDefault ? "Default profile" : "Make default"}>
                      <input
                        type="radio"
                        name={`default-delcampe-profile-${collectionId}`}
                        aria-label={`Make ${profile.name} the default profile`}
                        checked={profile.isDefault}
                        disabled={isSettingDefault || profile.isDefault}
                        onChange={() => makeDefault(profile)}
                        style={{ margin: 0 }}
                      />
                    </Tooltip>
                  }
                >
                  <RowName>{profile.name}</RowName>
                  {/* Said on the row, not only in the pane: whether a profile can upload an
                      auction at all is what somebody reading the list wants to know (#620). */}
                  {delcampeAuctionGaps(profile).length > 0 && <RowTag>No auctions</RowTag>}
                  {profile.isDefault && <RowTag tone="accent">Default</RowTag>}
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New listing profile"}
              isNew={!current}
              onSave={(fd) => {
                const input = profileInput(fd);
                return current
                  ? updateDelcampeListingProfileAction(current.id, input)
                  : createDelcampeListingProfileAction(collectionId, input);
              }}
              onSaved={() => {
                setNotice(null);
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
                          Offers naming <strong>{current.name}</strong> fall back to the
                          platform&rsquo;s default.{" "}
                          {current.isDefault
                            ? "This is the default, so the platform will have none until you set another — an upload file needs one."
                            : "Listings already uploaded are unaffected: Delcampe holds their settings from the moment the file went up."}
                        </>
                      ),
                      run: async () => {
                        const result = await deleteDelcampeListingProfileAction(current.id);
                        // The released offers are named only when there are any, so a zero on every
                        // ordinary delete does not bury the one time it matters.
                        if (result.status === "success" && result.offersReleased > 0) {
                          setNotice(
                            `Deleted ${current.name}. ${result.offersReleased} offer(s) fall back to the platform's default.`
                          );
                        }
                        return result;
                      },
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <ProfileFields profile={current} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>No profiles yet. Add one to start the list.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

/** A count field read off the form. Blank is `NaN`, so a half-typed value is not silently saved as
 *  0 — the server refuses anything that is not a whole number in range. */
function countValue(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

/** The same, for a count that may simply not have been stated (#620): empty is `null`, which is what
 *  an auction group nobody has filled in stores as. */
function optionalCountValue(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw);
}

/** What the pane's form saves. */
function profileInput(fd: FormData): DelcampeListingProfileValues {
  const text = (key: string) => String(fd.get(key) ?? "");
  const ticked = (key: string) => fd.get(key) === "on";
  return {
    name: text("name"),
    shippingModel: text("shippingModel"),
    renewDuration: countValue(text("renewDuration")),
    renewTotalCount: countValue(text("renewTotalCount")),
    hasRenewableOptions: ticked("hasRenewableOptions"),
    ...(Object.fromEntries(
      DELCAMPE_PROMOTION_OPTIONS.map((option) => [option.key, ticked(option.key)])
    ) as Record<DelcampePromotionKey, boolean>),
    minBidStepThreshold: Number(text("minBidStepThreshold")),
    minBidStepBelow: Number(text("minBidStepBelow")),
    minBidStepAtOrAbove: Number(text("minBidStepAtOrAbove")),
    // A blank auction count is `null` — not stated — rather than a zero. The two of them are the one
    // group here that is allowed to be empty: a profile that never uploads an auction is the
    // ordinary case, and the export is where an unstated duration is refused.
    auctionDuration: optionalCountValue(text("auctionDuration")),
    auctionRenewTotalCount: optionalCountValue(text("auctionRenewTotalCount")),
    auctionEndDay: text("auctionEndDay"),
    auctionEndTime: text("auctionEndTime"),
  };
}

/** A small heading over a group of fields in the pane. */
function GroupLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <LabelWithError>{children}</LabelWithError>
      {hint && <InfoHint>{hint}</InfoHint>}
    </div>
  );
}

/**
 * One profile's fields. **Every one is a named form control** (#1471) — the pane measures what is
 * unsaved off the form, and the save reads it the same way. The auction group and the bid step are
 * held in state as well, because each is read back as a sentence while it is typed.
 */
function ProfileFields({ profile }: { profile: DelcampeListingProfileData | null }) {
  // Blank until typed, which is what they are stored as: a text field holding "" is the honest
  // rendering of a figure nobody has stated, and `optionalCountValue` reads it back as one.
  const [auctionDuration, setAuctionDuration] = useState(
    profile?.auctionDuration == null ? "" : String(profile.auctionDuration)
  );
  const [auctionRenewTotalCount, setAuctionRenewTotalCount] = useState(
    profile?.auctionRenewTotalCount == null ? "" : String(profile.auctionRenewTotalCount)
  );
  const [auctionEndDay, setAuctionEndDay] = useState(profile?.auctionEndDay ?? "");
  const [auctionEndTime, setAuctionEndTime] = useState(profile?.auctionEndTime ?? "");
  const [threshold, setThreshold] = useState(
    money(profile?.minBidStepThreshold ?? DELCAMPE_PROFILE_DEFAULTS.minBidStepThreshold)
  );
  const [stepBelow, setStepBelow] = useState(
    money(profile?.minBidStepBelow ?? DELCAMPE_PROFILE_DEFAULTS.minBidStepBelow)
  );
  const [stepAtOrAbove, setStepAtOrAbove] = useState(
    money(profile?.minBidStepAtOrAbove ?? DELCAMPE_PROFILE_DEFAULTS.minBidStepAtOrAbove)
  );

  // The rule read back in the sentence it will be applied by, from the same pure function the export
  // calls — the collector confirms the *boundary*, which is the part of it nobody has been able to
  // check against Delcampe.
  const rule = {
    threshold: Number(threshold),
    below: Number(stepBelow),
    atOrAbove: Number(stepAtOrAbove),
  };
  const rulePreview =
    Number.isFinite(rule.threshold) && Number.isFinite(rule.below) && Number.isFinite(rule.atOrAbove)
      ? `A listing at ${money(rule.threshold)} states ${money(
          delcampeMinimumBidStep(rule.threshold, rule)
        )}; one a cent under it states ${money(
          delcampeMinimumBidStep(Math.max(rule.threshold - 0.01, 0), rule)
        )}.`
      : null;

  // Read back as the row it would write, or as the gaps that stop it — the same function the export
  // refuses on, so this sentence and a refused batch cannot say different things.
  const auctionGaps = delcampeAuctionGaps({
    auctionDuration: optionalCountValue(auctionDuration),
    auctionRenewTotalCount: optionalCountValue(auctionRenewTotalCount),
  });
  const auctionPreview =
    auctionGaps.length > 0
      ? `An auction offer cannot be exported with this profile yet — it does not say ${auctionGaps.join(
          " or "
        )}.`
      : auctionSummary({
          auctionDuration: optionalCountValue(auctionDuration),
          auctionRenewTotalCount: optionalCountValue(auctionRenewTotalCount),
          auctionEndDay,
          auctionEndTime,
        });

  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="delcampe-profile-name">Name</LabelWithError>
        <TextInput
          id="delcampe-profile-name"
          name="name"
          defaultValue={profile?.name ?? ""}
          placeholder="e.g. Standard letter"
          autoFocus={!profile}
          style={INPUT_STYLE}
          {...NO_AUTOFILL}
        />
        <FieldNote>Yours alone — Delcampe never sees it.</FieldNote>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <LabelWithError htmlFor="delcampe-profile-shipping-model">Shipping model</LabelWithError>
          <InfoHint>
            The upload file carries the model&rsquo;s name and nothing else, and Delcampe&rsquo;s list
            of models cannot be read from here — so a model renamed on Delcampe makes the upload fail,
            with nothing this app could have warned you about beforehand.
          </InfoHint>
        </div>
        <TextInput
          id="delcampe-profile-shipping-model"
          name="shippingModel"
          defaultValue={profile?.shippingModel ?? ""}
          placeholder="e.g. Fee template"
          style={INPUT_STYLE}
          {...NO_AUTOFILL}
        />
        {/* Kept beside the field: a misspelt name is a rejected upload (#608). */}
        <FieldNote>
          Exactly as it reads on Delcampe — renaming it there makes the upload fail.
        </FieldNote>
      </div>

      <div>
        <GroupLabel
          hint={
            <>
              28 days × 99 renewals is shop stock: a listing that stays up until it sells. These are
              what a quick-buy row carries; an auction takes its own figures below.
            </>
          }
        >
          Renewal
        </GroupLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div>
            <input
              id="delcampe-profile-renew-duration"
              name="renewDuration"
              aria-label="Days per run"
              type="number"
              min={1}
              max={DELCAMPE_RENEW_DURATION_MAX}
              step={1}
              defaultValue={String(profile?.renewDuration ?? DELCAMPE_PROFILE_DEFAULTS.renewDuration)}
              style={INPUT_STYLE}
            />
            <FieldNote>Days per run</FieldNote>
          </div>
          <div>
            <input
              id="delcampe-profile-renew-count"
              name="renewTotalCount"
              aria-label="Times it may renew"
              type="number"
              min={1}
              max={DELCAMPE_RENEW_TOTAL_COUNT_MAX}
              step={1}
              defaultValue={String(
                profile?.renewTotalCount ?? DELCAMPE_PROFILE_DEFAULTS.renewTotalCount
              )}
              style={INPUT_STYLE}
            />
            <FieldNote>Times it may renew</FieldNote>
          </div>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            marginTop: "0.5rem",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            name="hasRenewableOptions"
            defaultChecked={
              profile?.hasRenewableOptions ?? DELCAMPE_PROFILE_DEFAULTS.hasRenewableOptions
            }
            style={{ marginTop: "0.15rem", cursor: "pointer" }}
          />
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
            Re-buy the paid options on every renewal
            <FieldNote>Each renewal is charged again. Only with a promotion on.</FieldNote>
          </span>
        </label>
      </div>

      {/* ── Auctions (#620) ─────────────────────────────────────────────────────────────────
          A second duration group rather than a reinterpretation of the one above, and seeded with
          nothing: every other default here was observed on a live listing, and there are no
          auctions to observe. The line under it is the refusal said in advance. */}
      <div>
        <GroupLabel
          hint={
            <>
              An auction ends, so it is not shop stock: these replace the renewal figures on any
              offer recorded as an auction, and nothing is filled in for you. The closing day and
              hour go into the file exactly as you type them — which spelling Easy Uploader wants was
              never confirmed. Leave them blank to let Delcampe close the auction when the duration
              runs out.
            </>
          }
        >
          Auctions
        </GroupLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div>
            <input
              id="delcampe-profile-auction-duration"
              name="auctionDuration"
              aria-label="Days the auction runs"
              type="number"
              min={1}
              max={DELCAMPE_RENEW_DURATION_MAX}
              step={1}
              value={auctionDuration}
              onChange={(e) => setAuctionDuration(e.target.value)}
              placeholder="—"
              style={INPUT_STYLE}
            />
            <FieldNote>Days the auction runs</FieldNote>
          </div>
          <div>
            <input
              id="delcampe-profile-auction-renew-count"
              name="auctionRenewTotalCount"
              aria-label="Times it may run again"
              type="number"
              min={1}
              max={DELCAMPE_RENEW_TOTAL_COUNT_MAX}
              step={1}
              value={auctionRenewTotalCount}
              onChange={(e) => setAuctionRenewTotalCount(e.target.value)}
              placeholder="—"
              style={INPUT_STYLE}
            />
            <FieldNote>Times it may run again</FieldNote>
          </div>
          <div>
            <TextInput
              id="delcampe-profile-auction-end-day"
              name="auctionEndDay"
              aria-label="Closing day"
              value={auctionEndDay}
              onChange={(e) => setAuctionEndDay(e.target.value)}
              placeholder="e.g. Sunday"
              style={INPUT_STYLE}
              {...NO_AUTOFILL}
            />
            <FieldNote>
              Closing day (<code>sale_end_day</code>)
            </FieldNote>
          </div>
          <div>
            <TextInput
              id="delcampe-profile-auction-end-time"
              name="auctionEndTime"
              aria-label="Closing hour"
              value={auctionEndTime}
              onChange={(e) => setAuctionEndTime(e.target.value)}
              placeholder="e.g. 20:00"
              style={INPUT_STYLE}
              {...NO_AUTOFILL}
            />
            <FieldNote>
              Closing hour (<code>sale_end_time</code>)
            </FieldNote>
          </div>
        </div>
        <FieldNote>{auctionPreview}</FieldNote>
      </div>

      <div>
        <GroupLabel hint="Each of these costs money on Delcampe, and the upload file states a yes or a no for every one. All are off unless you turn them on.">
          Paid promotions
        </GroupLabel>
        <div style={{ display: "grid", gap: "0.25rem" }}>
          {DELCAMPE_PROMOTION_OPTIONS.map((option) => (
            <label
              key={option.key}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                name={option.key}
                defaultChecked={profile?.[option.key] ?? DELCAMPE_PROFILE_DEFAULTS[option.key]}
                style={{ cursor: "pointer" }}
              />
              <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <GroupLabel
          hint={
            <>
              Delcampe&rsquo;s listings state a bid step that changes with the price — 0.01 on cheap
              items, 0.10 on dearer ones. Where exactly it changes was never confirmed, so it is a
              setting: correct it the moment you see a listing disagree. A listing priced exactly at
              the threshold takes the larger step. In the platform&rsquo;s currency.
            </>
          }
        >
          Minimum bid step
        </GroupLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
          <div>
            <NumericInput
              kind="amount"
              id="delcampe-profile-step-below"
              name="minBidStepBelow"
              aria-label="Below the threshold"
              value={stepBelow}
              onChange={(e) => setStepBelow(e.currentTarget.value)}
              style={INPUT_STYLE}
            />
            <FieldNote>Below the threshold</FieldNote>
          </div>
          <div>
            <NumericInput
              kind="amount"
              id="delcampe-profile-threshold"
              name="minBidStepThreshold"
              aria-label="Threshold price"
              value={threshold}
              onChange={(e) => setThreshold(e.currentTarget.value)}
              style={INPUT_STYLE}
            />
            <FieldNote>Threshold price</FieldNote>
          </div>
          <div>
            <NumericInput
              kind="amount"
              id="delcampe-profile-step-above"
              name="minBidStepAtOrAbove"
              aria-label="At or above it"
              value={stepAtOrAbove}
              onChange={(e) => setStepAtOrAbove(e.currentTarget.value)}
              style={INPUT_STYLE}
            />
            <FieldNote>At or above it</FieldNote>
          </div>
        </div>
        {rulePreview && <FieldNote>{rulePreview}</FieldNote>}
      </div>
    </Fields>
  );
}
