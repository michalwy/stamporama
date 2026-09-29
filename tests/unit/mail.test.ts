import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  describeMailConfig,
  isSenderAddress,
  readMailConfig,
  summarizeMailConfig,
} from "../../src/lib/mail/config";
import { MAIL_MAX_ATTEMPTS, nextMailAttemptAt } from "../../src/lib/mail/retry-rules";
import { createResendProvider, RESEND_ENDPOINT, resendError } from "../../src/lib/mail/resend";
import { MailSendError, mailErrorMessage } from "../../src/lib/mail/provider";
import { mailProviderFor } from "../../src/lib/mail/select";

// Mail to the collector (#1372; ADR-0060): the deployment-time configuration, the retry schedule and
// the Resend transport. The queue itself is in the integration suite.

const RESEND = {
  STAMPORAMA_MAIL_PROVIDER: "resend",
  STAMPORAMA_RESEND_API_KEY: "re_secret",
  STAMPORAMA_RESEND_FROM: "Stamporama <stamps@example.com>",
};

describe("readMailConfig", () => {
  it("is off when no provider is named, whatever else is set", () => {
    assert.deepEqual(readMailConfig({}), { state: "off" });
    assert.deepEqual(readMailConfig({ ...RESEND, STAMPORAMA_MAIL_PROVIDER: "  " }), { state: "off" });
  });

  it("is ready with Resend's key and sender", () => {
    assert.deepEqual(readMailConfig(RESEND), {
      state: "ready",
      provider: "resend",
      apiKey: "re_secret",
      from: "Stamporama <stamps@example.com>",
    });
    assert.equal(readMailConfig({ ...RESEND, STAMPORAMA_MAIL_PROVIDER: "Resend" }).state, "ready");
  });

  it("names what is missing rather than sending with half a configuration", () => {
    const noKey = readMailConfig({ ...RESEND, STAMPORAMA_RESEND_API_KEY: "" });
    assert.equal(noKey.state, "incomplete");
    assert.match(noKey.state === "incomplete" ? noKey.problem : "", /STAMPORAMA_RESEND_API_KEY is not set/);

    const neither = readMailConfig({ STAMPORAMA_MAIL_PROVIDER: "resend" });
    assert.match(
      neither.state === "incomplete" ? neither.problem : "",
      /STAMPORAMA_RESEND_API_KEY and STAMPORAMA_RESEND_FROM are not set/
    );
  });

  it("refuses a provider it does not know and a sender that is not an address", () => {
    const unknown = readMailConfig({ ...RESEND, STAMPORAMA_MAIL_PROVIDER: "smtp" });
    assert.match(unknown.state === "incomplete" ? unknown.problem : "", /"smtp"/);
    const badFrom = readMailConfig({ ...RESEND, STAMPORAMA_RESEND_FROM: "Stamporama" });
    assert.equal(badFrom.state, "incomplete");
  });

  it("accepts both sender forms", () => {
    assert.ok(isSenderAddress("stamps@example.com"));
    assert.ok(isSenderAddress("Stamporama <stamps@example.com>"));
    assert.ok(!isSenderAddress("stamps.example.com"));
    assert.ok(!isSenderAddress("Stamporama <>"));
  });

  it("never lets the key into what Settings or the boot log say", () => {
    const config = readMailConfig(RESEND);
    assert.ok(!JSON.stringify(summarizeMailConfig(config)).includes("re_secret"));
    assert.ok(!describeMailConfig(config).includes("re_secret"));
    assert.deepEqual(summarizeMailConfig(config), {
      state: "ready",
      providerLabel: "Resend",
      from: "Stamporama <stamps@example.com>",
    });
  });
});

describe("nextMailAttemptAt", () => {
  it("retries over about an hour, then gives up", () => {
    const start = new Date("2026-09-29T06:00:00Z");
    let at = start;
    const attemptTimes = [0];
    for (let attempt = 1; ; attempt++) {
      const next = nextMailAttemptAt(attempt, at);
      if (!next) {
        assert.equal(attempt, MAIL_MAX_ATTEMPTS);
        break;
      }
      at = next;
      attemptTimes.push((at.getTime() - start.getTime()) / 60_000);
    }
    assert.deepEqual(attemptTimes, [0, 1, 5, 15, 30, 60]);
  });
});

type Answer = { status: number; body?: unknown } | Error;

function stubFetch(answer: Answer): { requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    if (answer instanceof Error) throw answer;
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { requests };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the Resend provider", () => {
  const provider = createResendProvider({ apiKey: "re_secret", from: "stamps@example.com" });

  it("posts the message with the key, the sender and the attempt's idempotency key", async () => {
    const { requests } = stubFetch({ status: 200, body: { id: "msg-1" } });
    const result = await provider.send({
      to: "collector@example.com",
      subject: "Hello",
      text: "Body",
      idempotencyKey: "mail-x-1",
    });
    assert.deepEqual(result, { id: "msg-1" });
    assert.equal(requests[0].url, RESEND_ENDPOINT);
    assert.equal(requests[0].init.method, "POST");
    const headers = requests[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer re_secret");
    assert.equal(headers["Idempotency-Key"], "mail-x-1");
    assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
      from: "stamps@example.com",
      to: ["collector@example.com"],
      subject: "Hello",
      text: "Body",
    });
  });

  it("passes Resend's own words on when it refuses", async () => {
    stubFetch({
      status: 403,
      body: { statusCode: 403, name: "validation_error", message: "The example.com domain is not verified" },
    });
    await assert.rejects(
      provider.send({ to: "a@example.com", subject: "s", text: "t" }),
      (err: unknown) =>
        err instanceof MailSendError &&
        err.status === 403 &&
        err.message === "Resend refused the message: The example.com domain is not verified."
    );
  });

  it("says so when Resend cannot be reached", async () => {
    stubFetch(new TypeError("fetch failed"));
    await assert.rejects(
      provider.send({ to: "a@example.com", subject: "s", text: "t" }),
      (err: unknown) => err instanceof MailSendError && err.status === null && /could not be reached/.test(err.message)
    );
  });

  it("falls back to the error name or the status when there is no message", () => {
    assert.equal(resendError(401, { name: "missing_api_key" }), "missing_api_key (HTTP 401).");
    assert.equal(resendError(500, null), "HTTP 500.");
    assert.equal(resendError(429, { message: "Too many requests." }), "Too many requests.");
  });
});

describe("mailProviderFor", () => {
  it("builds Resend for a ready configuration and nothing otherwise", () => {
    assert.equal(mailProviderFor(readMailConfig(RESEND))?.label, "Resend");
    assert.equal(mailProviderFor(readMailConfig({})), null);
    assert.equal(mailProviderFor(readMailConfig({ STAMPORAMA_MAIL_PROVIDER: "resend" })), null);
  });

  it("turns any failure into a sentence", () => {
    assert.equal(mailErrorMessage(new MailSendError("Refused.", 403)), "Refused.");
    assert.equal(mailErrorMessage("boom"), "The message could not be sent.");
  });
});
