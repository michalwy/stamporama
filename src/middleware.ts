import { NextRequest, NextResponse } from "next/server";

interface Session {
  user: { id: string; email: string; name: string };
}

export async function middleware(request: NextRequest) {
  const response = await fetch(
    new URL("/api/auth/get-session", request.url),
    { headers: { cookie: request.headers.get("cookie") ?? "" } }
  );

  const session: Session | null = response.ok ? await response.json() : null;

  if (!session) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/c/:path*", "/collections"],
};
