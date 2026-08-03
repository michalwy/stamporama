import releaseIcon from "../../icons/icon-16.png";
import devIcon from "../../icons/dev/icon-16.png";

// The Stamporama mark, as a page should draw it (#417, #466).
//
// The dev build and the released build are two different extensions (`identity.mjs`, ADR-0017), and
// the dev one wears **amber** toolbar icons precisely so the two can be told apart in one browser.
// A mark drawn into somebody else's page has to follow that: a collector running both copies — an
// unpacked one on a dev instance, the store one on the production collection — reads the colour to
// know which of them just told them this listing is theirs. A link that is always blue says the
// wrong thing on half of those pages.
//
// Which flavour this is comes from `__DEV_BUILD__`, replaced at build time by esbuild's `define`, so
// the choice is made when the bundle is written rather than looked up at runtime: the branch folds
// away and each build inlines the one icon it draws. It has to be inlined as a `data:` URL either
// way — see the `dataurl` loader in `build.mjs`: a content script cannot reference an extension file
// without a `web_accessible_resources` entry, which hands every page the extension's id.
declare const __DEV_BUILD__: boolean;

/** The 16px mark matching this build's toolbar icon, as a `data:` URL. */
export const markIconUrl: string = __DEV_BUILD__ ? devIcon : releaseIcon;
