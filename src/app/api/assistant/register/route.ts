import { NextRequest, NextResponse } from "next/server";
import { redeemAssistantRegistrationCode } from "@/lib/assistant-registration";

// Registration code → Assistant token exchange (#252, part of #155). Called by the extension's
// background worker after it reads the payload off an instance's Settings page. Deliberately *not*
// collection-scoped in the URL: the code identifies the collection, and the caller has no session —
// possession of an unspent, unexpired code is the entire authorization, which is why the code lives
// for minutes and can be spent once.
//
// Every rejection returns the same generic 400: a caller guessing codes learns nothing from the
// difference between "unknown", "expired", and "already used".

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const regCode = (body as { regCode?: unknown } | null)?.regCode;
  if (typeof regCode !== "string" || !regCode.trim()) {
    return NextResponse.json({ error: "Invalid registration code." }, { status: 400 });
  }

  const redeemed = await redeemAssistantRegistrationCode(regCode);
  if (!redeemed) {
    return NextResponse.json(
      { error: "This registration code is no longer valid. Start again from Settings." },
      { status: 400 }
    );
  }

  return NextResponse.json(redeemed);
}
