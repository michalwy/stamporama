import { endedSessionNotice } from "@/lib/session-end";
import { RETURN_TO_PARAM, landingAfterSignIn } from "@/lib/sign-in-return";
import SignInForm from "./sign-in-form";

// A server component wrapping the form so the screen can say **why** the collector is looking at
// it (#1175). A session that ended without them asking used to land them on a blank form, with no
// way to tell a fault from the consequence of a configuration change they made on purpose.
//
// It also settles **where signing in goes** (#1176), before the form is rendered rather than after
// it is submitted: the return address arrives on the URL, where anyone can put anything, and the
// one place it is checked is here. What the form is handed is already a screen of this app.

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const returnTo = (await searchParams)[RETURN_TO_PARAM];

  return (
    <SignInForm
      signedOutNotice={await endedSessionNotice()}
      landing={landingAfterSignIn(typeof returnTo === "string" ? returnTo : null)}
    />
  );
}
