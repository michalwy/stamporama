"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  disconnectAllegroAction,
  pollAllegroDeviceFlowAction,
  saveAllegroCredentialsAction,
  startAllegroCodeFlowAction,
  startAllegroDeviceFlowAction,
  testAllegroConnectionAction,
} from "@/app/actions/allegro";
import type { AllegroConnectionStatus, AllegroDevicePrompt } from "@/lib/allegro-connection";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { SettingsFieldCard } from "./settings-field-grid";
import { FieldNote, InfoHint } from "./list-detail";
import { ALLEGRO_CONNECTION_WORDS, allegroConnectionState } from "./allegro-summary";
import { formControl } from "@/app/control-style";

// Settings → Allegro → Account (#476; ADR-0023), the page's first tab (#1475).
//
// Self-hosting is what makes this a setup step at all: no OAuth application can ship in a public
// image, so each instance registers its own at `apps.developer.allegro.pl` and the credentials are
// something the collector enters here. The explanation of that lives behind the ⓘ and in the user
// guide (#1475, following #1430): the tab keeps one line pointing at where to register, and the
// sentences that prevent a costly mistake — the missing secret key, a change of application
// dropping the connection — beside what they are about.
//
// Two cards of the grid (ADR-0059 §5): the registered **application**, and the **connection** made
// with it. **Device code leads.** It needs no redirect URI and no public address, so it behaves
// identically on localhost and on a VPS behind NAT. The authorization code flow sits beside it,
// offered — never instead of it — and only where the instance has a configured address to send
// Allegro back to.

/** Two cards to a row on a desktop window, and never so wide that a field runs across it. */
const ACCOUNT_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(24rem, 1fr))",
  gap: "1.25rem",
  alignItems: "stretch",
  maxWidth: "76rem",
};

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
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
  padding: "0.5rem 1rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  cursor: "pointer",
};

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  marginBottom: "0.25rem",
};

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.8125rem",
  padding: "0.125rem 0.375rem",
  borderRadius: "0.25rem",
  background: "var(--color-bg-subtle, var(--color-bg-elevated))",
  border: "1px solid var(--color-border)",
  wordBreak: "break-all",
};

/**
 * What Allegro's scope strings mean, in the collector's own words (#485).
 *
 * A label per scope this app has a reason to name, and the raw string for everything else: an
 * application registered for something Stamporama never asks about is a perfectly ordinary thing,
 * and hiding it would make the list disagree with what the collector ticked on Allegro.
 */
const SCOPE_LABELS: Record<string, string> = {
  "allegro:api:sale:offers:read": "Read your offers",
  "allegro:api:sale:offers:write": "Create and edit your offers",
  "allegro:api:orders:read": "Read your orders",
  "allegro:api:profile:read": "Read your account profile",
  "allegro:api:sale:settings:read": "Read your sale settings",
  "allegro:api:sale:settings:write": "Change your sale settings",
  "allegro:api:billing:read": "Read your billing",
  "allegro:api:payments:read": "Read your payments",
  "allegro:api:payments:write": "Issue refunds",
  "allegro:api:disputes": "Handle disputes",
  "allegro:api:ratings": "Handle ratings",
  "allegro:api:bids": "Bid on offers",
  "allegro:api:messaging": "Read and send Allegro messages",
};

/** Nothing to subscribe to — the "store" is *am I in the browser yet*, which changes exactly once
 *  and is stated by the server/client snapshot pair below. Module-scope so the reference is stable
 *  across renders. */
const NEVER_CHANGES = () => () => {};

/**
 * A token timestamp in the collector's own zone — **after mount only**.
 *
 * This panel is handed its status by the server, so it renders on the server too, where the only
 * clock is the container's. `toLocaleString()` there produced one string and a different one in the
 * browser: the same instant, written in two time zones, which is a hydration mismatch. The date is
 * therefore withheld until mount rather than formatted in UTC — the useful reading of "expires at"
 * is the collector's own wall clock, and the browser is the only place that knows it.
 */
function useLocalTimestamp(iso: string | null): string {
  const mounted = useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false
  );
  if (!mounted) return "…";
  return iso ? new Date(iso).toLocaleString() : "never";
}

type Notice = { tone: "ok" | "error" | "info"; message: string } | null;

