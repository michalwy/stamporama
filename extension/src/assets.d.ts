// Importing an icon yields its `data:` URL — esbuild's `dataurl` loader (see `build.mjs`). Used by
// the content script (#417), which draws the Stamporama mark inside a marketplace page and cannot
// reach `chrome.runtime.getURL` without exposing the extension id to every page.
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
