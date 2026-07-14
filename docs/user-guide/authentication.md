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

## Signing out

Click the **Sign out** button on the collections page. You will be redirected to the sign-in page and your session will be ended.

## Accessing protected pages

All collection pages (`/c/...`) and the collections picker (`/collections`) require a valid session. Navigating to these pages without being signed in redirects you to `/sign-in` automatically.