export function AllegroConnectionPanel({
  collectionId,
  status,
}: {
  collectionId: string;
  status: AllegroConnectionStatus;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const lastRefreshedAt = useLocalTimestamp(status.lastRefreshedAt);
  const expiresAt = useLocalTimestamp(status.expiresAt);

  const [clientId, setClientId] = useState(status.clientId ?? "");
  const [applicationName, setApplicationName] = useState(status.applicationName ?? "");
  // Never seeded from the server: the secret does not cross to the browser, so a blank field means
  // "keep what is stored" rather than "clear it".
  const [clientSecret, setClientSecret] = useState("");
  const [sandbox, setSandbox] = useState(status.sandbox);
  // The code flow lands back here with its outcome in the query. It is read **once, into the
  // initial state**, and then stripped from the URL — so the message survives the strip, and a
  // reload minutes later does not re-announce a connection that already happened.
  const [notice, setNotice] = useState<Notice>(() => {
    const outcome = searchParams.get("allegro");
    if (!outcome) return null;
    if (outcome === "connected") return { tone: "ok", message: "Connected to Allegro." };
    return {
      tone: "error",
      message: searchParams.get("message") ?? "The Allegro sign-in could not be completed.",
    };
  });
  const [device, setDevice] = useState<AllegroDevicePrompt | null>(null);

  const strippedCallback = useRef(false);
  useEffect(() => {
    if (strippedCallback.current || !searchParams.get("allegro")) return;
    strippedCallback.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("allegro");
    params.delete("message");
    router.replace(`?${params.toString()}`, { scroll: false });
    router.refresh();
  }, [searchParams, router]);

  // Poll while a device flow is running. Allegro states its own interval and raises it on
  // `slow_down`; the server hands that back as `retryInSeconds` and this simply obeys, because
  // polling faster earns nothing but a longer wait.
  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      const result = await pollAllegroDeviceFlowAction(collectionId);
      if (cancelled) return;
      if (result.status === "waiting") {
        timer = setTimeout(tick, Math.max(result.retryInSeconds, 1) * 1000);
        return;
      }
      setDevice(null);
      if (result.status === "connected") {
        setNotice({
          tone: "ok",
          message: result.accountLogin
            ? `Connected to Allegro as ${result.accountLogin}.`
            : "Connected to Allegro.",
        });
        router.refresh();
      } else {
        setNotice({ tone: "error", message: result.message });
      }
    }

    timer = setTimeout(tick, Math.max(device.intervalSeconds, 1) * 1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [device, collectionId, router]);

  function save() {
    setNotice(null);
    startTransition(async () => {
      const result = await saveAllegroCredentialsAction(collectionId, {
        clientId,
        clientSecret,
        sandbox,
        applicationName,
      });
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else {
        setClientSecret("");
        setNotice({ tone: "ok", message: "Application saved." });
        router.refresh();
      }
    });
  }

  function connectByDevice() {
    setNotice(null);
    startTransition(async () => {
      const result = await startAllegroDeviceFlowAction(collectionId);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else {
        setDevice(result.prompt);
        setNotice({
          tone: "info",
          message: "Confirm the code on Allegro — this page is waiting for it.",
        });
      }
    });
  }

  function connectByCode() {
    setNotice(null);
    startTransition(async () => {
      const result = await startAllegroCodeFlowAction(collectionId);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      // A full navigation, not a router push: the destination is Allegro's own sign-in.
      else window.location.href = result.url;
    });
  }

  function test() {
    setNotice(null);
    startTransition(async () => {
      const result = await testAllegroConnectionAction(collectionId);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else {
        setNotice({ tone: "ok", message: result.detail });
        router.refresh();
      }
    });
  }

  function disconnect() {
    setNotice(null);
    startTransition(async () => {
      const result = await disconnectAllegroAction(collectionId);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else {
        setDevice(null);
        setNotice({
          tone: "ok",
          message:
            "Disconnected. The application stays authorized in your Allegro account until you remove it there.",
        });
        router.refresh();
      }
    });
  }

  const canConnect = status.configured && status.hasClientSecret && !device;
  const state = allegroConnectionState(status);
  const developerLink = (
    <a
      href="https://apps.developer.allegro.pl"
      target="_blank"
      rel="noreferrer"
      style={{ color: "var(--color-accent)" }}
    >
      apps.developer.allegro.pl
    </a>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* The one standing warning the tab keeps (#1475): without the key nothing here can be saved,
          and the reason is in a file rather than on the screen. */}
      {!status.secretKeyConfigured && (
        <p
          style={{
            ...helpTextStyle,
            margin: 0,
            maxWidth: "76rem",
            color: "var(--color-error)",
            border: "1px solid var(--color-error)",
            borderRadius: "0.5rem",
            padding: "0.75rem",
          }}
        >
          <strong>STAMPORAMA_SECRET_KEY is not set.</strong> Allegro credentials are stored
          encrypted, so this environment variable is required before an application can be saved.
          Generate one with <code style={codeStyle}>openssl rand -base64 32</code>, put it in your{" "}
          <code style={codeStyle}>.env</code> and restart.
        </p>
      )}

      {notice && (
        <p
          style={{
            ...helpTextStyle,
            margin: 0,
            color:
              notice.tone === "error"
                ? "var(--color-error)"
                : notice.tone === "ok"
                  ? "var(--color-success, var(--color-accent))"
                  : "var(--color-text-secondary)",
          }}
        >
          {notice.message}
        </p>
      )}

      <div style={ACCOUNT_GRID}>
        {/* --- The registered application ----------------------------------------------- */}
        <SettingsFieldCard
          label="Application"
          hint={<>Registered by you at {developerLink}.</>}
          tooltip="Stamporama is self-hosted, so it ships with no Allegro application of its own: this instance uses one you register, with the access you grant it there. Paste its ID and secret here."
        >
          <div style={{ display: "grid", gap: "0.875rem", maxWidth: "32rem" }}>
            <div>
              <label htmlFor="allegro-client-id" style={labelStyle}>
                Client ID
              </label>
              <TextInput
                id="allegro-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                style={INPUT_STYLE}
                {...NO_AUTOFILL}
              />
            </div>
            <div>
              <label htmlFor="allegro-application-name" style={labelStyle}>
                Application name
              </label>
              <TextInput
                id="allegro-application-name"
                value={applicationName}
                onChange={(e) => setApplicationName(e.target.value)}
                placeholder="Stamporama"
                style={INPUT_STYLE}
                {...NO_AUTOFILL}
              />
              <FieldNote>What you called it on Allegro — every request names it.</FieldNote>
            </div>
            <div>
              <label htmlFor="allegro-client-secret" style={labelStyle}>
                Client secret
              </label>
              <input
                id="allegro-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={status.hasClientSecret ? "•••••••• (leave blank to keep)" : ""}
                style={INPUT_STYLE}
                {...NO_AUTOFILL}
              />
              <FieldNote>Stored encrypted and never shown again.</FieldNote>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.875rem",
                color: "var(--color-text-primary)",
              }}
            >
              <input
                type="checkbox"
                checked={sandbox}
                onChange={(e) => setSandbox(e.target.checked)}
              />
              Use Allegro&rsquo;s sandbox
            </label>
            <div>
              <button
                type="button"
                onClick={save}
                disabled={isPending || !clientId.trim()}
                style={primaryButtonStyle}
              >
                Save application
              </button>
              {/* Kept beside the button: it is the one save on this tab that undoes something. */}
              {status.connected && (
                <FieldNote>
                  A different client ID or sandbox setting drops the current connection.
                </FieldNote>
              )}
            </div>
          </div>
        </SettingsFieldCard>

        {/* --- Connecting ------------------------------------------------------------------ */}
        <SettingsFieldCard
          label="Connection"
          tooltip={
            status.redirectUri
              ? "Connect with a code works on any installation: Allegro shows a short code to confirm in your own browser. Sign in on Allegro is one round trip instead, and needs the redirect URI below registered with your application."
              : "Connect with a code works on any installation: Allegro shows a short code to confirm in your own browser. Signing in on Allegro directly needs this instance to have a configured address (BETTER_AUTH_URL) for Allegro to send you back to."
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <ConnectionState
              status={status}
              state={state}
              lastRefreshedAt={lastRefreshedAt}
              expiresAt={expiresAt}
            />

            {/* --- What this connection is permitted to do (#485) ------------------------- */}
            {status.connected && (
              <div
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.5rem",
                  padding: "0.75rem",
                }}
              >
                <p
                  style={{
                    ...helpTextStyle,
                    margin: "0 0 0.5rem",
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Permissions granted to this application
                </p>

                {status.scopes ? (
                  <ul style={{ ...helpTextStyle, margin: "0 0 0.5rem", paddingLeft: "1.1rem" }}>
                    {status.scopes.map((scope) => (
                      <li key={scope}>
                        {SCOPE_LABELS[scope] ?? <code style={codeStyle}>{scope}</code>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  // Not the same as "none": the token could not be read this way, and saying the
                  // application grants nothing on that basis would be a claim with nothing behind it.
                  <p style={{ ...helpTextStyle, margin: "0 0 0.5rem" }}>
                    Stamporama cannot tell which permissions this connection carries.
                  </p>
                )}

                <p style={{ ...helpTextStyle, margin: 0 }}>
                  {status.canPublishOffers === true ? (
                    <>
                      Publishing offers from here is <strong>allowed</strong> by this application.
                    </>
                  ) : (
                    <>
                      {status.canPublishOffers === false && (
                        <>
                          <strong>Publishing offers from here is not allowed yet.</strong>{" "}
                        </>
                      )}
                      Publishing needs write access to your offers: grant it at {developerLink},
                      then <strong>reconnect here</strong>.
                    </>
                  )}
                </p>

                {/* The account's own eligibility, which is a different question from the
                    application's permissions and is why it sits under them rather than in place of
                    them (#477). Allegro's selling endpoints are open to business accounts only, and
                    nothing about that is visible until a listing is actually published — so this
                    appears the first time Allegro says it, in Allegro's own words. It is
                    deliberately not a broken connection: everything else here keeps working. */}
                {status.publishRefusedReason && (
                  <p
                    style={{
                      ...helpTextStyle,
                      margin: "0.5rem 0 0",
                      paddingTop: "0.5rem",
                      borderTop: "1px solid var(--color-border)",
                    }}
                  >
                    <strong style={{ color: "var(--color-text-secondary)" }}>
                      Allegro will not publish listings from this account through the API.
                    </strong>{" "}
                    It said: &ldquo;{status.publishRefusedReason}&rdquo;{" "}
                    <InfoHint>
                      Reading your orders and bids is unaffected — only creating a listing from here
                      is. Post those on Allegro yourself. This is re-checked whenever you reconnect
                      or change the application.
                    </InfoHint>
                  </p>
                )}
              </div>
            )}

            {device && (
              <div
                style={{
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "0.5rem",
                  padding: "0.75rem",
                }}
              >
                <p style={{ ...helpTextStyle, marginTop: 0 }}>
                  Open{" "}
                  <a
                    href={device.verificationUriComplete ?? device.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {device.verificationUri}
                  </a>{" "}
                  and enter this code:
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    fontSize: "1.5rem",
                    fontWeight: 600,
                    letterSpacing: "0.15em",
                    margin: "0.5rem 0",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {device.userCode}
                </p>
                <p style={{ ...helpTextStyle, marginBottom: 0 }}>
                  Waiting for you to confirm — this page finishes on its own. The code is good for
                  about {Math.round(device.expiresInSeconds / 60)} minutes.
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={connectByDevice}
                disabled={isPending || !canConnect}
                style={primaryButtonStyle}
              >
                {status.connected ? "Reconnect with a code" : "Connect with a code"}
              </button>
              {status.redirectUri && (
                <button
                  type="button"
                  onClick={connectByCode}
                  disabled={isPending || !canConnect}
                  style={secondaryButtonStyle}
                >
                  Sign in on Allegro instead
                </button>
              )}
              {status.connected && (
                <>
                  <button
                    type="button"
                    onClick={test}
                    disabled={isPending}
                    style={secondaryButtonStyle}
                  >
                    Test connection
                  </button>
                  <button
                    type="button"
                    onClick={disconnect}
                    disabled={isPending}
                    style={{ ...secondaryButtonStyle, color: "var(--color-error)" }}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>

            {/* Something to copy into Allegro, so it stays on the page rather than in a hint. */}
            {status.redirectUri && (
              <p style={{ ...helpTextStyle, margin: 0 }}>
                Redirect URI: <code style={codeStyle}>{status.redirectUri}</code>
              </p>
            )}
          </div>
        </SettingsFieldCard>
      </div>
    </div>
  );
}

/**
 * Where the connection stands, in the words the summary strip's tile uses (`allegro-summary.ts`) —
 * the tile flags the same two states this line reddens or leaves plain.
 */
function ConnectionState({
  status,
  state,
  lastRefreshedAt,
  expiresAt,
}: {
  status: AllegroConnectionStatus;
  state: ReturnType<typeof allegroConnectionState>;
  lastRefreshedAt: string;
  expiresAt: string;
}) {
  const words = ALLEGRO_CONNECTION_WORDS[state];
  if (state === "needs-reconnect") {
    return (
      <p style={{ ...helpTextStyle, margin: 0, color: "var(--color-error)" }}>
        <strong>{words}.</strong> {status.lastError ?? "The stored grant no longer works."}
      </p>
    );
  }
  if (state === "not-connected") {
    return (
      <p style={{ ...helpTextStyle, margin: 0 }}>
        <strong>{words}.</strong>
        {!status.configured && " Save the application first."}
      </p>
    );
  }
  return (
    <p style={{ ...helpTextStyle, margin: 0 }}>
      <strong>{words}</strong>
      {status.accountLogin ? (
        <>
          {" "}
          as <strong>{status.accountLogin}</strong>
        </>
      ) : (
        // No name is not an unknown state — it is an application without profile access, which
        // every other thing this connection is for works fine without.
        <>
          {" "}
          <InfoHint>
            The application has no profile access, so Allegro does not say which account this is.
          </InfoHint>
        </>
      )}
      {status.sandbox ? " (sandbox)" : ""}. Token last refreshed {lastRefreshedAt}; it expires{" "}
      {expiresAt} and is renewed automatically before then.
    </p>
  );
}
