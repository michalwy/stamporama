import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_MESSAGE_MAX,
  feedbackExcerpt,
  parseFeedbackSubmission,
  parseIssueUrl,
  redactRoute,
} from "../../src/lib/feedback-rules";
import { FEEDBACK_LABEL_LANGUAGES, feedbackLabels } from "../../src/lib/feedback-labels";

// The pure half of in-app feedback (#2720): what is accepted from a browser, and that a share
// link's secret never reaches a stored report.

describe("redactRoute", () => {
  it("replaces a share link's token on every kind of shared page", () => {
    assert.deepEqual(redactRoute("/p/abc123SECRET"), { route: "/p/[token]", sharedPage: "proposal" });
    assert.deepEqual(redactRoute("/s/abc123SECRET"), { route: "/s/[token]", sharedPage: "sale" });
    assert.deepEqual(redactRoute("/t/abc123SECRET"), { route: "/t/[token]", sharedPage: "trade" });
    assert.deepEqual(redactRoute("/spec/abc123SECRET"), { route: "/spec/[token]", sharedPage: "specification" });
    assert.deepEqual(redactRoute("/fb/abc123SECRET"), { route: "/fb/[token]", sharedPage: "facebook_post" });
  });

  it("drops the query of a token page and keeps what follows the token", () => {
    assert.deepEqual(redactRoute("/t/abc123SECRET/photos/9?x=abc123SECRET"), {
      route: "/t/[token]/photos/9",
      sharedPage: "trade",
    });
  });

  it("keeps a screen inside the app whole, query included", () => {
    assert.deepEqual(redactRoute("/c/poland/offers?status=open&page=2"), {
      route: "/c/poland/offers?status=open&page=2",
      sharedPage: null,
    });
    assert.deepEqual(redactRoute("/collections"), { route: "/collections", sharedPage: null });
  });

  it("does not take a longer first segment for a shared page", () => {
    assert.equal(redactRoute("/phone/collections").sharedPage, null);
    assert.equal(redactRoute("/sign-in").sharedPage, null);
  });

  it("reads anything that is not a path as the root", () => {
    assert.deepEqual(redactRoute("https://evil.example/p/x"), { route: "/", sharedPage: null });
    assert.deepEqual(redactRoute("//evil.example/p/x"), { route: "/", sharedPage: null });
    assert.deepEqual(redactRoute(""), { route: "/", sharedPage: null });
  });
});

