// Who the extension is, per build flavour (#254).
//
// The dev build and the released build are deliberately *two different extensions*. That is what
// lets both live in one browser: an unpacked copy pointed at a dev instance, and the policy-
// installed copy pointed at the production collection. Same ID would make Chrome refuse the second
// one, and shared storage would let a dev profile reach the production database.
//
// A Chrome extension's ID is the hash of its public key. For a CRX that key comes from the
// signature, so the release ID follows `extension/keys/assistant.pem`. An unpacked build has no
// signature, so it needs `key` in the manifest to get a stable ID — hence the dev key below. Only
// the *public* half exists: nothing is ever signed with it, and there is no dev private key to
// lose. It is committed on purpose, so every machine's unpacked build is the same extension.

/** Public key (base64 DER SPKI) stamped into the unpacked dev build's manifest. */
export const DEV_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2hqwRntOfF9dYWl7Usg3mfMJn6c/kG5+Bivt1Tj/qa42OyxSRlPoA8ZIWruyFKbbJu+zX1tM8dzjY7r4pnpf8EnHG1Nk/kxi1q90MtNstu+imNg0IIqgt6r1niBQJWlq9w95F3V+HRZaghU5CxehUMEwcp+VNjmSiObAqDBRONGpHALVYVP+RBWc7leSYkbyI6z78IqGkuEes4iszJGjnCkjYFnMr77IQiiacsWWeVLZBGYN8wRwtWzhHHVewoL/RiVmv8Aujf26J9p5oD77M31cE1DoMU0SXEdNqkA9GRDtHfJBVhCnYvdrSvqtNxvh3Tl/2k2Gi9v6fnWwiWCRvwIDAQAB";

/** The unpacked dev build's extension ID — `chrome://extensions` shows this one. */
export const DEV_EXTENSION_ID = "idmgaeimkafaifpfbjonmjdfbmgffcbh";

/**
 * The released build's extension ID, from `extension/keys/assistant.pem`. This is the one that goes
 * into every machine's `ExtensionInstallForcelist` policy entry, so it must not change casually —
 * `crx.test.ts` asserts the signing key still produces it.
 */
export const RELEASE_EXTENSION_ID = "afaeadeheelibafbmhobdnkblmbckehn";

/** Appended to the dev build's name, so the two are told apart in `chrome://extensions`. */
export const DEV_NAME_SUFFIX = " (dev)";

/** Amber toolbar icons for the dev build (see `scripts/make-dev-icons.mjs`). */
export const DEV_ICON_DIR = "icons/dev";
