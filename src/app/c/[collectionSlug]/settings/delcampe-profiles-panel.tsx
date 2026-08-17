"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import type {
  DelcampeListingProfileData,
  DelcampeListingProfileList,
} from "@/lib/delcampe-listing-profile";
import {
  DELCAMPE_PROFILE_DEFAULTS,
  DELCAMPE_PROMOTION_OPTIONS,
  DELCAMPE_RENEW_DURATION_MAX,
  DELCAMPE_RENEW_TOTAL_COUNT_MAX,
  countDelcampePromotions,
  delcampeMinimumBidStep,
  type DelcampePromotionKey,
} from "@/lib/delcampe-listing-profile-rules";
import {
  createDelcampeListingProfileAction,
  deleteDelcampeListingProfileAction,
  setDefaultDelcampeListingProfileAction,
  updateDelcampeListingProfileAction,
} from "@/app/actions/delcampe";

// Settings → Delcampe, the listing-profile half (#608; ADR-0034) — everything an Easy Uploader row
// carries that no offer knows about itself.
//
// The list is deliberately plain: a collector has one profile, occasionally two — the second being
// the heavier lots' shipping model. What earns the room is the **editor**, and the one thing worth
// saying loudly in it is that the shipping model is a *name*: Delcampe's own list cannot be read
// from here, so a model renamed there is a rejected upload and not a fault in the export.

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

type Notice = { tone: "ok" | "error"; message: string } | null;

/** Two decimals, the notation this screen reads in. The upload file writes a decimal **comma**
 *  instead — that is the export's business (#610), not this screen's. */
function money(value: number): string {
  return value.toFixed(2);
}

