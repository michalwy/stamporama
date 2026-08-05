"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import type {
  AllegroListingProfileData,
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

// Settings → Allegro, the listing-profile half (#486; ADR-0025) — below the connection, because a
// profile is built from dictionaries only a connected account can be asked for.
//
// The list is deliberately plain: a collector has one profile, occasionally two. What earns the room
// is the **editor**, where every dictionary field is a select over what the account actually has —
// nothing here can create a shipping rate set or a return policy, so offering a free-text id would
// only be offering a way to mistype one.

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
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

type Notice = { tone: "ok" | "error"; message: string } | null;

/** The label for a stored handling time, falling back to the raw duration for a value Allegro has
 *  since renamed — a profile saved under an older vocabulary still reads as *something*. */
function handlingTimeLabel(value: string): string {
  return ALLEGRO_HANDLING_TIMES.find((h) => h.value === value)?.label ?? value;
}

/** The label for a stored duration, falling back to the raw one for the same reason the handling
 *  time does. */
function durationLabel(value: string): string {
  return ALLEGRO_LISTING_DURATIONS.find((d) => d.value === value)?.label ?? value;
}

function invoiceTypeLabel(value: string): string {
  return ALLEGRO_INVOICE_TYPES.find((i) => i.value === value)?.label ?? value;
}

