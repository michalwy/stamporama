import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createCollection } from "../../src/lib/collections";
import { AdminError } from "../../src/lib/admin-access";
import {
  countNewFeedbackReports,
  createFeedbackReport,
  getFeedbackReport,
  listFeedbackReports,
  updateFeedbackReport,
} from "../../src/lib/feedback";
import { ANONYMOUS_PER_ADDRESS, parseFeedbackSubmission } from "../../src/lib/feedback-rules";
import { resetRateLimits } from "../../src/lib/rate-limit";
import { resetFeedbackNotify } from "../../src/lib/feedback-notify";
import { deleteAccountAsAdmin } from "../../src/lib/admin";
import { POST as postFeedback } from "../../src/app/api/feedback/route";
import { POST as postMcp } from "../../src/app/api/mcp/route";

// In-app feedback end to end (#2720): a report sent to the route is stored with its context and
// without a share link's secret; only an administrator reads and updates it; and the admin MCP
// tools exist for an administrator's credential and for nobody else's.
//
// The database is shared with the files running beside this one (#2199), so every report here
// carries this run's marker in its message and every count is of those.

const RUN = `feedback-${Date.now()}`;

// This file's administrator is named the way an operator names one (#2729).
process.env.ADMIN_EMAILS = `test-${RUN}-admin@example.com`;

async function createUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-${RUN}-${suffix}`,
      name: `Test ${suffix}`,
      email: `test-${RUN}-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

