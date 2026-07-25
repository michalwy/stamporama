// Mint the Chrome Web Store refresh token that CI publishes with (#288).
//
//   CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… node extension/scripts/cws-refresh-token.mjs
//
// Google removed the copy-the-code-from-the-page flow in 2022, so the only route left for a desktop
// OAuth client is a loopback redirect: this starts a one-shot listener on 127.0.0.1, prints the URL
// to open, catches the code Google redirects back with, and exchanges it for a refresh token.
//
// The refresh token it prints is a long-lived credential for your store listing. Put it straight
// into the `CWS_REFRESH_TOKEN` repository secret; do not commit it, and do not paste it into a chat
// or an issue. Nothing here writes it to disk.
//
// If it expires after a week, the OAuth consent screen is still in "Testing" — publish the app.
import { createServer } from "node:http";

const clientId = process.env.CWS_CLIENT_ID?.trim();
const clientSecret = process.env.CWS_CLIENT_SECRET?.trim();
const port = Number(process.env.PORT ?? 8818);
const redirectUri = `http://127.0.0.1:${port}`;

if (!clientId || !clientSecret) {
  console.error("Set CWS_CLIENT_ID and CWS_CLIENT_SECRET (from the desktop OAuth client).");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/chromewebstore",
  // `offline` is what makes Google hand back a refresh token at all, and `consent` forces a fresh
  // one even if this client was already authorized once.
  access_type: "offline",
  prompt: "consent",
}).toString();

console.log("\nOpen this URL, sign in as the account that owns the store listing, and approve:\n");
console.log(`  ${authUrl}\n`);
console.log("(An unverified-app warning is expected — Advanced → Go to … .)\n");

const code = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, redirectUri);
    const received = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    response.writeHead(received ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
    response.end(received ? "Got it — back to the terminal.\n" : `Authorization failed: ${error}\n`);

    server.close();
    if (received) resolve(received);
    else reject(new Error(error ?? "no code in the redirect"));
  });

  server.listen(port, "127.0.0.1", () => console.log(`Waiting on ${redirectUri} …`));
  server.on("error", reject);
}).catch((error) => {
  // A denied consent or a port already in use is an ordinary outcome, not a crash worth a stack.
  console.error(`\nNo authorization code: ${error.message}`);
  process.exit(1);
});

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  }),
});

const token = await response.json();
if (!response.ok || !token.refresh_token) {
  console.error("\nToken exchange failed:", JSON.stringify(token, null, 2));
  console.error(
    "\nNo refresh_token usually means this client was authorized before — the `prompt=consent` above should prevent that; otherwise revoke the app at https://myaccount.google.com/permissions and rerun."
  );
  process.exit(1);
}

console.log("\nrefresh_token:\n");
console.log(`  ${token.refresh_token}\n`);
console.log("Store it as the CWS_REFRESH_TOKEN repository secret. It is not saved anywhere here.\n");
