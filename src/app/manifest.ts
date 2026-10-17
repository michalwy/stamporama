import type { MetadataRoute } from "next";
import { PHONE_START_PATH } from "@/lib/phone";

/**
 * The web app manifest (#2002, ADR-0072 §1): what lets the site be added to an Android phone's home
 * screen as an icon named Stamporama that opens the phone start screen.
 *
 * It is a manifest only — **no service worker and no offline mode**: the phone always works online
 * against the collector's own server, and a page it cannot reach the server for says so.
 *
 * `scope` is the whole site, not `/phone`: every phone screen links to the full app, and a link out
 * of scope would leave the home-screen window for a browser tab. The manifest is fetched without the
 * session cookie, so nothing in it may depend on who is signed in — and nothing does.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stamporama",
    short_name: "Stamporama",
    description: "Self-hosted web application for stamp collectors.",
    start_url: PHONE_START_PATH,
    scope: "/",
    display: "standalone",
    // The icon's own white and teal (`src/app/icon.svg`): the splash screen Android draws from these
    // while the first page loads is the icon on its own background.
    background_color: "#ffffff",
    theme_color: "#0f766e",
    icons: [
      { src: "/phone-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/phone-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/phone-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
