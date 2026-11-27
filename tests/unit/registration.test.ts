import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  REGISTRATION_CLOSED_MESSAGE,
  registrationAllowedByEnv,
  signUpGuard,
} from "../../src/lib/registration";

// Registration of new accounts can be closed on an instance (#2713): an environment switch, off by
// default. The refusal is server-side, in a Better Auth `before` hook, so this signs up through
// Better Auth itself against an in-memory store — the same way `session-lifetime.test.ts` does.

describe("registrationAllowedByEnv", () => {
  it("is off when the switch is unset or empty", () => {
    assert.equal(registrationAllowedByEnv({}), false);
    assert.equal(registrationAllowedByEnv({ STAMPORAMA_ALLOW_REGISTRATION: "" }), false);
  });

  it("is on for true, 1, yes and on, in any case and with whitespace", () => {
    for (const value of ["true", "TRUE", " 1 ", "yes", "On"]) {
      assert.equal(registrationAllowedByEnv({ STAMPORAMA_ALLOW_REGISTRATION: value }), true, value);
    }
  });

  it("is off for anything else", () => {
    for (const value of ["false", "0", "no", "off", "maybe"]) {
      assert.equal(registrationAllowedByEnv({ STAMPORAMA_ALLOW_REGISTRATION: value }), false, value);
    }
  });
});

describe("signing up through Better Auth with the guard", () => {
  function authWith(open: boolean) {
    return betterAuth({
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true },
      baseURL: "https://stamps.example.com",
      secret: "unit-test-secret-unit-test-secret-unit-test",
      hooks: { before: signUpGuard(async () => open) },
      logger: { disabled: true },
    });
  }

  const credentials = { email: "collector@example.com", password: "correct horse battery" };

  it("creates the account while registration is open", async () => {
    const auth = authWith(true);
    const response = await auth.api.signUpEmail({
      body: { ...credentials, name: "Collector" },
      asResponse: true,
    });
    assert.equal(response.status, 200);
  });

  it("refuses with 403 while registration is closed, and creates nothing", async () => {
    const auth = authWith(false);
    // Through the HTTP handler, the way the browser reaches it: the endpoint answers 403.
    const response = await auth.handler(
      new Request("https://stamps.example.com/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://stamps.example.com" },
        body: JSON.stringify({ ...credentials, name: "Collector" }),
      })
    );
    assert.equal(response.status, 403);
    assert.ok((await response.text()).includes(REGISTRATION_CLOSED_MESSAGE));
    // And called in-process, the way server code would: it throws, the same refusal.
    await assert.rejects(
      auth.api.signUpEmail({ body: { ...credentials, name: "Collector" } }),
      (error: { status?: string; message?: string }) =>
        error.status === "FORBIDDEN" && error.message === REGISTRATION_CLOSED_MESSAGE
    );
    const signIn = await auth.handler(
      new Request("https://stamps.example.com/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://stamps.example.com" },
        body: JSON.stringify(credentials),
      })
    );
    assert.notEqual(signIn.status, 200);
  });

  it("leaves signing in alone while registration is closed", async () => {
    let open = true;
    const auth = betterAuth({
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true },
      baseURL: "https://stamps.example.com",
      secret: "unit-test-secret-unit-test-secret-unit-test",
      hooks: { before: signUpGuard(async () => open) },
      logger: { disabled: true },
    });
    await auth.api.signUpEmail({ body: { ...credentials, name: "Collector" } });
    open = false;
    const signIn = await auth.api.signInEmail({ body: credentials, asResponse: true });
    assert.equal(signIn.status, 200);
  });
});
