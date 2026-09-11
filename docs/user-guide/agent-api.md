# Connecting an AI assistant

Stamporama can be handed to an AI assistant — Claude, or anything else that speaks **MCP** — so that
you can ask it about your collection in ordinary words. *"What have I got from the 1928 set that is
not in an album yet?"* *"Which of my Michel numbers are missing a price?"*

It connects to **one collection**, through a token you make yourself, and you decide whether that
token may change anything or only look.

This is not the [Stamporama Assistant](assistant.md), which is a Chrome extension for marketplace
pages. They are different things that happen to use the same kind of token, and the same screen
makes both.

## What you need

- Your instance reachable from wherever the assistant runs. If you run Stamporama on your own
  machine and the assistant runs there too, that is `http://localhost:3000`. If the assistant runs
  somewhere else — a phone, a hosted client — the instance has to be reachable from there.
- A **token**, made in **Settings → Assistant**.

## Making the token

1. Open the collection you want the assistant to see.
2. Go to **Settings → Assistant** and choose **Generate token by hand**.
3. Pick **Agent** for what it is for. That is only a label, so you can tell this row of the list from
   the extension's; it does not change what the token may do.
4. Pick what it **may do**:
   - **Read only** — it can look at this collection and nothing else. Anything that would change
     something is refused, and the assistant is told which kind of token would have been needed.
   - **Read and write** — it can change things too.

   **Start with read only.** You can always make a second token later, and an assistant that can only
   look is one you can leave running without thinking about it.
5. Copy the token. **It is shown only once.** If you lose it, revoke that row and make another.

You can revoke a token at any moment from the same screen, and whatever was using it stops working
immediately.

## Pointing a client at it

The address is your instance followed by `/api/mcp`, and the token goes in an `Authorization`
header:

```
https://stamporama.example.com/api/mcp
Authorization: Bearer stmpa_…
```

Most clients are configured with a small block of JSON. For a client that speaks to a remote MCP
server over HTTP, it looks like this:

```json
{
  "mcpServers": {
    "stamporama": {
      "url": "https://stamporama.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer stmpa_your_token_here"
      }
    }
  }
}
```

Where a client insists on launching a local command rather than talking to a URL, point it at any
of the usual HTTP bridges for MCP and give the bridge the same URL and header.

**The collection is not in the address, and that is deliberate.** The token already says which
collection it is for, so there is nothing to get wrong and nothing an assistant could point at the
wrong one. Two tokens for two collections are simply two entries.

## Checking that it worked

Ask the assistant to **list its tools**. You should see Stamporama's, each with a sentence saying
what it does. If the client shows nothing, it is nearly always one of three things:

- **The address.** It ends in `/api/mcp`, with no trailing slash and no collection in it.
- **The token.** A wrong or revoked one comes back as *unauthorized* with a sentence naming the
  screen that makes a new one. Tokens are shown once, so a half-copied one is the usual cause.
- **Reachability.** If the assistant runs somewhere other than your own machine, `localhost` means
  *its* machine and not yours.

Then ask it something small — *"what conditions are set up in this collection?"* — which is the one
call every assistant makes first anyway.

## What it can do, and what it will not

The tools grow with each release, and the assistant reads the current list itself, so what it can do
is whatever your instance offers rather than whatever was written here.

Two things it will never do, however you ask, and they are absent rather than switched off:

- **It never publishes to a marketplace.** It can draft, price and title an offer inside
  Stamporama; putting it in front of the public stays with you. An assistant that misreads costs you
  a minute, and one that mispublishes lists a stamp at the wrong price under your name on somebody
  else's platform.
- **It never reaches a counterparty.** It can build and balance a trade; it does not send a
  proposal, share a link, or write to Colnect.

And with a **read only** token it changes nothing at all, which is the setting to start from.

## For a client that speaks plain HTTP

If what you have is a script rather than an MCP client, the same operations are available as an
ordinary REST API at `/api/v1`, with the same token. `GET /api/v1/openapi.json` — which also needs
the token — describes everything the instance offers, so most HTTP tooling can be pointed straight
at it.
