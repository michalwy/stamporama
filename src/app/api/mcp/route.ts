import { NextRequest, NextResponse } from "next/server";
import { assertAgentApiScope, resolveAgentApiCaller } from "@/lib/route-auth";
import { errorResponseBody, unauthorized } from "@/lib/agent-api/errors";
import {
  JSON_RPC,
  handleMcpMessage,
  jsonRpcErrorResponse,
  readRequestId,
} from "@/lib/agent-api/mcp";
import { OPERATIONS } from "@/lib/agent-api/registry";
import { getAppVersion } from "@/lib/version";

// `POST /api/mcp` (#709) — the remote MCP endpoint, served by the app itself.
//
// **Nothing extra runs beside the existing container.** An MCP server here is one route handler
// over the same registry `/api/v1` dispatches: the tools are generated from `OPERATIONS`, the
// credential is the same `Bearer stmpa_…` token, the collection is pinned the same way, and the
// scope check is the same function. There is no second credential and nothing second to revoke.
//
// **This file is the transport and nothing else.** Every protocol decision — the handshake, the
// tool schemas, which failures are JSON-RPC errors and which are tool errors — is in the pure
// `src/lib/agent-api/mcp.ts`, where `pnpm test:unit` can hold it. What is here is the part that
// genuinely needs a request: reading the token, and turning an outcome into a `Response`.
//
// **Streamable HTTP, stateless.** One `POST` carrying one JSON-RPC message, answered with one
// JSON-RPC message. No `Mcp-Session-Id`, because there is no session state to key: the tool list is
// compiled into the build and every call is authorised from its own header. The specification lets
// a server that offers no server-initiated stream refuse `GET`, which is what the handler below
// does — so a client that would like to open an SSE channel is told plainly rather than left
// waiting on one that never sends anything.

/** The one place the endpoint's own 401 is spelled, so it matches `/api/v1`'s word for word. */
function unauthenticated(): NextResponse {
  const { status, body } = errorResponseBody(
    unauthorized(
      "Send an Assistant token as `Authorization: Bearer stmpa_…`. Mint one in Settings → Assistant."
    )
  );
  return NextResponse.json(body, {
    status,
    // The scheme, so a client that holds a credential and sent it wrongly can tell that from one it
    // does not hold at all. There is no OAuth metadata to point at: this surface takes the token the
    // collector minted, and nothing here can issue one.
    headers: { "WWW-Authenticate": "Bearer" },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const caller = await resolveAgentApiCaller(request);
  if (!caller) return unauthenticated();

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return NextResponse.json(
      jsonRpcErrorResponse(
        null,
        JSON_RPC.parseError,
        "The request body is not valid JSON. Send one JSON-RPC 2.0 message per request."
      )
    );
  }

  try {
    const outcome = await handleMcpMessage(message, {
      operations: OPERATIONS,
      appVersion: getAppVersion(),
      context: { ownerId: caller.ownerId, collectionId: caller.collectionId },
      // #707's enforcement point, bound to this caller. The wrapper reuses it rather than deriving
      // a scope of its own — one place decides what a token may do, and this is not it.
      //
      // **This one line is not covered end to end, and that is measured rather than assumed.**
      // Replacing it with a no-op and running `tests/integration/agent-api-mcp.test.ts` leaves all
      // twelve green, because **nothing in `OPERATIONS` writes**: there is no request that could be
      // refused. It is the same hole #707 records for its own criterion and for the same reason —
      // adding a writing operation to make the test real would breach an issue's *Out of scope* —
      // and the gap goes when #711 lands the first one. Until then the decision is held over both
      // directions in `tests/unit/agent-api-mcp.test.ts` against the real `assertOperationScope`,
      // and the scope on a real hashed row is exercised in the integration suite beside it; what
      // no test here can see is that *this binding* is the thing being called.
      assertScope: (operation) => assertAgentApiScope(caller, operation),
    });

    // A notification gets no reply at all, which is what the specification asks for and what
    // `notifications/initialized` needs: a body here would be a response to a message that carried
    // no id to answer.
    if (outcome.kind === "accepted") return new Response(null, { status: 202 });

    // A JSON-RPC error rides in the body with a `200`. The HTTP status describes the transport, and
    // the transport worked.
    return NextResponse.json(outcome.body);
  } catch (error) {
    // Anything that reaches here is a defect on our side. Its message is deliberately not relayed —
    // an internal message is written for a maintainer reading a log, and putting it in front of an
    // agent spends context on a sentence it cannot act on (#706).
    console.error("[api/mcp] unhandled", error);
    return NextResponse.json(
      jsonRpcErrorResponse(
        readRequestId(message),
        JSON_RPC.internalError,
        "The request failed inside Stamporama. Retry once; if it fails again, report it."
      )
    );
  }
}

/** No server-initiated stream, so there is nothing for a `GET` to open. */
export async function GET(): Promise<NextResponse> {
  return methodNotAllowed("GET");
}

/** No session to terminate — this endpoint keeps none. */
export async function DELETE(): Promise<NextResponse> {
  return methodNotAllowed("DELETE");
}

function methodNotAllowed(method: string): NextResponse {
  return NextResponse.json(
    jsonRpcErrorResponse(
      null,
      JSON_RPC.invalidRequest,
      `This MCP endpoint accepts POST only; it does not offer a ${method} stream or a session to terminate. Send each JSON-RPC message as its own POST.`
    ),
    { status: 405, headers: { Allow: "POST" } }
  );
}
