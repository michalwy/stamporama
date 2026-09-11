# Authentication

Stamporama uses email and password authentication. No external accounts or third-party services are required.

## Creating an account

1. Open Stamporama in your browser. If you are not signed in, you will be redirected to the sign-in page.
2. Click **Sign up** at the bottom of the sign-in form.
3. Enter your name, email address, and a password (minimum 8 characters).
4. Click **Create account**. You will be taken to your collections page immediately.

## Signing in

1. Navigate to the Stamporama URL. You will be redirected to `/sign-in` if you are not already signed in.
2. Enter your email address and password.
3. Click **Sign in**. You will be taken to your collections page.

If your credentials are incorrect, an error message is shown and you can try again.

## Staying signed in

**Being signed in lasts until you sign out.** There is no inactivity window and no fixed lifetime: coming back to Stamporama after a fortnight finds you exactly as signed in as coming back an hour later would, and restarting the instance — or a development server — changes nothing. Closing the browser changes nothing either.

Three things do end a session, and all three are changes to the instance rather than to what you were doing:

- **Signing out.** Immediate and complete: nothing is reachable afterwards without signing in again.
- **Rotating `BETTER_AUTH_SECRET`, or moving the instance between `http` and `https`.** Every session is signed with that secret, so changing it ends all of them at once. This is the correct outcome, not a fault.
- **Replacing or resetting the database.** Sessions are stored rows; a new database does not have them.

**Moving the instance to a different address** ends your session too, and it is the one case Stamporama cannot explain when it happens: your browser keeps its session for the old address and simply does not offer it at the new one, so the new address sees a first-time visitor and shows a plain sign-in form.

## Why you were signed out

Whenever a session ends without your asking, the sign-in page says so in one sentence above the form — which change it was, and that signing in again is the whole of the remedy. That sentence stays until you sign in.

You will not see it after signing out yourself, nor when you simply have not signed in yet: there is nothing to explain in either case.

## Signing out

Click the **Sign out** button on the collections page, or in the sidebar of a collection. You will be redirected to the sign-in page and your session will be ended.

## Accessing protected pages

All collection pages (`/c/...`) and the collections picker (`/collections`) require a valid session. Navigating to these pages without being signed in redirects you to `/sign-in` automatically.