describe("parseFeedbackSubmission", () => {
  const base = { kind: "problem", message: "  The list is empty.  ", route: "/c/poland/stamps" };

  it("accepts a report and trims it", () => {
    const parsed = parseFeedbackSubmission({
      ...base,
      collectionSlug: "poland",
      userAgent: "Firefox",
      viewport: "1440x900",
      language: "pl-PL",
      timeZone: "Europe/Warsaw",
      theme: "dark",
      recentErrors: ["TypeError: x is undefined", "  ", 7],
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.honeypot, false);
    assert.deepEqual(parsed.submission, {
      kind: "problem",
      message: "The list is empty.",
      contact: null,
      collectionSlug: "poland",
      route: "/c/poland/stamps",
      sharedPage: null,
      userAgent: "Firefox",
      viewport: "1440x900",
      language: "pl-PL",
      timeZone: "Europe/Warsaw",
      theme: "dark",
      recentErrors: "TypeError: x is undefined",
    });
  });

  it("redacts the token of a shared page before anything else sees it", () => {
    const parsed = parseFeedbackSubmission({ ...base, route: "/p/SECRETTOKEN", contact: " buyer@example.com " });
    assert.ok(parsed.ok);
    assert.equal(parsed.submission.route, "/p/[token]");
    assert.equal(parsed.submission.sharedPage, "proposal");
    assert.equal(parsed.submission.contact, "buyer@example.com");
    assert.ok(!JSON.stringify(parsed.submission).includes("SECRETTOKEN"));
  });

  it("refuses what is not a report, with a sentence", () => {
    for (const body of [null, "text", [], { message: "x" }, { kind: "praise", message: "x" }, { kind: "idea" }, { kind: "idea", message: "   " }]) {
      const parsed = parseFeedbackSubmission(body);
      assert.equal(parsed.ok, false, JSON.stringify(body));
      assert.ok(!parsed.ok && parsed.message.length > 0);
    }
  });

  it("refuses a message over the cap rather than cutting it", () => {
    assert.equal(parseFeedbackSubmission({ ...base, message: "x".repeat(FEEDBACK_MESSAGE_MAX) }).ok, true);
    assert.equal(parseFeedbackSubmission({ ...base, message: "x".repeat(FEEDBACK_MESSAGE_MAX + 1) }).ok, false);
  });

  it("caps context instead of refusing it, and keeps the last few errors", () => {
    const parsed = parseFeedbackSubmission({
      ...base,
      userAgent: "u".repeat(5000),
      recentErrors: ["1", "2", "3", "4", "5", "6", "e".repeat(5000)],
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.submission.userAgent?.length, 300);
    const lines = parsed.submission.recentErrors?.split("\n") ?? [];
    assert.deepEqual(lines.slice(0, 4), ["3", "4", "5", "6"]);
    assert.equal(lines[4].length, 300);
  });

  it("notices the hidden field a person never fills", () => {
    const parsed = parseFeedbackSubmission({ ...base, website: "https://spam.example" });
    assert.ok(parsed.ok && parsed.honeypot);
  });
});

describe("parseIssueUrl", () => {
  it("accepts a GitHub issue and nothing else", () => {
    assert.deepEqual(parseIssueUrl(" https://github.com/michalwy/stamporama/issues/2720 "), {
      ok: true,
      url: "https://github.com/michalwy/stamporama/issues/2720",
    });
    for (const bad of [
      "http://github.com/a/b/issues/1",
      "https://github.com/a/b/pull/1",
      "https://github.com/a/b/issues/0",
      "https://github.com/a/b/issues/1/x",
      "https://evil.example/github.com/a/b/issues/1",
      "javascript:alert(1)",
    ]) {
      assert.deepEqual(parseIssueUrl(bad), { ok: false }, bad);
    }
  });

  it("clears on an empty string", () => {
    assert.deepEqual(parseIssueUrl("  "), { ok: true, url: null });
  });
});

describe("feedbackExcerpt", () => {
  it("flattens whitespace and cuts with an ellipsis", () => {
    assert.equal(feedbackExcerpt("one\n\ntwo   three"), "one two three");
    const cut = feedbackExcerpt("word ".repeat(100), 20);
    assert.ok(cut.length <= 20 && cut.endsWith("…"));
  });
});

describe("feedbackLabels", () => {
  it("has the same words in every language it is written in", () => {
    const keys = Object.keys(feedbackLabels("en")).sort();
    for (const language of FEEDBACK_LABEL_LANGUAGES) {
      const labels = feedbackLabels(language);
      assert.deepEqual(Object.keys(labels).sort(), keys, language);
      assert.deepEqual(Object.keys(labels.kind).sort(), ["idea", "problem", "question"], language);
      for (const [key, value] of Object.entries(labels)) {
        if (typeof value === "string") assert.ok(value.trim().length > 0, `${language}.${key}`);
      }
    }
  });

  it("follows the page's language and falls back to English", () => {
    assert.equal(feedbackLabels("pl").entry, "Zgłoś problem");
    assert.equal(feedbackLabels("pl-PL").entry, "Zgłoś problem");
    assert.equal(feedbackLabels("DE").entry, "Problem melden");
    assert.equal(feedbackLabels("fr").entry, "Report a problem");
    assert.equal(feedbackLabels(null).entry, "Report a problem");
    assert.equal(feedbackLabels(undefined).entry, "Report a problem");
  });
});
