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

// Settings → Allegro, the connection half (#476; ADR-0023).
//
// Self-hosting is what makes this a setup step at all: no OAuth application can ship in a public
// image, so each instance registers its own at `apps.developer.allegro.pl` and the credentials are
// something the collector enters here. That is a real new thing to explain, and this panel is where
// it is explained rather than only in the guide.
//
// **Device code leads.** It needs no redirect URI and no public address, so it behaves identically
// on localhost and on a VPS behind NAT. The authorization code flow sits below it, offered — never
// instead of it — and only where the instance has a configured address to send Allegro back to.

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

const cardStyle: React.CSSProperties = {
  padding: "1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <p style={helpTextStyle}>
        Give this instance its own access to your Allegro account through Allegro&rsquo;s API, so
        your own offers and orders can be read here directly instead of off the page. Because
        Stamporama is self-hosted, it ships with no Allegro application of its own: register one at{" "}
        <a
          href="https://apps.developer.allegro.pl"
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--color-accent)" }}
        >
          apps.developer.allegro.pl
        </a>{" "}
        and paste its ID and secret below. Nothing is read from Allegro yet — this connects, and the
        sold-listing and order features build on it.
      </p>

      {!status.secretKeyConfigured && (
        <p
          style={{
            ...helpTextStyle,
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

      {/* --- The registered application ------------------------------------------------- */}
      <div style={cardStyle}>
        <div style={{ display: "grid", gap: "0.75rem", maxWidth: "32rem" }}>
          <div>
            <label htmlFor="allegro-client-id" style={labelStyle}>
              Client ID
            </label>
            <input
              id="allegro-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              style={INPUT_STYLE}
              {...NO_AUTOFILL}
            />
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
            <p style={{ ...helpTextStyle, marginTop: "0.25rem" }}>
              Stored encrypted and never shown again. Leave blank to keep the one already saved.
            </p>
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
          <p style={helpTextStyle}>
            A sandbox application is registered separately and has its own ID and secret. Changing
            either of these, or this toggle, drops the current connection — a token belongs to the
            application that issued it.
          </p>
          <div>
            <button
              type="button"
              onClick={save}
              disabled={isPending || !clientId.trim()}
              style={primaryButtonStyle}
            >
              Save application
            </button>
          </div>
        </div>
      </div>

      {/* --- Connecting ------------------------------------------------------------------ */}
      <div style={cardStyle}>
        <h3
          style={{
            fontSize: "0.9375rem",
            fontWeight: 600,
            margin: "0 0 0.5rem",
            color: "var(--color-text-primary)",
          }}
        >
          Connection
        </h3>

        {status.connected && !status.needsReconnect && (
          <p style={{ ...helpTextStyle, marginBottom: "0.75rem" }}>
            {status.accountLogin ? (
              <>
                Connected as <strong>{status.accountLogin}</strong>
              </>
            ) : (
              // No name is not an unknown state — it is an application without profile access,
              // which every other thing this connection is for works fine without.
              <>
                <strong>Connected</strong> (the application has no profile access, so Allegro does
                not say which account this is)
              </>
            )}
            {status.sandbox ? " (sandbox)" : ""}. Token last refreshed{" "}
            {lastRefreshedAt}; it expires {expiresAt} and is
            renewed automatically before then.
          </p>
        )}

        {status.needsReconnect && (
          <p style={{ ...helpTextStyle, color: "var(--color-error)", marginBottom: "0.75rem" }}>
            <strong>Needs reconnecting.</strong> {status.lastError ?? "The stored grant no longer works."}
          </p>
        )}

        {!status.connected && !status.needsReconnect && (
          <p style={{ ...helpTextStyle, marginBottom: "0.75rem" }}>
            Not connected yet.
          </p>
        )}

        {device && (
          <div
            style={{
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              marginBottom: "0.75rem",
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
              Waiting for you to confirm — this page finishes on its own. The code is good for about{" "}
              {Math.round(device.expiresInSeconds / 60)} minutes.
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

        {!status.configured && (
          <p style={{ ...helpTextStyle, marginTop: "0.75rem" }}>
            Save the application above first.
          </p>
        )}

        <p style={{ ...helpTextStyle, marginTop: "0.75rem" }}>
          <strong>Connect with a code</strong> works on any installation, including one with no
          address of its own: Allegro shows you a short code to confirm in your own browser.
          {status.redirectUri ? (
            <>
              {" "}
              <strong>Sign in on Allegro</strong> is one round trip instead, and needs this exact
              redirect URI registered with your application:{" "}
              <code style={codeStyle}>{status.redirectUri}</code>
            </>
          ) : (
            <>
              {" "}
              Signing in on Allegro directly is not offered here, because this instance has no
              configured address (<code style={codeStyle}>BETTER_AUTH_URL</code>) for Allegro to send
              you back to.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