export function DelcampeProfilesPanel({
  collectionId,
  list,
}: {
  collectionId: string;
  list: DelcampeListingProfileList;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<{ profile: DelcampeListingProfileData | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DelcampeListingProfileData | null>(null);

  function afterWrite(message: string) {
    setNotice({ tone: "ok", message });
    router.refresh();
  }

  function makeDefault(profile: DelcampeListingProfileData) {
    setNotice(null);
    startTransition(async () => {
      const result = await setDefaultDelcampeListingProfileAction(profile.id);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else afterWrite(`Listings on this platform now go up with ${profile.name}.`);
    });
  }

  function remove(profile: DelcampeListingProfileData) {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteDelcampeListingProfileAction(profile.id);
      if (result.status === "error") {
        setNotice({ tone: "error", message: result.message });
        return;
      }
      setConfirmDelete(null);
      // The released offers are named only when there are any, so a zero on every ordinary delete
      // does not bury the one time it matters.
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
        Name which of your platforms is Delcampe above, and its listing profiles will live here. A
        profile is owned by that platform — it is what its upload rows are built from.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={helpTextStyle}>
        What every listing on <strong>{list.platformName}</strong> is uploaded with, beyond anything
        an offer knows about itself: which of your Delcampe <strong>shipping models</strong> the row
        names, how long and how often the listing renews itself, which of the paid promotions it
        buys, and the bid step it states. None of it is about a stamp — the title, description, price
        and quantity all come from the offer and the platform&rsquo;s templates.
      </p>
      <p style={helpTextStyle}>
        One profile is the platform&rsquo;s <strong>default</strong> — what a listing goes up with
        unless its offer names another. A second profile is how a heavier lot gets a different
        shipping model.
      </p>

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
          No profiles yet. An upload file needs one — it carries the shipping model, the renewal
          settings and the bid step every row states.
        </p>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {list.profiles.map((profile, i) => {
            const promotions = countDelcampePromotions(profile);
            return (
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
                    {profile.shippingModel} · renews every {profile.renewDuration} days, up to{" "}
                    {profile.renewTotalCount}×
                    {profile.hasRenewableOptions ? " (options re-bought)" : ""}
                  </p>
                  <p style={{ ...helpTextStyle, margin: "0.125rem 0 0" }}>
                    Bid step {money(profile.minBidStepBelow)} under{" "}
                    {money(profile.minBidStepThreshold)}, {money(profile.minBidStepAtOrAbove)} from
                    there ·{" "}
                    {promotions === 0 ? "no paid promotions" : `${promotions} paid promotion(s)`}
                  </p>
                </div>
                <RowActionsMenu
                  ariaLabel={`Actions for ${profile.name}`}
                  actions={[
                    {
                      key: "edit",
                      label: "Edit",
                      icon: "edit",
                      onSelect: () => setEditing({ profile }),
                    },
                    ...(profile.isDefault
                      ? []
                      : ([
                          {
                            key: "default",
                            label: "Make default",
                            icon: "primary",
                            onSelect: () => makeDefault(profile),
                          },
                        ] satisfies RowAction[])),
                    {
                      key: "delete",
                      label: "Delete",
                      icon: "delete",
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => setConfirmDelete(profile),
                    },
                  ]}
                />
              </div>
            );
          })}
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
        <DelcampeProfileDialog
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
        <DialogShell title={`Delete ${confirmDelete.name}?`} onClose={() => setConfirmDelete(null)}>
          <DialogBody>
            <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6 }}>
              Offers naming this profile fall back to the platform&rsquo;s default.{" "}
              {confirmDelete.isDefault
                ? "This is the default, so the platform will have none until you set another — an upload file needs one."
                : "Listings already uploaded are unaffected: Delcampe holds their settings from the moment the file went up."}
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

/** A count field held as text, so a half-typed value is not silently read as 0 while it is being
 *  edited — the server refuses anything that is not a whole number in range. */
function countValue(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

function DelcampeProfileDialog({
  collectionId,
  profile,
  onClose,
  onSaved,
}: {
  collectionId: string;
  profile: DelcampeListingProfileData | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const [name, setName] = useState(profile?.name ?? "");
  const [shippingModel, setShippingModel] = useState(profile?.shippingModel ?? "");
  const [renewDuration, setRenewDuration] = useState(
    String(profile?.renewDuration ?? DELCAMPE_PROFILE_DEFAULTS.renewDuration)
  );
  const [renewTotalCount, setRenewTotalCount] = useState(
    String(profile?.renewTotalCount ?? DELCAMPE_PROFILE_DEFAULTS.renewTotalCount)
  );
  const [hasRenewableOptions, setHasRenewableOptions] = useState(
    profile?.hasRenewableOptions ?? DELCAMPE_PROFILE_DEFAULTS.hasRenewableOptions
  );
  const [promotions, setPromotions] = useState<Record<DelcampePromotionKey, boolean>>(() =>
    Object.fromEntries(
      DELCAMPE_PROMOTION_OPTIONS.map((option) => [
        option.key,
        profile?.[option.key] ?? DELCAMPE_PROFILE_DEFAULTS[option.key],
      ])
    ) as Record<DelcampePromotionKey, boolean>
  );
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
  // will call — the collector confirms the *boundary*, which is the part of it nobody has been able
  // to check against Delcampe.
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

  function save() {
    setError(undefined);
    const input = {
      name,
      shippingModel,
      renewDuration: countValue(renewDuration),
      renewTotalCount: countValue(renewTotalCount),
      hasRenewableOptions,
      ...promotions,
      minBidStepThreshold: Number(threshold),
      minBidStepBelow: Number(stepBelow),
      minBidStepAtOrAbove: Number(stepAtOrAbove),
    };
    startTransition(async () => {
      const result = profile
        ? await updateDelcampeListingProfileAction(profile.id, input)
        : await createDelcampeListingProfileAction(collectionId, input);
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
            <LabelWithError htmlFor="delcampe-profile-name">Name</LabelWithError>
            <input
              id="delcampe-profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard letter"
              data-autofocus-select
              style={INPUT_STYLE}
              {...NO_AUTOFILL}
            />
            <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>
              Yours alone — Delcampe never sees it. It is how you pick this profile on an offer.
            </p>
          </div>

          <div>
            <LabelWithError htmlFor="delcampe-profile-shipping-model">Shipping model</LabelWithError>
            <input
              id="delcampe-profile-shipping-model"
              value={shippingModel}
              onChange={(e) => setShippingModel(e.target.value)}
              placeholder="e.g. Fee template"
              style={INPUT_STYLE}
              {...NO_AUTOFILL}
            />
            <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>
              Type the model&rsquo;s name <strong>exactly as it reads on Delcampe</strong>. The
              upload file carries the name itself and nothing else, and Delcampe&rsquo;s list of
              models cannot be read from here — so renaming one there makes the upload fail, with
              nothing this app could have warned you about beforehand.
            </p>
          </div>

          <div>
            <LabelWithError>Renewal</LabelWithError>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <input
                  id="delcampe-profile-renew-duration"
                  type="number"
                  min={1}
                  max={DELCAMPE_RENEW_DURATION_MAX}
                  step={1}
                  value={renewDuration}
                  onChange={(e) => setRenewDuration(e.target.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
                <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>Days per run</p>
              </div>
              <div>
                <input
                  id="delcampe-profile-renew-count"
                  type="number"
                  min={1}
                  max={DELCAMPE_RENEW_TOTAL_COUNT_MAX}
                  step={1}
                  value={renewTotalCount}
                  onChange={(e) => setRenewTotalCount(e.target.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
                <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>Times it may renew</p>
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
                checked={hasRenewableOptions}
                onChange={(e) => setHasRenewableOptions(e.target.checked)}
                disabled={isPending}
                style={{ marginTop: "0.2rem", cursor: "pointer" }}
              />
              <span style={{ fontSize: "0.875rem" }}>
                Re-buy the paid options on every renewal
                <span style={{ ...helpTextStyle, display: "block" }}>
                  Only meaningful while one of the promotions below is on — each renewal is charged
                  again.
                </span>
              </span>
            </label>
            <p style={{ ...helpTextStyle, marginTop: "0.375rem" }}>
              28 days × 99 renewals is shop stock: a listing that stays up until it sells. An auction
              wants a real end date instead, which is not configured here.
            </p>
          </div>

          <div>
            <LabelWithError>Paid promotions</LabelWithError>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              {DELCAMPE_PROMOTION_OPTIONS.map((option) => (
                <label
                  key={option.key}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={promotions[option.key]}
                    onChange={(e) =>
                      setPromotions((current) => ({ ...current, [option.key]: e.target.checked }))
                    }
                    disabled={isPending}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "0.875rem" }}>{option.label}</span>
                </label>
              ))}
            </div>
            <p style={{ ...helpTextStyle, marginTop: "0.375rem" }}>
              Every one of these costs money on Delcampe, and the upload file states a yes or a no
              for each. They are off unless you say otherwise.
            </p>
          </div>

          <div>
            <LabelWithError>Minimum bid step</LabelWithError>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
              <div>
                <NumericInput
                  id="delcampe-profile-step-below"
                  value={stepBelow}
                  onChange={(e) => setStepBelow(e.currentTarget.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
                <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>Below the threshold</p>
              </div>
              <div>
                <NumericInput
                  id="delcampe-profile-threshold"
                  value={threshold}
                  onChange={(e) => setThreshold(e.currentTarget.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
                <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>Threshold price</p>
              </div>
              <div>
                <NumericInput
                  id="delcampe-profile-step-above"
                  value={stepAtOrAbove}
                  onChange={(e) => setStepAtOrAbove(e.currentTarget.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
                <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>At or above it</p>
              </div>
            </div>
            {rulePreview && (
              <p style={{ ...helpTextStyle, marginTop: "0.375rem" }}>{rulePreview}</p>
            )}
            <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>
              Delcampe&rsquo;s listings state a bid step that changes with the price — 0.01 on cheap
              items, 0.10 on dearer ones. Where exactly it changes was never confirmed, so it is a
              setting: correct it here the moment you see a listing disagree. In the
              platform&rsquo;s currency.
            </p>
          </div>
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={profile ? "Save" : "Create profile"}
        disabled={isPending || !name.trim() || !shippingModel.trim()}
        cancelDisabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={save}
      />
    </DialogShell>
  );
}
