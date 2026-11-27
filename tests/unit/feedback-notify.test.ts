import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_NOTIFY_DEBOUNCE_MS,
  fireFeedbackNotification,
  notifyNewFeedback,
  resetFeedbackNotify,
} from "../../src/lib/feedback-notify";

// The notification a stored feedback report sets off (#2721): one POST to a claude.ai routine's API
// trigger. Driven with a fake `fetch` and a fake clock — nothing here reaches the network.

const TOKEN = "sk-test-token-that-must-never-be-logged";
const URL_ = "https://api.example.test/v1/claude_code/routines/trig_123/fire";
const env = { FEEDBACK_NOTIFY_URL: URL_, FEEDBACK_NOTIFY_TOKEN: TOKEN };

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: () => Promise<Response> | Response = () => new Response("{}", { status: 200 })) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { fn, calls };
}

function logger() {
  const lines: string[] = [];
  return { log: (line: string) => void lines.push(line), lines };
}

describe("feedback notification", () => {
  beforeEach(() => resetFeedbackNotify());

  it("fires the trigger once for a stored report", async () => {
    const { fn, calls } = fakeFetch();
    const outcome = await notifyNewFeedback({ env, fetch: fn, now: () => 1_000 });
    assert.deepEqual(outcome, { sent: true, status: 200 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, URL_);
    assert.equal(calls[0].init.method, "POST");
  });

  it("sends exactly an empty JSON object and the three headers", async () => {
    const { fn, calls } = fakeFetch();
    await notifyNewFeedback({ env, fetch: fn, now: () => 1_000 });
    assert.equal(calls[0].init.body, "{}");
    assert.deepEqual(calls[0].init.headers, {
      authorization: `Bearer ${TOKEN}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    assert.ok(calls[0].init.signal instanceof AbortSignal, "the request carries a timeout");
  });

  it("fires at most once per 30 seconds, and again after that", async () => {
    const { fn, calls } = fakeFetch();
    let now = 1_000;
    const deps = { env, fetch: fn, now: () => now };
    await notifyNewFeedback(deps);
    now += FEEDBACK_NOTIFY_DEBOUNCE_MS - 1;
    assert.deepEqual(await notifyNewFeedback(deps), { sent: false, reason: "debounced" });
    assert.equal(calls.length, 1);
    now += 1;
    assert.deepEqual(await notifyNewFeedback(deps), { sent: true, status: 200 });
    assert.equal(calls.length, 2);
  });

  it("counts two reports arriving together as one fire", async () => {
    const { fn, calls } = fakeFetch();
    const deps = { env, fetch: fn, now: () => 5_000 };
    const outcomes = await Promise.all([notifyNewFeedback(deps), notifyNewFeedback(deps)]);
    assert.equal(calls.length, 1);
    assert.deepEqual(outcomes.map((outcome) => outcome.sent).sort(), [false, true]);
  });

  it("does nothing, silently, when the address or the token is missing", async () => {
    for (const partial of [
      {},
      { FEEDBACK_NOTIFY_URL: URL_ },
      { FEEDBACK_NOTIFY_TOKEN: TOKEN },
      { FEEDBACK_NOTIFY_URL: "  ", FEEDBACK_NOTIFY_TOKEN: TOKEN },
      { FEEDBACK_NOTIFY_URL: URL_, FEEDBACK_NOTIFY_TOKEN: "" },
    ]) {
      const { fn, calls } = fakeFetch();
      const { log, lines } = logger();
      const outcome = await notifyNewFeedback({ env: partial, fetch: fn, log });
      assert.deepEqual(outcome, { sent: false, reason: "not_configured" });
      assert.equal(calls.length, 0);
      assert.deepEqual(lines, []);
    }
  });

  it("refuses to send the token anywhere that is not https", async () => {
    for (const url of ["http://api.example.test/fire", "not an address"]) {
      const { fn, calls } = fakeFetch();
      const { log, lines } = logger();
      const outcome = await notifyNewFeedback({ env: { ...env, FEEDBACK_NOTIFY_URL: url }, fetch: fn, log });
      assert.deepEqual(outcome, { sent: false, reason: "invalid_url" });
      assert.equal(calls.length, 0);
      assert.equal(lines.length, 1);
    }
  });

  it("logs the status code of a refusal and nothing of the token, the address or the answer", async () => {
    const { fn } = fakeFetch(() => new Response(`{"error":"this project is paused ${TOKEN}"}`, { status: 403 }));
    const { log, lines } = logger();
    const outcome = await notifyNewFeedback({ env, fetch: fn, log, now: () => 1 });
    assert.deepEqual(outcome, { sent: true, status: 403 });
    assert.deepEqual(lines, ["[feedback-notify] the trigger answered 403"]);
  });

  it("swallows a failed request, and never logs the token or the address", async () => {
    const { fn } = fakeFetch(() => {
      throw new TypeError(`fetch failed for ${URL_} with Bearer ${TOKEN}`);
    });
    const { log, lines } = logger();
    const outcome = await notifyNewFeedback({ env, fetch: fn, log, now: () => 1 });
    assert.deepEqual(outcome, { sent: false, reason: "failed" });
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes(TOKEN) && !lines[0].includes("example.test"), lines[0]);
  });

  it("swallows a timeout the same way", async () => {
    const { fn } = fakeFetch(() => Promise.reject(new DOMException("The operation timed out", "TimeoutError")));
    const { log, lines } = logger();
    assert.deepEqual(await notifyNewFeedback({ env, fetch: fn, log, now: () => 1 }), { sent: false, reason: "failed" });
    assert.deepEqual(lines, ["[feedback-notify] the trigger could not be reached (TimeoutError)"]);
  });

  it("does not reject even when the logger itself throws", async () => {
    const { fn } = fakeFetch(() => {
      throw new Error("down");
    });
    const outcome = await notifyNewFeedback({
      env,
      fetch: fn,
      now: () => 1,
      log: () => {
        throw new Error("no log");
      },
    });
    assert.deepEqual(outcome, { sent: false, reason: "failed" });
  });

  it("returns to the caller at once: the request does not wait for the trigger", async () => {
    let release: (response: Response) => void = () => undefined;
    const { fn, calls } = fakeFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const result: void = fireFeedbackNotification({ env, fetch: fn, now: () => 1 });
    assert.equal(result, undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, "the request is under way and nobody is waiting for it");
    release(new Response("{}", { status: 200 }));
  });

  it("a trigger that is down does not break the caller", async () => {
    const { fn } = fakeFetch(() => {
      throw new Error("down");
    });
    assert.doesNotThrow(() => fireFeedbackNotification({ env, fetch: fn, now: () => 1, log: () => undefined }));
    await new Promise((resolve) => setImmediate(resolve));
  });
});
