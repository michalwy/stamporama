"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LabelWithError } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import type {
  AllegroListingProfileData,
  AllegroListingProfileInput,
  AllegroListingProfileList,
  AllegroSellerDictionaries,
} from "@/lib/allegro-listing-profile";
import {
  ALLEGRO_HANDLING_TIMES,
  ALLEGRO_INVOICE_TYPES,
  ALLEGRO_LISTING_DURATIONS,
} from "@/lib/allegro-listing-profile-vocabulary";
import {
  createAllegroListingProfileAction,
  deleteAllegroListingProfileAction,
  getAllegroSellerDictionariesAction,
  setDefaultAllegroListingProfileAction,
  updateAllegroListingProfileAction,
} from "@/app/actions/allegro-listing-profiles";
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

// Settings → Allegro → Listing profiles (#486; ADR-0025), the page's second tab (#1475): a list
// beside the selected profile's detail, the shared shape the dictionaries use (#1471). A profile is
// built from dictionaries only a connected account can be asked for, which is why it follows the
// Account tab.
//
// What earns the room is the **detail**, where every dictionary field is a select over what the
// account actually has — nothing here can create a shipping rate set or a return policy, so
// offering a free-text id would only be offering a way to mistype one. What a profile is for, and
// where its choices come from, is behind the list's ⓘ and in the user guide (#1475).

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE, cursor: "pointer" };

/** The account's three dictionaries as the page last read them, with how that read went. */
interface Dictionaries {
  data: AllegroSellerDictionaries | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Read once when the tab opens, and again on *Refresh from Allegro* — never cached between
 * openings, so a rate set added on Allegro a minute ago is selectable here without anything having
 * to be invalidated. Read at the tab rather than per profile, so moving down the list does not ask
 * Allegro the same three questions again; and only while connected, since nothing else can answer.
 */
function useSellerDictionaries(collectionId: string, connected: boolean): Dictionaries {
  const [data, setData] = useState<AllegroSellerDictionaries | null>(null);
  const [loading, setLoading] = useState(connected);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const read = useCallback(async () => {
    const result = await getAllegroSellerDictionariesAction(collectionId);
    if (result.status === "error") {
      setError(result.message);
      setData(null);
    } else {
      setError(null);
      setData(result.dictionaries);
    }
    setLoading(false);
  }, [collectionId]);

  // Every `setState` happens after the await: the loading flag is the *initial* state rather than
  // something set on mount, which keeps this one render instead of two.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    getAllegroSellerDictionariesAction(collectionId)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "error") setError(result.message);
        else setData(result.dictionaries);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId, connected]);

  return {
    data,
    loading,
    error,
    refresh: () => {
      setLoading(true);
      startTransition(read);
    },
  };
}

/** A select whose stored value is not among the live options — because Allegro could not be read, or
 *  because the rate set has since been deleted there — still shows what the profile points at,
 *  rather than silently resetting itself to the first option. */
function withStored(
  options: { id: string; name: string }[],
  storedId: string | null,
  storedName: string | null
): { id: string; name: string }[] {
  if (!storedId || options.some((o) => o.id === storedId)) return options;
  return [{ id: storedId, name: storedName ?? `${storedId} (not in your account)` }, ...options];
}

/** The options each dictionary select offers for one profile — the live list plus what it holds. */
function profileOptions(
  dictionaries: AllegroSellerDictionaries | null,
  profile: AllegroListingProfileData | null
) {
  return {
    shippingRates: withStored(
      dictionaries?.shippingRates ?? [],
      profile?.shippingRatesId ?? null,
      profile?.shippingRatesName ?? null
    ),
    returnPolicies: withStored(
      dictionaries?.returnPolicies ?? [],
      profile?.returnPolicyId ?? null,
      profile?.returnPolicyName ?? null
    ),
    impliedWarranties: withStored(
      dictionaries?.impliedWarranties ?? [],
      profile?.impliedWarrantyId ?? null,
      profile?.impliedWarrantyName ?? null
    ),
  };
}

/**
 * What the pane's form saves. The snapshot names travel with the ids, read off the very lists the
 * collector picked from — they are a label for a screen, never what gets published.
 */
function profileInput(
  fd: FormData,
  options: ReturnType<typeof profileOptions>
): AllegroListingProfileInput {
  const text = (key: string) => String(fd.get(key) ?? "");
  const nameOf = (list: { id: string; name: string }[], id: string) =>
    id ? (list.find((o) => o.id === id)?.name ?? null) : null;
  const shippingRatesId = text("shippingRatesId");
  const returnPolicyId = text("returnPolicyId");
  const impliedWarrantyId = text("impliedWarrantyId");
  return {
    name: text("name"),
    shippingRatesId,
    shippingRatesName: nameOf(options.shippingRates, shippingRatesId),
    handlingTime: text("handlingTime"),
    durationLimit: text("durationLimit") || null,
    autoRepublish: fd.get("autoRepublish") === "on",
    returnPolicyId: returnPolicyId || null,
    returnPolicyName: nameOf(options.returnPolicies, returnPolicyId),
    impliedWarrantyId: impliedWarrantyId || null,
    impliedWarrantyName: nameOf(options.impliedWarranties, impliedWarrantyId),
    locationCountryCode: text("locationCountryCode"),
    locationCity: text("locationCity"),
    locationPostCode: text("locationPostCode"),
    invoiceType: text("invoiceType"),
  };
}

