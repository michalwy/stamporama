import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCollectionsByOwner } from "@/lib/collections";
import { signInPath } from "@/lib/sign-in-redirect";
import { headersBaseUrl } from "@/lib/oauth-http";
import { checkAuthorizationRequest, type AuthorizationParams } from "@/lib/oauth-rules";
import { findOAuthClient } from "@/lib/oauth-server";
import { ConsentCard, ConsentForm } from "./consent-form";

// `/oauth/authorize` (#2715, ADR-0084) — where an app sends the collector to be allowed in: claude.ai
// adding Stamporama as a connector, or any MCP client signing in the same way.
//
// **Signing in comes first and is the ordinary sign-in.** A browser without a session is sent to
// `/sign-in` carrying this address as its return (#1176), so the collector lands back here with the
// request intact. Nothing in this flow creates an account: it is for the accounts the instance
// already has.
//
// **The request is checked before anything is drawn**, by the pure `checkAuthorizationRequest`. An
// app this instance does not know, or a redirect URI it never registered, gets a sentence on this
// page and the browser goes nowhere; any other fault is the app's to hear about, at its own redirect
// URI. Only a request that passed is shown to the collector — and it is checked again, from the top,
// when they answer (`actions/oauth.ts`).
//
// Not a collection screen, so it is drawn like the sign-in card rather than in `Screen`: one narrow
// column, because it is one question.

export const metadata = { title: "Connect an app" };

const PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect(await signInPath());

  const query = await searchParams;
  const params: Record<string, string> = {};
  for (const name of PARAMS) {
    const value = query[name];
    if (typeof value === "string") params[name] = value;
  }
  const request: AuthorizationParams = params;

  const baseUrl = headersBaseUrl(requestHeaders);
  const client = await findOAuthClient(params.client_id ?? "");
  const checked = checkAuthorizationRequest(request, client, baseUrl);

  if (checked.kind === "redirect") redirect(checked.location);
  if (checked.kind === "page") {
    return (
      <ConsentCard title="This connection cannot continue">
        <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6 }}>{checked.message}</p>
      </ConsentCard>
    );
  }

  const collections = await getCollectionsByOwner(session.user.id);
  return (
    <ConsentForm
      params={request}
      clientName={checked.request.clientName}
      returnsTo={new URL(checked.request.redirectUri).host}
      accountEmail={session.user.email}
      collections={collections.map(({ id, name }) => ({ id, name }))}
      offeredScopes={checked.request.offeredScopes}
    />
  );
}
