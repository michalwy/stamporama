import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  AllegroApiError,
  allegroGet,
  allegroPatch,
  allegroPost,
  allegroUploadImage,
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

describe("allegroUploadImage", () => {
  const BYTES = new Uint8Array([1, 2, 3]);

  it("posts the raw image to the upload host under its own content type", async () => {
    const { requests } = stubFetch([
      { status: 201, body: { location: "https://img/1.jpg", expiresAt: "2026-08-05T00:00:00Z" } },
    ]);
    const result = await allegroUploadImage({
      ...CALL,
      bytes: BYTES,
      contentType: "image/jpeg",
    });
    // The image store is a host of Allegro's own — the API base answers this path with nothing.
    assert.equal(requests[0].url, "https://upload.allegro.pl/sale/images");
    const headers = requests[0].init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "image/jpeg");
    assert.equal(headers.Accept, "application/vnd.allegro.public.v1+json");
    // The picture itself is the body — a form would be answered with a 415.
    assert.deepEqual(new Uint8Array(requests[0].init.body as Uint8Array), BYTES);
    assert.equal(result.body?.location, "https://img/1.jpg");
    assert.equal(result.body?.expiresAt, "2026-08-05T00:00:00Z");
  });

  it("uploads to the sandbox store when the connection is a sandbox one", async () => {
    const { requests } = stubFetch([{ status: 201, body: { location: "https://img/1.jpg" } }]);
    await allegroUploadImage({ ...CALL, sandbox: true, bytes: BYTES, contentType: "image/png" });
    assert.equal(requests[0].url, "https://upload.allegro.pl.allegrosandbox.pl/sale/images");
  });

  it("does not repeat an image the store failed on — an accepted-then-unreported picture is an orphan", async () => {
    const { requests } = stubFetch([{ status: 500 }]);
    await assert.rejects(
      () => allegroUploadImage({ ...CALL, bytes: BYTES, contentType: "image/jpeg" }),
      AllegroApiError
    );
    assert.equal(requests.length, 1);
  });

  it("repeats a rate limit, which is the store refusing before it read anything", async () => {
    const { requests } = stubFetch([
      { status: 429, headers: { "retry-after": "0" } },
      { status: 201, body: { location: "https://img/1.jpg" } },
    ]);
    const result = await allegroUploadImage({ ...CALL, bytes: BYTES, contentType: "image/jpeg" });
    assert.equal(requests.length, 2);
    assert.equal(result.body?.location, "https://img/1.jpg");
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

describe("reading Allegro's errors[]", () => {
  // Allegro is not consistent about which of `message` / `userMessage` carries the complaint, and
  // picking one field is wrong half the time. Both of these shapes are real, observed answers.

  it("takes the sentence out of userMessage when message is the HTTP phrase", async () => {
    stubFetch([
      {
        status: 422,
        body: {
          errors: [
            {
              code: "ParameterCategoryException",
              message: "Unprocessable Entity",
              path: "parameters",
              userMessage: "Parameter `9525:Klej` should not be specified as in section `offer`.",
            },
          ],
        },
      },
    ]);
    const err = await allegroPost({ ...CALL, path: "/sale/product-offers", json: {} }).catch(
      (e: unknown) => e as AllegroApiError
    );
    assert.ok(err instanceof AllegroApiError);
    assert.match(err.message, /9525:Klej/);
    assert.match(err.message, /^parameters: /);
    assert.doesNotMatch(err.message, /Unprocessable Entity/);
  });

  it("takes it out of message when userMessage is the boilerplate", async () => {
    stubFetch([
      {
        status: 422,
        body: {
          errors: [
            {
              message: "Message is not readable.",
              path: "images[0]",
              userMessage: "Request contains invalid data. Contact the application author.",
            },
          ],
        },
      },
    ]);
    const err = await allegroPost({ ...CALL, path: "/sale/product-offers", json: {} }).catch(
      (e: unknown) => e as AllegroApiError
    );
    assert.ok(err instanceof AllegroApiError);
    assert.equal(err.message, "images[0]: Message is not readable.");
  });

  it("reports one line per field, which is what a validation failure is", async () => {
    stubFetch([
      {
        status: 422,
        body: {
          errors: [
            { message: "Unprocessable Entity", path: "location.postCode", userMessage: "Wrong." },
            { message: "Unprocessable Entity", path: "stock.available", userMessage: "Too many." },
          ],
        },
      },
    ]);
    const err = await allegroPost({ ...CALL, path: "/sale/product-offers", json: {} }).catch(
      (e: unknown) => e as AllegroApiError
    );
    assert.ok(err instanceof AllegroApiError);
    assert.equal(err.message, "location.postCode: Wrong.; stock.available: Too many.");
    assert.equal(err.details.length, 2);
  });

  it("keeps both wordings on the detail, and both are non-generic when they differ", async () => {
    stubFetch([
      {
        status: 422,
        body: { errors: [{ message: "Value too long.", userMessage: "Tytuł jest za długi." }] },
      },
    ]);
    const err = await allegroPost({ ...CALL, path: "/sale/product-offers", json: {} }).catch(
      (e: unknown) => e as AllegroApiError
    );
    assert.ok(err instanceof AllegroApiError);
    assert.equal(err.details[0].text, "Value too long. — Tytuł jest za długi.");
  });
});