export function AllegroProfilesPanel({
  collectionId,
  list,
  connected,
  noPlatform,
}: {
  collectionId: string;
  list: AllegroListingProfileList;
  /** Whether the account is connected. A profile is built from the account's dictionaries, so a new
   *  one waits for the connection; an existing one can still be edited, its selects holding what it
   *  already points at. */
  connected: boolean;
  /** What the tab says while no platform is Allegro. */
  noPlatform: React.ReactNode;
}) {
  if (!list.platformId) return <>{noPlatform}</>;
  return <ProfilesListDetail collectionId={collectionId} list={list} connected={connected} />;
}

function ProfilesListDetail({
  collectionId,
  list,
  connected,
}: {
  collectionId: string;
  list: AllegroListingProfileList;
  connected: boolean;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const sel = useListSelection(list.profiles);
  const current = sel.current;
  const dictionaries = useSellerDictionaries(collectionId, connected);
  const [notice, setNotice] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [isSettingDefault, startDefault] = useTransition();

  function makeDefault(profile: AllegroListingProfileData) {
    setDefaultError(null);
    startDefault(async () => {
      const result = await setDefaultAllegroListingProfileAction(profile.id);
      if (result.status === "success") refresh();
      else setDefaultError(result.message);
    });
  }

  const options = profileOptions(dictionaries.data, current);

  return (
    <>
      <AddRowAction
        label="Add profile"
        onAdd={() => {
          setNotice(null);
          sel.startAdding();
        }}
        disabledHint={
          connected
            ? undefined
            : "Connect your Allegro account on the Account tab first — a profile is built from its shipping rates and after-sales services."
        }
      />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.profiles.length, "profile", "profiles")}
            hint={
              <>
                What every listing on {list.platformName} is published with beyond the offer itself:
                shipping rates, handling time, returns, warranty and where the parcel is sent from.
                The radio picks the default — what a listing goes out with unless its offer names
                another.
              </>
            }
            error={defaultError}
            empty={
              list.profiles.length === 0 &&
              "No profiles yet. Publishing to Allegro needs one."
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
                        name={`default-allegro-profile-${collectionId}`}
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
                const input = profileInput(fd, options);
                return current
                  ? updateAllegroListingProfileAction(current.id, input)
                  : createAllegroListingProfileAction(collectionId, input);
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
                            ? "This is the default, so the platform will have none until you set another — publishing needs one."
                            : "Listings already published are unaffected: Allegro holds their settings from the moment they went out."}
                        </>
                      ),
                      run: async () => {
                        const result = await deleteAllegroListingProfileAction(current.id);
                        // The released offers are named only when there are any: an offer falling
                        // back to the default is a change worth stating, and a zero on every
                        // ordinary delete would bury the one time it matters.
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
              <ProfileFields profile={current} options={options} dictionaries={dictionaries} />
            </DetailForm>
          ) : (
            <DetailPlaceholder>
              {connected
                ? "No profiles yet. Add one to start the list."
                : "No profiles yet. Connect your Allegro account on the Account tab, then add one."}
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

/**
 * One profile's fields. **Every one is a named form control** (#1471) — the pane measures what is
 * unsaved off the form, and the save reads it the same way. The selects are never disabled while
 * Allegro is being read: a disabled control is left out of the form, so the pane would measure a
 * change the moment the read finished.
 */
function ProfileFields({
  profile,
  options,
  dictionaries,
}: {
  profile: AllegroListingProfileData | null;
  options: ReturnType<typeof profileOptions>;
  dictionaries: Dictionaries;
}) {
  const { loading } = dictionaries;
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="profile-name">Name</LabelWithError>
        <TextInput
          id="profile-name"
          name="name"
          defaultValue={profile?.name ?? ""}
          placeholder="e.g. Home, letter rates"
          autoFocus={!profile}
          style={INPUT_STYLE}
          {...NO_AUTOFILL}
        />
        <FieldNote>Yours alone — Allegro never sees it.</FieldNote>
      </div>

      {dictionaries.error && (
        <p style={{ ...helpTextStyle, margin: 0, color: "var(--color-error)" }}>
          {dictionaries.error} The selects show what this profile already points at.
        </p>
      )}

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <LabelWithError htmlFor="profile-shipping-rates">Shipping rate set</LabelWithError>
          <InfoHint>
            The shipping rate sets and after-sales services are defined in your Allegro account and
            only there; this reads them and lets you pick. Which one you picked is checked against
            Allegro when a listing is published.
          </InfoHint>
        </div>
        <select
          id="profile-shipping-rates"
          name="shippingRatesId"
          defaultValue={profile?.shippingRatesId ?? ""}
          style={SELECT_STYLE}
        >
          <option value="">{loading ? "Reading your account…" : "— pick one —"}</option>
          {options.shippingRates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rate.name}
            </option>
          ))}
        </select>
        {!loading && dictionaries.data && dictionaries.data.shippingRates.length === 0 && (
          <FieldNote>
            Your Allegro account has none — create one under{" "}
            <a
              href="https://allegro.pl/moje-allegro/sprzedaz/ustawienia/cenniki-dostaw"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--color-accent)" }}
            >
              Delivery price lists
            </a>
            , then refresh.
          </FieldNote>
        )}
      </div>

      <div>
        <LabelWithError htmlFor="profile-handling-time">Handling time</LabelWithError>
        <select
          id="profile-handling-time"
          name="handlingTime"
          defaultValue={profile?.handlingTime ?? "PT24H"}
          style={SELECT_STYLE}
        >
          {ALLEGRO_HANDLING_TIMES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <LabelWithError htmlFor="profile-duration">Listing duration</LabelWithError>
          <InfoHint>
            Used when the Assistant fills Allegro&rsquo;s sale form (List via Assistant) —
            publishing through the API takes Allegro&rsquo;s own default. Only the durations both a
            quick buy and an auction offer are listed.
          </InfoHint>
        </div>
        <select
          id="profile-duration"
          name="durationLimit"
          defaultValue={profile?.durationLimit ?? ""}
          style={SELECT_STYLE}
        >
          <option value="">— leave as the form has it —</option>
          {ALLEGRO_LISTING_DURATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <label
        style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}
      >
        <input
          type="checkbox"
          name="autoRepublish"
          defaultChecked={profile?.autoRepublish ?? false}
          style={{ marginTop: "0.15rem", cursor: "pointer" }}
        />
        <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
          Re-list automatically when the duration runs out
          <FieldNote>Allegro charges for it again. Assistant path only.</FieldNote>
        </span>
      </label>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <LabelWithError htmlFor="profile-return-policy">Return policy</LabelWithError>
          <InfoHint>
            Allegro fills this and the implied warranty in by itself only for business accounts, so
            a private seller names them here. Leave either unset if you have none.
          </InfoHint>
        </div>
        <select
          id="profile-return-policy"
          name="returnPolicyId"
          defaultValue={profile?.returnPolicyId ?? ""}
          style={SELECT_STYLE}
        >
          <option value="">— none —</option>
          {options.returnPolicies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <LabelWithError htmlFor="profile-implied-warranty">Implied warranty</LabelWithError>
        <select
          id="profile-implied-warranty"
          name="impliedWarrantyId"
          defaultValue={profile?.impliedWarrantyId ?? ""}
          style={SELECT_STYLE}
        >
          <option value="">— none —</option>
          {options.impliedWarranties.map((warranty) => (
            <option key={warranty.id} value={warranty.id}>
              {warranty.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 8rem 6rem", gap: "0.5rem" }}>
        <div>
          <LabelWithError htmlFor="profile-city">City sent from</LabelWithError>
          <TextInput
            id="profile-city"
            name="locationCity"
            defaultValue={profile?.locationCity ?? ""}
            placeholder="e.g. Kraków"
            style={INPUT_STYLE}
            {...NO_AUTOFILL}
          />
        </div>
        <div>
          <LabelWithError htmlFor="profile-post-code">Post code</LabelWithError>
          <TextInput
            id="profile-post-code"
            name="locationPostCode"
            defaultValue={profile?.locationPostCode ?? ""}
            placeholder="30-001"
            style={INPUT_STYLE}
            {...NO_AUTOFILL}
          />
        </div>
        <div>
          <LabelWithError htmlFor="profile-country">Country</LabelWithError>
          {/* Upper-cased as it is shown; the save upper-cases it too. */}
          <TextInput
            id="profile-country"
            name="locationCountryCode"
            defaultValue={profile?.locationCountryCode ?? "PL"}
            maxLength={2}
            placeholder="PL"
            style={{ ...INPUT_STYLE, textTransform: "uppercase" }}
            {...NO_AUTOFILL}
          />
        </div>
      </div>

      <div>
        <LabelWithError htmlFor="profile-invoice">Invoice</LabelWithError>
        <select
          id="profile-invoice"
          name="invoiceType"
          defaultValue={profile?.invoiceType ?? "NO_INVOICE"}
          style={SELECT_STYLE}
        >
          {ALLEGRO_INVOICE_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <button
          type="button"
          onClick={dictionaries.refresh}
          disabled={loading}
          style={secondaryButtonStyle}
        >
          Refresh from Allegro
        </button>
        <FieldNote>The lists are read from your account each time this tab opens.</FieldNote>
      </div>
    </Fields>
  );
}
