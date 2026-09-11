import { endedSessionNotice } from "@/lib/session-end";
import SignInForm from "./sign-in-form";

// A server component wrapping the form so the screen can say **why** the collector is looking at
// it (#1175). A session that ended without them asking used to land them on a blank form, with no
// way to tell a fault from the consequence of a configuration change they made on purpose.

export default async function SignInPage() {
  return <SignInForm signedOutNotice={await endedSessionNotice()} />;
}
