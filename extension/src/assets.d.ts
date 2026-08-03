// Importing an icon yields its `data:` URL — esbuild's `dataurl` loader (see `build.mjs`). Used by
// the content script (#417), which draws the Stamporama mark inside a marketplace page and cannot
// reach `chrome.runtime.getURL` without exposing the extension id to every page.
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}

/** Which build flavour this bundle is, replaced by esbuild's `define` (see `build.mjs`). Read only
 *  through `core/mark.ts`, so "which extension is this" is answered in one place. */
declare const __DEV_BUILD__: boolean;
