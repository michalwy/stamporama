import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

// The one sign-in redirect in this app that carries no return address (#1176), and the only place
// it would be pointless: this screen *is* the redirect to the collections list, so coming back to
// it would land exactly where signing in lands anyway.

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/collections" : "/sign-in");
}
