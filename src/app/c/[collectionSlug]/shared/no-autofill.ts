/**
 * Attributes that keep password managers off a field (#262, #389).
 *
 * Short identifier inputs — a catalog prefix, an order number, a lot number, a location ref — look
 * enough like a username or a one-time code that LastPass, 1Password and Bitwarden all overlay
 * their own icon on them and offer to fill them. `autoComplete="off"` alone is not enough: the
 * extensions ignore it, so each one needs its own opt-out attribute.
 *
 * Spread it onto the `<input>`: `<input type="text" {...NO_AUTOFILL} … />`.
 */
export const NO_AUTOFILL = {
  autoComplete: "off",
  "data-lpignore": "true",
  "data-1p-ignore": "",
  "data-bwignore": "",
} as const;