function feedbackRequest(body: unknown, address = "203.0.113.7"): NextRequest {
  return new NextRequest("http://localhost/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": address },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ownReports = () => prisma.feedbackReport.findMany({ where: { message: { contains: RUN } }, orderBy: { createdAt: "asc" } });

function submission(body: Record<string, unknown>) {
  const parsed = parseFeedbackSubmission(body);
  assert.ok(parsed.ok);
  return parsed.submission;
}

function refused(code: AdminError["code"]) {
  return (error: unknown) => error instanceof AdminError && error.code === code;
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function mcp(token: string, method: string, params?: unknown) {
  const response = await postMcp(
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  );
  return (await response.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const answer = await mcp(token, "tools/call", { name, arguments: args });
  assert.ok(answer.result, `expected a tool result, got ${JSON.stringify(answer.error)}`);
  const result = answer.result as unknown as ToolResult;
  const isError = result.isError === true;
  // A refusal is its sentence, a blank line, and the error body as JSON.
  const text = result.content[0].text;
  const json = isError ? text.slice(text.indexOf("\n\n") + 2) : text;
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return { isError, body: isError ? ((parsed.error as Record<string, unknown>) ?? parsed) : parsed };
}

async function toolNames(token: string): Promise<string[]> {
  const answer = await mcp(token, "tools/list");
  return ((answer.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name);
}

describe("in-app feedback", () => {
  let adminId: string;
  let collectorId: string;
  let collectionId: string;

  before(async () => {
    adminId = (await createUser("admin")).id;
    collectorId = (await createUser("collector")).id;
    collectionId = (await createCollection(collectorId, `Feedback ${RUN}`, "EUR")).id;
  });

  beforeEach(() => resetRateLimits());

  after(async () => {
    await prisma.feedbackReport.deleteMany({ where: { message: { contains: RUN } } });
    await prisma.collection.deleteMany({ where: { owner: { id: { startsWith: `test-user-${RUN}` } } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: `test-user-${RUN}` } } });
  });

  describe("sending from a shared page, with no account", () => {
    it("stores the report with its context and without the link's token", async () => {
      const response = await postFeedback(
        feedbackRequest({
          kind: "question",
          message: `Is lot 3 still available? ${RUN} anonymous`,
          contact: "buyer@example.com",
          route: "/p/SUPERSECRETTOKEN?x=1",
          userAgent: "Firefox 140",
          viewport: "390x844",
          language: "pl-PL",
          timeZone: "Europe/Warsaw",
          theme: "light",
          recentErrors: ["TypeError: picks is undefined"],
        })
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });

      const [report] = (await ownReports()).filter((row) => row.message.includes("anonymous"));
      assert.ok(report);
      assert.equal(report.source, "shared");
      assert.equal(report.sharedPage, "proposal");
      assert.equal(report.route, "/p/[token]");
      assert.equal(report.kind, "question");
      assert.equal(report.status, "new");
      assert.equal(report.contact, "buyer@example.com");
      assert.equal(report.userId, null);
      assert.equal(report.collectionId, null);
      assert.equal(report.viewport, "390x844");
      assert.equal(report.language, "pl-PL");
      assert.equal(report.recentErrors, "TypeError: picks is undefined");
      assert.ok(report.appVersion.length > 0);
      assert.ok(!JSON.stringify(report).includes("SUPERSECRETTOKEN"));
    });

    it("refuses an anonymous report from anywhere that is not a shared page", async () => {
      const response = await postFeedback(
        feedbackRequest({ kind: "problem", message: `${RUN} not allowed`, route: "/c/somebody/stamps" })
      );
      assert.equal(response.status, 401);
      assert.equal((await ownReports()).filter((row) => row.message.includes("not allowed")).length, 0);
    });

    it("refuses what is not a report", async () => {
      assert.equal((await postFeedback(feedbackRequest("{not json"))).status, 400);
      assert.equal((await postFeedback(feedbackRequest({ kind: "problem", message: " ", route: "/p/x" }))).status, 400);
      assert.equal((await postFeedback(feedbackRequest({ kind: "praise", message: "x", route: "/p/x" }))).status, 400);
    });

    it("bounds how many one address may send, and leaves another address alone", async () => {
      const send = (n: number, address: string) =>
        postFeedback(feedbackRequest({ kind: "idea", message: `${RUN} burst ${address} ${n}`, route: "/t/tok" }, address));
      for (let n = 0; n < ANONYMOUS_PER_ADDRESS; n += 1) {
        assert.equal((await send(n, "198.51.100.1")).status, 200, `report ${n}`);
      }
      const over = await send(99, "198.51.100.1");
      assert.equal(over.status, 429);
      assert.ok(Number(over.headers.get("retry-after")) > 0);
      assert.equal((await send(0, "198.51.100.2")).status, 200);

      const stored = (await ownReports()).filter((row) => row.message.includes("burst"));
      assert.equal(stored.filter((row) => row.message.includes("198.51.100.1")).length, ANONYMOUS_PER_ADDRESS);
      assert.equal(stored.filter((row) => row.message.includes("198.51.100.2")).length, 1);
    });

    it("answers a filled hidden field as if it had worked, and stores nothing", async () => {
      const response = await postFeedback(
        feedbackRequest({ kind: "idea", message: `${RUN} honeypot`, route: "/s/tok", website: "https://spam.example" })
      );
      assert.equal(response.status, 200);
      assert.equal((await ownReports()).filter((row) => row.message.includes("honeypot")).length, 0);
    });
  });

  describe("sending from inside the app", () => {
    it("attaches the account and the sender's own collection, and ignores a typed contact", async () => {
      const { id } = await createFeedbackReport(
        { userId: collectorId },
        submission({
          kind: "problem",
          message: `${RUN} signed in`,
          route: "/c/whatever/stamps?q=1",
          collectionSlug: (await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).slug,
          contact: "ignored@example.com",
        })
      );
      const report = await prisma.feedbackReport.findUniqueOrThrow({ where: { id } });
      assert.equal(report.source, "app");
      assert.equal(report.userId, collectorId);
      assert.equal(report.collectionId, collectionId);
      assert.equal(report.contact, null);
      assert.equal(report.route, "/c/whatever/stamps?q=1");
    });

    it("does not attach a collection the sender does not own", async () => {
      const other = await createUser("other");
      const slug = (await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).slug;
      const { id } = await createFeedbackReport(
        { userId: other.id },
        submission({ kind: "idea", message: `${RUN} someone else's slug`, route: "/c/x", collectionSlug: slug })
      );
      assert.equal((await prisma.feedbackReport.findUniqueOrThrow({ where: { id } })).collectionId, null);
    });

    it("keeps the report when its account is deleted", async () => {
      const leaving = await createUser("leaving");
      const { id } = await createFeedbackReport(
        { userId: leaving.id },
        submission({ kind: "problem", message: `${RUN} outlives its account`, route: "/collections" })
      );
      await deleteAccountAsAdmin(adminId, leaving.id);
      const report = await prisma.feedbackReport.findUniqueOrThrow({ where: { id } });
      assert.equal(report.userId, null);
      assert.equal(report.message, `${RUN} outlives its account`);
    });
  });

  describe("reading and updating, as an administrator", () => {
    let reportId: string;

    before(async () => {
      reportId = (
        await createFeedbackReport(
          { userId: collectorId },
          submission({ kind: "problem", message: `${RUN} to triage`, route: "/c/x/offers" })
        )
      ).id;
    });

    it("refuses everyone else", async () => {
      await assert.rejects(listFeedbackReports(collectorId, { limit: 10, offset: 0 }), refused("forbidden"));
      await assert.rejects(countNewFeedbackReports(collectorId), refused("forbidden"));
      await assert.rejects(getFeedbackReport(collectorId, reportId), refused("forbidden"));
      await assert.rejects(updateFeedbackReport(collectorId, reportId, { status: "dismissed" }), refused("forbidden"));
      assert.equal((await prisma.feedbackReport.findUniqueOrThrow({ where: { id: reportId } })).status, "new");
    });

    it("lists newest first, narrows by status and states the total", async () => {
      const all = await listFeedbackReports(adminId, { limit: 100, offset: 0 });
      assert.ok(all.total >= all.reports.length);
      const mine = all.reports.filter((report) => report.message.includes(RUN));
      assert.ok(mine.some((report) => report.id === reportId));
      for (let i = 1; i < all.reports.length; i += 1) {
        assert.ok(all.reports[i - 1].createdAt >= all.reports[i].createdAt);
      }
      const fresh = await listFeedbackReports(adminId, { status: "new", limit: 100, offset: 0 });
      assert.ok(fresh.reports.every((report) => report.status === "new"));
      assert.ok((await countNewFeedbackReports(adminId)) >= 1);
      const one = await getFeedbackReport(adminId, reportId);
      assert.equal(one.user?.email, `test-${RUN}-collector@example.com`);
    });

    it("sets the status, the issue and the note; an omitted field stays, an empty one clears", async () => {
      const issue = "https://github.com/michalwy/stamporama/issues/2720";
      let report = await updateFeedbackReport(adminId, reportId, { status: "triaged", issueUrl: issue, adminNote: " seen " });
      assert.deepEqual([report.status, report.issueUrl, report.adminNote], ["triaged", issue, "seen"]);

      report = await updateFeedbackReport(adminId, reportId, { status: "resolved" });
      assert.deepEqual([report.status, report.issueUrl, report.adminNote], ["resolved", issue, "seen"]);

      report = await updateFeedbackReport(adminId, reportId, { issueUrl: "", adminNote: "" });
      assert.deepEqual([report.status, report.issueUrl, report.adminNote], ["resolved", null, null]);
    });

    it("refuses a status, an issue URL and a report that are not real", async () => {
      await assert.rejects(updateFeedbackReport(adminId, reportId, { status: "urgent" }), refused("refused"));
      await assert.rejects(updateFeedbackReport(adminId, reportId, { issueUrl: "https://example.com/1" }), refused("refused"));
      await assert.rejects(updateFeedbackReport(adminId, "no-such-report", { status: "new" }), refused("not_found"));
      await assert.rejects(getFeedbackReport(adminId, "no-such-report"), refused("not_found"));
    });
  });

  describe("the admin MCP tools", () => {
    const TOOLS = ["get_feedback", "list_feedback", "update_feedback"];
    let adminToken: string;
    let adminReadToken: string;
    let collectorToken: string;
    let reportId: string;

    before(async () => {
      const adminCollection = await createCollection(adminId, `Admin ${RUN}`, "EUR");
      adminToken = (await createAssistantToken(adminId, adminCollection.id, { label: "admin", scope: "read_write", kind: "agent" })).token;
      adminReadToken = (await createAssistantToken(adminId, adminCollection.id, { label: "admin read", scope: "read", kind: "agent" })).token;
      collectorToken = (await createAssistantToken(collectorId, collectionId, { label: "collector", scope: "read_write", kind: "agent" })).token;
      reportId = (
        await createFeedbackReport(
          { userId: null },
          submission({ kind: "idea", message: `${RUN} through mcp`, route: "/spec/SECRET", contact: "visitor@example.com" })
        )
      ).id;
    });

    it("are offered to an administrator's credential and to nobody else's", async () => {
      const forAdmin = await toolNames(adminToken);
      const forCollector = await toolNames(collectorToken);
      assert.deepEqual(forAdmin.filter((name) => TOOLS.includes(name)).sort(), TOOLS);
      assert.deepEqual(forCollector.filter((name) => TOOLS.includes(name)), []);
      // Everything else is the same list.
      assert.deepEqual(forAdmin.filter((name) => !TOOLS.includes(name)), forCollector);
    });

    it("do not exist for anyone else, even called by name", async () => {
      for (const name of TOOLS) {
        const answer = await mcp(collectorToken, "tools/call", { name, arguments: { feedback_id: reportId } });
        assert.ok(answer.error, name);
        assert.match(answer.error.message, /no tool named/);
      }
      assert.equal((await prisma.feedbackReport.findUniqueOrThrow({ where: { id: reportId } })).status, "new");
    });

    it("list, read and triage a report", async () => {
      const listed = await callTool(adminToken, "list_feedback", { status: "new", limit: 100 });
      assert.equal(listed.isError, false);
      const items = listed.body.items as { id: string; excerpt: string; status: string }[];
      assert.ok(typeof listed.body.total === "number" && listed.body.total >= items.length);
      const row = items.find((item) => item.id === reportId);
      assert.ok(row, "the new report is listed");
      assert.equal(row.status, "new");

      const read = await callTool(adminToken, "get_feedback", { feedback_id: reportId });
      assert.equal(read.isError, false);
      assert.equal(read.body.message, `${RUN} through mcp`);
      assert.equal(read.body.route, "/spec/[token]");
      assert.equal(read.body.sharedPage, "specification");
      // The visitor's address stays in the panel; the agent learns only that one was left.
      assert.equal(read.body.contactGiven, true);
      assert.ok(!JSON.stringify(read.body).includes("visitor@example.com"));

      const issue = "https://github.com/michalwy/stamporama/issues/2720";
      const updated = await callTool(adminToken, "update_feedback", {
        feedback_id: reportId,
        status: "triaged",
        issue_url: issue,
      });
      assert.equal(updated.isError, false);
      assert.deepEqual([updated.body.status, updated.body.issueUrl], ["triaged", issue]);

      const after = await callTool(adminToken, "list_feedback", { status: "new", limit: 100 });
      assert.ok(!(after.body.items as { id: string }[]).some((item) => item.id === reportId));
    });

    it("answer a mistake with a sentence, not a crash", async () => {
      const badStatus = await callTool(adminToken, "list_feedback", { status: "urgent" });
      assert.equal(badStatus.isError, true);
      const badUrl = await callTool(adminToken, "update_feedback", { feedback_id: reportId, issue_url: "https://example.com/x" });
      assert.equal(badUrl.isError, true);
      assert.equal(badUrl.body.code, "invalid_request");
      const nothing = await callTool(adminToken, "update_feedback", { feedback_id: reportId });
      assert.equal(nothing.isError, true);
      const missing = await callTool(adminToken, "get_feedback", { feedback_id: "no-such-report" });
      assert.equal(missing.isError, true);
      assert.equal(missing.body.code, "not_found");
    });

    it("refuse a read credential on the one that writes", async () => {
      const read = await callTool(adminReadToken, "get_feedback", { feedback_id: reportId });
      assert.equal(read.isError, false);
      const write = await callTool(adminReadToken, "update_feedback", { feedback_id: reportId, status: "dismissed" });
      assert.equal(write.isError, true);
      assert.equal(write.body.code, "forbidden");
      assert.equal((await prisma.feedbackReport.findUniqueOrThrow({ where: { id: reportId } })).status, "triaged");
    });
  });

  // #2721: storing a report fires the coordinator's routine. The trigger is `globalThis.fetch`
  // here, replaced for the length of one test — nothing reaches the network.
  describe("telling the coordinator", () => {
    const realFetch = globalThis.fetch;
    let fired: { url: string; init: RequestInit }[] = [];

    function stubTrigger(answer: () => Response) {
      fired = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fired.push({ url: String(input), init: init ?? {} });
        return answer();
      }) as typeof fetch;
    }

    beforeEach(() => {
      resetFeedbackNotify();
      process.env.FEEDBACK_NOTIFY_URL = "https://trigger.example.test/fire";
      process.env.FEEDBACK_NOTIFY_TOKEN = "test-token";
    });

    after(() => {
      globalThis.fetch = realFetch;
      delete process.env.FEEDBACK_NOTIFY_URL;
      delete process.env.FEEDBACK_NOTIFY_TOKEN;
      resetFeedbackNotify();
    });

    const send = (label: string, extra: Record<string, unknown> = {}) =>
      postFeedback(
        feedbackRequest({ kind: "problem", message: `${RUN} notify ${label}`, route: "/p/tok", ...extra }, "203.0.113.90")
      );

    it("fires the trigger once for a stored report, with an empty body, and once for a burst", async () => {
      stubTrigger(() => new Response("{}", { status: 200 }));
      assert.equal((await send("first")).status, 200);
      assert.equal((await send("second")).status, 200);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fired.length, 1);
      assert.equal(fired[0].url, "https://trigger.example.test/fire");
      assert.equal(fired[0].init.body, "{}");
      assert.equal((await ownReports()).filter((row) => row.message.includes("notify")).length >= 2, true);
    });

    it("stores the report and answers 200 when the trigger fails", async () => {
      stubTrigger(() => {
        throw new Error("the trigger is down");
      });
      const response = await send("trigger down");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fired.length, 1);
      assert.equal((await ownReports()).filter((row) => row.message.includes("trigger down")).length, 1);
    });

    it("fires nothing for a refused report, a filled hidden field, or an unconfigured instance", async () => {
      stubTrigger(() => new Response("{}", { status: 200 }));
      assert.equal((await send("refused", { kind: "praise" })).status, 400);
      assert.equal((await send("honeypot", { website: "https://spam.example" })).status, 200);
      delete process.env.FEEDBACK_NOTIFY_TOKEN;
      assert.equal((await send("unconfigured")).status, 200);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fired.length, 0);
    });
  });
});
