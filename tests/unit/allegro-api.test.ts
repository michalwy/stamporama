import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  AllegroApiError,
  allegroGet,
  allegroPatch,
  allegroPost,
  allegroUpload,
} from "../../src/lib/allegro-api";

// The write half's retry policy (#485) is the thing worth pinning down here: a repeated POST after a
// timeout is two listings on a live selling account, so what is and is not retried is a product
// decision rather than an implementation detail.

const CALL = { sandbox: false, accessToken: "token", userAgent: "Stamporama/1 (+url)" };

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** Replace `fetch` with a queue of canned answers, recording what was asked. */
function stubFetch(answers: Answer[]): { requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = [];
  let index = 0;
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    const answer = answers[Math.min(index++, answers.length - 1)];
    const headers = new Headers(answer.headers ?? {});
    if (answer.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers,
    });
  }) as unknown as typeof fetch;
  return { requests };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("allegroPost", () => {
  it("returns a 201 as created rather than accepted", async () => {
    stubFetch([{ status: 201, body: { id: "offer-1" } }]);
    const result = await allegroPost<{ id: string }>({
      ...CALL,
      path: "/sale/product-offers",
      json: { name: "A lot" },
    });
    assert.equal(result.status, 201);
    assert.equal(result.accepted, false);
    assert.equal(result.body?.id, "offer-1");
  });

  it("returns a 202 as accepted-not-finished, with somewhere to follow it up", async () => {
    // The distinction the caller cannot do without: a 202 is an operation still running, and
    // recording it as a published listing is how an offer Allegro later refused reads as live here.
    stubFetch([
      { status: 202, body: { id: "op-1" }, headers: { location: "/sale/offer-publication/op-1" } },
    ]);
    const result = await allegroPost({ ...CALL, path: "/sale/offers", json: {} });
    assert.equal(result.accepted, true);
    assert.equal(result.location, "/sale/offer-publication/op-1");
  });

  it("sends Allegro's own media type as the content type", async () => {
    const { requests } = stubFetch([{ status: 201, body: {} }]);
    await allegroPost({ ...CALL, path: "/sale/offers", json: { a: 1 } });
    const headers = requests[0].init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "application/vnd.allegro.public.v1+json");
    assert.equal(headers.Authorization, "Bearer token");
    assert.equal(requests[0].init.body, JSON.stringify({ a: 1 }));
  });

  it("retries a rate limit — Allegro refused it before doing anything with it", async () => {
    const { requests } = stubFetch([
      { status: 429, headers: { "retry-after": "0" } },
      { status: 201, body: { id: "offer-1" } },
    ]);
    const result = await allegroPost<{ id: string }>({ ...CALL, path: "/sale/offers", json: {} });
    assert.equal(requests.length, 2);
    assert.equal(result.body?.id, "offer-1");
  });

  it("does NOT retry a server fault: the listing may already exist", async () => {
    const { requests } = stubFetch([{ status: 500, body: { errors: [{ userMessage: "Boom" }] } }]);
    await assert.rejects(
      allegroPost({ ...CALL, path: "/sale/offers", json: {} }),
      (err: unknown) => err instanceof AllegroApiError && err.status === 500
    );
    assert.equal(requests.length, 1);
  });

  it("does NOT retry a request that never answered at all", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    await assert.rejects(
      allegroPost({ ...CALL, path: "/sale/offers", json: {} }),
      (err: unknown) => err instanceof AllegroApiError && err.status === null
    );
    assert.equal(calls, 1);
  });

  it("reports a missing permission as one, not as a generic refusal", async () => {
    stubFetch([
      {
        status: 403,
        body: { errors: [{ userMessage: "Access is denied" }] },
        headers: { "www-authenticate": 'Bearer error="insufficient_scope"' },
      },
    ]);
    await assert.rejects(
      allegroPost({ ...CALL, path: "/sale/offers", json: {} }),
      (err: unknown) => {
        assert.ok(err instanceof AllegroApiError);
        assert.equal(err.insufficientScope, true);
        assert.match(err.message, /does not have permission/);
        assert.match(err.message, /reconnect/i);
        return true;
      }
    );
  });

  it("does not read a scope refusal as a rejected token", async () => {
    // `unauthorized` latches "needs reconnecting", and reconnecting the same application is exactly
    // what does not fix a permission it was never registered with.
    stubFetch([{ status: 401, headers: { "www-authenticate": 'Bearer error="insufficient_scope"' } }]);
    await assert.rejects(allegroPost({ ...CALL, path: "/sale/offers", json: {} }), (err: unknown) => {
      assert.ok(err instanceof AllegroApiError);
      assert.equal(err.insufficientScope, true);
      assert.equal(err.unauthorized, false);
      return true;
    });
  });
});

describe("allegroPatch", () => {
  it("sends a PATCH and reads an empty answer as no body", async () => {
    const { requests } = stubFetch([{ status: 204 }]);
    const result = await allegroPatch({ ...CALL, path: "/sale/product-offers/1", json: { a: 1 } });
    assert.equal(requests[0].init.method, "PATCH");
    assert.equal(result.status, 204);
    assert.equal(result.accepted, false);
    assert.equal(result.body, null);
  });

  it("follows the write policy rather than HTTP's idempotency", async () => {
    const { requests } = stubFetch([{ status: 503 }]);
    await assert.rejects(allegroPatch({ ...CALL, path: "/sale/offers/1", json: {} }));
    assert.equal(requests.length, 1);
  });
});

describe("allegroUpload", () => {
  it("lets fetch write the multipart content type, boundary included", async () => {
    const { requests } = stubFetch([{ status: 201, body: { location: "https://img/1.jpg" } }]);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])]), "one.jpg");
    const result = await allegroUpload({ ...CALL, path: "/sale/images", form });
    const headers = requests[0].init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], undefined);
    assert.ok(requests[0].init.body instanceof FormData);
    // A body that states where the picture landed is followed up the same way a header would be.
    assert.equal(result.location, "https://img/1.jpg");
  });
});

describe("allegroGet", () => {
  it("still retries a server fault — repeating a read costs nothing", async () => {
    const { requests } = stubFetch([
      { status: 500, headers: { "retry-after": "0" } },
      { status: 200, body: { ok: true } },
    ]);
    const body = await allegroGet<{ ok: boolean }>({ ...CALL, path: "/me" });
    assert.equal(requests.length, 2);
    assert.equal(body.ok, true);
  });

  it("repeats an array query parameter rather than joining it", async () => {
    const { requests } = stubFetch([{ status: 200, body: {} }]);
    await allegroGet({ ...CALL, path: "/sale/offers", query: { "offer.id": ["1", "2"] } });
    assert.equal(new URL(requests[0].url).searchParams.getAll("offer.id").join(","), "1,2");
  });
});