export function AllegroProfilesPanel({
  collectionId,
  list,
  connected,
}: {
  collectionId: string;
  list: AllegroListingProfileList;
  /** Whether the account is connected at all. A profile is built from the account's dictionaries,
   *  so an unconnected instance is told what to do rather than shown empty selects. */
  connected: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<{ profile: AllegroListingProfileData | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AllegroListingProfileData | null>(null);

  function afterWrite(message: string) {
    setNotice({ tone: "ok", message });
    router.refresh();
  }

  function makeDefault(profile: AllegroListingProfileData) {
    setNotice(null);
    startTransition(async () => {
      const result = await setDefaultAllegroListingProfileAction(profile.id);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else afterWrite(`Listings on this platform now go out with ${profile.name}.`);
    });
  }

  function remove(profile: AllegroListingProfileData) {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteAllegroListingProfileAction(profile.id);
      if (result.status === "error") {
        setNotice({ tone: "error", message: result.message });
        return;
      }
      setConfirmDelete(null);
      // The released offers are named only when there are any: an offer falling back to the
      // platform's default is a change worth stating, and a zero on every ordinary delete would
      // bury the one time it matters.
      afterWrite(
        result.offersReleased > 0
          ? `Deleted ${profile.name}. ${result.offersReleased} offer(s) fall back to the platform's default.`
          : `Deleted ${profile.name}.`
      );
    });
  }

  if (!list.platformId) {
    return (
      <p style={helpTextStyle}>
        Name which of your platforms is Allegro above, and its listing profiles will live here. A
        profile is owned by that platform — it is what its listings are published with.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={helpTextStyle}>
        What every listing on <strong>{list.platformName}</strong> is published with, beyond anything
        an offer knows about itself: which of your Allegro <strong>shipping rate sets</strong> buyers
        choose from, how quickly you send, your return policy and implied warranty, and where the
        parcel is sent from. None of it is about a stamp — it is the same for a 1918 Polish issue and
        a modern block, and it changes when you move house or add a courier.
      </p>
      <p style={helpTextStyle}>
        The shipping rate sets and after-sales services are <strong>defined in your Allegro
        account</strong> and only there; this reads them and lets you pick. One profile is the
        platform&rsquo;s <strong>default</strong> — what a listing goes out with unless its offer
        names another.
      </p>

      {!connected && (
        <p style={{ ...helpTextStyle, color: "var(--color-error)" }}>
          Connect your Allegro account above first — a profile is built from that account&rsquo;s own
          shipping rates and after-sales services, which cannot be read without it.
        </p>
      )}

      {notice && (
        <p
          style={{
            ...helpTextStyle,
            color:
              notice.tone === "error"
                ? "var(--color-error)"
                : "var(--color-success, var(--color-accent))",
          }}
        >
          {notice.message}
        </p>
      )}

      {list.profiles.length === 0 ? (
        <p style={helpTextStyle}>
          No profiles yet. Publishing to Allegro needs one — it carries the delivery, returns and
          location settings a listing cannot go out without.
        </p>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {list.profiles.map((profile, i) => (
            <div
              key={profile.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderBottom:
                  i < list.profiles.length - 1 ? "1px solid var(--color-border)" : "none",
                background: "var(--color-bg-elevated)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span
                    style={{
                      fontSize: "0.9375rem",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {profile.name}
                  </span>
                  {profile.isDefault && (
                    <span
                      style={{
                        fontSize: "0.6875rem",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        padding: "0.125rem 0.375rem",
                        borderRadius: "0.25rem",
                        color: "var(--color-success, var(--color-accent))",
                        border: "1px solid currentColor",
                      }}
                    >
                      Default
                    </span>
                  )}
                </div>
                <p style={{ ...helpTextStyle, margin: "0.25rem 0 0" }}>
                  {profile.shippingRatesName ?? "Shipping rates"} ·{" "}
                  {handlingTimeLabel(profile.handlingTime)} ·{" "}
                  {profile.durationLimit ? `${durationLabel(profile.durationLimit)} · ` : ""}
                  {profile.locationCity}{" "}
                  {profile.locationPostCode}, {profile.locationCountryCode}
                </p>
                <p style={{ ...helpTextStyle, margin: "0.125rem 0 0" }}>
                  {profile.returnPolicyName ?? "No return policy"} ·{" "}
                  {profile.impliedWarrantyName ?? "No implied warranty"} ·{" "}
                  {invoiceTypeLabel(profile.invoiceType)}
                </p>
              </div>
              <RowActionsMenu
                ariaLabel={`Actions for ${profile.name}`}
                actions={[
                  {
                    key: "edit",
                    label: "Edit",
                    icon: "✎",
                    onSelect: () => setEditing({ profile }),
                  },
                  ...(profile.isDefault
                    ? []
                    : [
                        {
                          key: "default",
                          label: "Make default",
                          icon: "★",
                          onSelect: () => makeDefault(profile),
                        },
                      ]),
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "✕",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => setConfirmDelete(profile),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setEditing({ profile: null })}
          disabled={isPending}
          style={primaryButtonStyle}
        >
          Add profile
        </button>
      </div>

      {editing && (
        <AllegroProfileDialog
          collectionId={collectionId}
          profile={editing.profile}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            afterWrite(`Saved ${name}.`);
          }}
        />
      )}

      {confirmDelete && (
        <DialogShell
          title={`Delete ${confirmDelete.name}?`}
          onClose={() => setConfirmDelete(null)}
        >
          <DialogBody>
            <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6 }}>
              Offers naming this profile fall back to the platform&rsquo;s default.{" "}
              {confirmDelete.isDefault
                ? "This is the default, so the platform will have none until you set another — publishing needs one."
                : "Listings already published are unaffected: Allegro holds their settings from the moment they went out."}
            </p>
          </DialogBody>
          <DialogActions
            actionLabel="Delete"
            variant="destructive"
            disabled={isPending}
            onCancel={() => setConfirmDelete(null)}
            onAction={() => remove(confirmDelete)}
          />
        </DialogShell>
      )}
    </div>
  );
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

function AllegroProfileDialog({
  collectionId,
  profile,
  onClose,
  onSaved,
}: {
  collectionId: string;
  profile: AllegroListingProfileData | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [dictionaries, setDictionaries] = useState<AllegroSellerDictionaries | null>(null);
  const [dictionaryError, setDictionaryError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState(profile?.name ?? "");
  const [shippingRatesId, setShippingRatesId] = useState(profile?.shippingRatesId ?? "");
  const [handlingTime, setHandlingTime] = useState(profile?.handlingTime ?? "PT24H");
  const [durationLimit, setDurationLimit] = useState(profile?.durationLimit ?? "");
  const [autoRepublish, setAutoRepublish] = useState(profile?.autoRepublish ?? false);
  const [returnPolicyId, setReturnPolicyId] = useState(profile?.returnPolicyId ?? "");
  const [impliedWarrantyId, setImpliedWarrantyId] = useState(profile?.impliedWarrantyId ?? "");
  const [countryCode, setCountryCode] = useState(profile?.locationCountryCode ?? "PL");
  const [city, setCity] = useState(profile?.locationCity ?? "");
  const [postCode, setPostCode] = useState(profile?.locationPostCode ?? "");
  const [invoiceType, setInvoiceType] = useState(profile?.invoiceType ?? "NO_INVOICE");

  const loadDictionaries = useCallback(async () => {
    setLoading(true);
    const result = await getAllegroSellerDictionariesAction(collectionId);
    if (result.status === "error") {
      setDictionaryError(result.message);
      setDictionaries(null);
    } else {
      setDictionaryError(undefined);
      setDictionaries(result.dictionaries);
    }
    setLoading(false);
  }, [collectionId]);

  // Read once when the editor opens, and again on Refresh — never cached between openings, so a rate
  // set added on Allegro a minute ago is selectable here without anything having to be invalidated.
  //
  // The read is started in the effect but every `setState` happens in its callback, after the await:
  // the loading flag is the *initial* state rather than something set on mount, which is what keeps
  // this one render instead of two.
  useEffect(() => {
    let cancelled = false;
    getAllegroSellerDictionariesAction(collectionId)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "error") setDictionaryError(result.message);
        else setDictionaries(result.dictionaries);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  const shippingRates = withStored(
    dictionaries?.shippingRates ?? [],
    profile?.shippingRatesId ?? null,
    profile?.shippingRatesName ?? null
  );
  const returnPolicies = withStored(
    dictionaries?.returnPolicies ?? [],
    profile?.returnPolicyId ?? null,
    profile?.returnPolicyName ?? null
  );
  const impliedWarranties = withStored(
    dictionaries?.impliedWarranties ?? [],
    profile?.impliedWarrantyId ?? null,
    profile?.impliedWarrantyName ?? null
  );

  function nameOf(options: { id: string; name: string }[], id: string): string | null {
    return options.find((o) => o.id === id)?.name ?? null;
  }

  function save() {
    setError(undefined);
    // The snapshot names travel with the ids, read off the very list the collector picked from —
    // they are a label for a screen, never what gets published.
    const input = {
      name,
      shippingRatesId,
      shippingRatesName: nameOf(shippingRates, shippingRatesId),
      handlingTime,
      durationLimit: durationLimit || null,
      autoRepublish,
      returnPolicyId: returnPolicyId || null,
      returnPolicyName: returnPolicyId ? nameOf(returnPolicies, returnPolicyId) : null,
      impliedWarrantyId: impliedWarrantyId || null,
      impliedWarrantyName: impliedWarrantyId ? nameOf(impliedWarranties, impliedWarrantyId) : null,
      locationCountryCode: countryCode,
      locationCity: city,
      locationPostCode: postCode,
      invoiceType,
    };
    startTransition(async () => {
      const result = profile
        ? await updateAllegroListingProfileAction(profile.id, input)
        : await createAllegroListingProfileAction(collectionId, input);
      if (result.status === "error") setError(result.message);
      else onSaved(name.trim());
    });
  }

  return (
    <DialogShell
      title={profile ? `Edit ${profile.name}` : "New listing profile"}
      onClose={onClose}
      maxWidth="36rem"
    >
      <DialogBody>
        <div style={{ display: "grid", gap: "0.875rem" }}>
          <div>
            <LabelWithError htmlFor="profile-name">Name</LabelWithError>
            <input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Home, letter rates"
              data-autofocus-select
              style={INPUT_STYLE}
              {...NO_AUTOFILL}
            />
            <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>
              Yours alone — Allegro never sees it. It is how you pick this profile on an offer.
            </p>
          </div>

          {dictionaryError && (
            <p style={{ ...helpTextStyle, color: "var(--color-error)" }}>
              {dictionaryError} The selects below show what this profile already points at; pick
              again once Allegro can be reached.
            </p>
          )}

          <div>
            <LabelWithError htmlFor="profile-shipping-rates">Shipping rate set</LabelWithError>
            <select
              id="profile-shipping-rates"
              value={shippingRatesId}
              onChange={(e) => setShippingRatesId(e.target.value)}
              disabled={loading || isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              <option value="">{loading ? "Reading your account…" : "— pick one —"}</option>
              {shippingRates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.name}
                </option>
              ))}
            </select>
            {!loading && shippingRates.length === 0 && (
              <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>
                Your Allegro account has no shipping rate sets. They can only be created there —{" "}
                <a
                  href="https://allegro.pl/moje-allegro/sprzedaz/ustawienia/cenniki-dostaw"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--color-accent)" }}
                >
                  Allegro → Sales settings → Delivery price lists
                </a>{" "}
                — then refresh below.
              </p>
            )}
          </div>

          <div>
            <LabelWithError htmlFor="profile-handling-time">Handling time</LabelWithError>
            <select
              id="profile-handling-time"
              value={handlingTime}
              onChange={(e) => setHandlingTime(e.target.value)}
              disabled={isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              {ALLEGRO_HANDLING_TIMES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <LabelWithError htmlFor="profile-duration">Listing duration</LabelWithError>
            <select
              id="profile-duration"
              value={durationLimit}
              onChange={(e) => setDurationLimit(e.target.value)}
              disabled={isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              <option value="">— leave as the form has it —</option>
              {ALLEGRO_LISTING_DURATIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p style={helpTextStyle}>
              How long a listing runs. Used when the Assistant fills Allegro&rsquo;s sale form
              (&#9889; List via Assistant) — publishing through the API takes Allegro&rsquo;s own
              default instead. Only the durations both a quick buy and an auction offer are listed.
            </p>
          </div>

          <div>
            <label
              htmlFor="profile-auto-republish"
              style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}
            >
              <input
                id="profile-auto-republish"
                type="checkbox"
                checked={autoRepublish}
                onChange={(e) => setAutoRepublish(e.target.checked)}
                disabled={isPending}
                style={{ marginTop: "0.2rem", cursor: "pointer" }}
              />
              <span>
                Re-list automatically when the duration runs out
                <span style={{ ...helpTextStyle, display: "block" }}>
                  Allegro puts the offer back up with a full set of items and charges for it again.
                  Assistant path only, like the duration above.
                </span>
              </span>
            </label>
          </div>

          <div>
            <LabelWithError htmlFor="profile-return-policy">Return policy</LabelWithError>
            <select
              id="profile-return-policy"
              value={returnPolicyId}
              onChange={(e) => setReturnPolicyId(e.target.value)}
              disabled={loading || isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              <option value="">— none —</option>
              {returnPolicies.map((policy) => (
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
              value={impliedWarrantyId}
              onChange={(e) => setImpliedWarrantyId(e.target.value)}
              disabled={loading || isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
            >
              <option value="">— none —</option>
              {impliedWarranties.map((warranty) => (
                <option key={warranty.id} value={warranty.id}>
                  {warranty.name}
                </option>
              ))}
            </select>
            <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>
              Allegro fills these in by itself only for business accounts, so a private seller has to
              name them. Both are defined in your Allegro account; leave either unset if you have
              none.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 8rem 6rem", gap: "0.5rem" }}>
            <div>
              <LabelWithError htmlFor="profile-city">City sent from</LabelWithError>
              <input
                id="profile-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Kraków"
                style={INPUT_STYLE}
                {...NO_AUTOFILL}
              />
            </div>
            <div>
              <LabelWithError htmlFor="profile-post-code">Post code</LabelWithError>
              <input
                id="profile-post-code"
                value={postCode}
                onChange={(e) => setPostCode(e.target.value)}
                placeholder="30-001"
                style={INPUT_STYLE}
                {...NO_AUTOFILL}
              />
            </div>
            <div>
              <LabelWithError htmlFor="profile-country">Country</LabelWithError>
              <input
                id="profile-country"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="PL"
                style={INPUT_STYLE}
                {...NO_AUTOFILL}
              />
            </div>
          </div>

          <div>
            <LabelWithError htmlFor="profile-invoice">Invoice</LabelWithError>
            <select
              id="profile-invoice"
              value={invoiceType}
              onChange={(e) => setInvoiceType(e.target.value)}
              disabled={isPending}
              style={{ ...INPUT_STYLE, cursor: "pointer" }}
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
              onClick={() => startTransition(loadDictionaries)}
              disabled={loading || isPending}
              style={secondaryButtonStyle}
            >
              Refresh from Allegro
            </button>
            <p style={{ ...helpTextStyle, marginTop: "0.375rem" }}>
              Nothing here is remembered between openings — the lists are read from your account each
              time. What is saved is which one you picked, and that is checked against Allegro when a
              listing is actually published, not now.
            </p>
          </div>
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={profile ? "Save" : "Create profile"}
        disabled={isPending || !name.trim() || !shippingRatesId || !city.trim() || !postCode.trim()}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={save}
      />
    </DialogShell>
  );
}
