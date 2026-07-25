import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

// Chrome's update manifest for the Stamporama Assistant (#254, part of #155). A machine's policy
// entry is `<extension id>;https://<instance>/assistant/update.xml`, and this is what Chrome polls:
// it answers with the version this instance carries and where to download it.
//
// Unauthenticated by design — Chrome fetches it without cookies, before any user is involved, and
// it discloses nothing beyond the extension build the instance ships.
//
// The CRX itself is a static file baked into release images by CI (`public/assistant/`). Source and
// dev builds have none, so this route 404s there; that is the honest answer, and the extension is
// loaded unpacked in that situation anyway.

export const dynamic = "force-dynamic";

const CRX_ROUTE = "/assistant/stamporama-assistant.crx";
const METADATA_PATH = join(process.cwd(), "public", "assistant", "crx-metadata.json");

type CrxMetadata = {
  extensionId: string;
  version: string;
};

async function readMetadata(): Promise<CrxMetadata | null> {
  try {
    const parsed = JSON.parse(await readFile(METADATA_PATH, "utf8")) as Partial<CrxMetadata>;
    if (!parsed.extensionId || !parsed.version) return null;
    return { extensionId: parsed.extensionId, version: parsed.version };
  } catch {
    return null;
  }
}

/**
 * The absolute URL Chrome should download from. It has to be absolute, and it has to be *this*
 * instance — so it is derived from the request rather than configured, and the proxy headers win
 * when Stamporama sits behind one (the internal request URL would be `http://…:3000`).
 */
function crxUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  if (!host) return new URL(CRX_ROUTE, request.url).toString();

  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return new URL(CRX_ROUTE, `${proto}://${host}`).toString();
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    switch (character) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

export async function GET(request: NextRequest) {
  const metadata = await readMetadata();
  if (!metadata) {
    return new NextResponse(
      "No packaged Stamporama Assistant on this instance. Release images ship one; from source, load the extension unpacked.\n",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${escapeXml(metadata.extensionId)}">
    <updatecheck codebase="${escapeXml(crxUrl(request))}" version="${escapeXml(metadata.version)}" />
  </app>
</gupdate>
`;

  return new NextResponse(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Chrome polls this every few hours; an upgraded instance must be seen immediately.
      "cache-control": "no-store",
    },
  });
}
