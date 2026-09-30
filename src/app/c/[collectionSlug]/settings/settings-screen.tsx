"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanningProfileListRow } from "@/lib/scanning-profile";
import { ScanningProfilesPanel } from "./scanning-profiles-panel";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { StorageCacheStatus } from "@/lib/storage-cache";
import {
  BidRecommendationPanel,
  CollectionSettingsPanel,
  StorageSettingsPanel,
} from "./settings-panel";
import { SettingsPageFrame } from "./settings-page-frame";
import { LeaveGuardProvider, useLeaveGuard } from "./leave-guard";
import {
  SETTINGS_GROUPS,
  resolveSettingsAddress,
  settingsEntriesOf,
  settingsGroupOf,
  settingsSearch,
  type SettingsEntryKey,
  type SettingsGroup,
} from "./settings-nav";
import {
  normalizeSettingsText,
  searchSettings,
  type SettingsFieldMatch,
  type SettingsMatch,
} from "./settings-search";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { scrollIntoView } from "@/app/c/[collectionSlug]/shared/motion";
import { AppVersionLabel } from "@/app/c/[collectionSlug]/shared/app-version-label";
import { CatalogPanel } from "./catalogs-panel";
import { ConditionsPanel } from "./conditions-panel";
import { CertificateStatusesPanel } from "./certificate-statuses-panel";
import { FormatsPanel } from "./formats-panel";
import { FormatFactorsPanel } from "./format-factors-panel";
import { SubtypesPanel } from "./subtypes-panel";
import { AttributeDictionaryPanel } from "./attributes-panel";
import { StampSizePresetsPanel } from "./stamp-size-presets-panel";
import { TagsPanel } from "./tags-panel";
import { AcceptanceProfilesPanel } from "./acceptance-profiles-panel";
import { DuplicatesPanel } from "./duplicates-panel";
import { ColnectPanel } from "./colnect-panel";
import { ColnectConditionsPanel } from "./colnect-conditions-panel";
import { ColnectAttributesPanel } from "./colnect-attributes-panel";
import { ColnectPlatformPanel } from "./colnect-platform-panel";
import { ColnectListsPanel } from "./colnect-lists-panel";
import { AllegroSettingsBody, AllegroSummary } from "./allegro-settings-page";
import { DelcampeSettingsBody, DelcampeSummary } from "./delcampe-settings-page";
import { PhilasearchPlatformPanel } from "./philasearch-platform-panel";
import { CollageTemplatesPanel } from "./collage-templates-panel";
import { RefCardTemplatesPanel } from "./ref-card-templates-panel";
import { CarriersPanel } from "./carriers-panel";
import { HawidStockPanel } from "./hawid-stock-panel";
import { AlbumTemplatesPanel } from "./album-templates-panel";
import { AlbumOrnamentsPanel } from "./album-ornaments-panel";
import { AssistantPanel } from "./assistant-panel";
import { EmailPanel } from "./email-panel";
import { AuctionReminderPanel } from "./auction-reminder-panel";
import type { DuplicateCatalogMode } from "@/lib/duplicate-catalog";
import type { CollectionAreaData } from "@/lib/areas";
import type { CatalogVendorData } from "@/lib/catalog";
import type { ColnectMappingData, ColnectConditionMappingData } from "@/lib/colnect";
import type { ColnectListMappingData } from "@/lib/colnect-list-sync";
import type { AssistantTokenData } from "@/lib/api-tokens";
import type { MailSettings } from "@/lib/mail/messages";
import type { AuctionReminderSettings } from "@/lib/auction-reminder";
import type { StampConditionData } from "@/lib/conditions";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { FormatFactorData } from "@/lib/format-factors";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampSubtypeData } from "@/lib/subtypes";
import type { StampAttributeLists } from "@/lib/stamp-attributes";
import type { StampSizePresetData } from "@/lib/stamp-size-presets";
import type { TagData } from "@/lib/tags";
import { STAMP_ATTRIBUTE_KINDS, type StampAttributeKind } from "@/lib/stamp-attribute-kinds";
import type { CollageTemplateData } from "@/lib/collage-templates";
import type { RefCardTemplateData } from "@/lib/ref-card-templates";
import type { CarrierData } from "@/lib/carriers";
import type { HawidStripData } from "@/lib/hawid-stock";
import type { AlbumTemplateData } from "@/lib/album-templates";
import type { AllegroConnectionStatus } from "@/lib/allegro-connection";
import type { AllegroListingProfileList } from "@/lib/allegro-listing-profile";
import type { AllegroLearnedCategoryList } from "@/lib/allegro-category";
import type { DelcampeListingProfileList } from "@/lib/delcampe-listing-profile";
import type { DelcampeLearnedCategoryList } from "@/lib/delcampe-categories";

interface SettingsScreenProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  /** The collection's default language (#293), edited on Collection. */
  defaultLanguage: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  /** Listing languages in use across the collection's platforms (#293); drives the per-language
   * title-name inputs on the area form. */
  titleLanguages: string[];
  initialTree: CatalogVendorData[];
  initialConditions: StampConditionData[];
  initialFormats: StampFormatData[];
  initialFormatFactors: FormatFactorData[];
  initialCertificateStatuses: CertificateStatusData[];
  initialSubtypes: StampSubtypeData[];
  /** The four stamp-attribute dictionaries (#72) — colour, watermark, paper, printing method. */
  initialAttributes: StampAttributeLists;
  /** The collection's stamp size presets (#804) — the seventh and eighth attribute's dictionary,
   *  a saved pair of millimetres copied onto a stamp rather than referenced by it. */
  initialStampSizePresets: StampSizePresetData[];
  /** The collection's tags (#152) — the collector's own labels, with what each is on. Empty until
   *  the collector invents one: nothing is seeded. */
  initialTags: TagData[];
  initialCollageTemplates: CollageTemplateData[];
  /** The collection's ref-card formats (#569) — what the blank ref-card sheet prints. */
  initialRefCardTemplates: RefCardTemplateData[];
  /** The hawid strips the collection owns (#765) — what an album page's boxes are cut from. */
  initialHawidStrips: HawidStripData[];
  /** The collection's album templates (#766) — how a page looks, seeded onto an album rather than
   *  referenced by one. */
  initialAlbumTemplates: AlbumTemplateData[];
  /** The collection's carriers (#491) — the tracking-address side of shipping. */
  initialCarriers: CarrierData[];
  initialColnectMappings: ColnectMappingData[];
  /** Every condition with the Colnect grade it maps to (#404) — one row each, mapped or not. */
  initialColnectConditionMappings: ColnectConditionMappingData[];
  /** Colnect's four standard lists with what each mirrors (#684) — one row each, configured or
   *  not, since the set is Colnect's and is fixed. */
  initialColnectListMappings: ColnectListMappingData[];
  /** Which platform contact is Colnect (#406), or null when none is — the setting the listing
   * checks ride on. */
  colnectPlatformId: string | null;
  /** Which platform contact is Allegro (#355), or null when none is — the setting the Assistant's
   * lot capture rides on. */
  allegroPlatformId: string | null;
  /** This instance's own API connection to the collector's Allegro account (#476). Secret-free by
   *  construction — the client secret and both tokens never cross to the browser. */
  allegroConnection: AllegroConnectionStatus;
  /** The Allegro platform's listing profiles (#486) and which of them it publishes with by
   *  default — empty, with a null platform, until one of the collection's platforms is Allegro. */
  allegroListingProfiles: AllegroListingProfileList;
  /** What the collection has learned about Allegro's categories (#488) — both registers, empty with
   *  a null platform until one of the collection's platforms is Allegro. */
  allegroLearnedCategories: AllegroLearnedCategoryList;
  /** Which platform is Delcampe (#608), and the profiles its uploads are built from. */
  delcampePlatformId: string | null;
  delcampeListingProfiles: DelcampeListingProfileList;
  delcampeLearnedCategories: DelcampeLearnedCategoryList;
  /** Which platform is Philasearch (#742) — the setting a lot captured from its pages rides on. */
  philasearchPlatformId: string | null;
  /** Every platform contact, for that picker. */
  platformContacts: { id: string; name: string }[];
  initialAssistantTokens: AssistantTokenData[];
  /** Email (#1372): the instance's mail provider as a summary — never its key — and this
   * collection's undelivered mail. */
  mailSettings: MailSettings;
  /** The morning auction reminder (#1373): on or off, its hour and zone, and whether the instance
   * can send mail at all. */
  auctionReminder: AuctionReminderSettings;
  /** Internal copy-number display width (#268), edited on Collection. */
  itemNoPad: number;
  /** The bid-recommendation percentages (#508), edited on Bid recommendation. */
  bidFloorPercent: number;
  bidCeilingPercent: number;
  bidFallbackPercent: number;
  /** How long this collection's closed offers keep their generated images (#577), or null while it
   * defers to the instance. Edited on Photos & storage, beside the storage figure it explains. */
  closedOfferPhotoTtl: string | null;
  /** What deferring to the instance means, already in words — the environment variable itself stays
   * server-side. */
  instanceClosedOfferPhotoTtlLabel: string;
  /** How long this collection keeps the scans of a batch it has finished with (#578), or null while
   * it defers to the instance — whose own answer, in words, is the second field. */
  scanSheetTtl: string | null;
  instanceScanSheetTtlLabel: string;
  /** The collection's scanning profiles (#1443), each with what uses it. */
  initialScanningProfiles: ScanningProfileListRow[];
  duplicateCatalogMode: DuplicateCatalogMode;
  photoStorageBytes: number;
  /** The local cache of remote storage objects (#591), shown beside the storage figure but never
   * added to it: one is the collector's data, the other is reclaimable scratch. */
  storageCache: StorageCacheStatus;
  appVersion: string;
  /** When the running build was made (#507), ISO-8601, or null on an unstamped build. */
  appReleaseDate: string | null;
}

/** A heading inside a page that holds several panels of one thing — below the page title's rank. */
const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: "0 0 1rem",
};

/**
 * The entries already laid out in one of ADR-0059's body shapes, so no longer held to today's
 * column (`UNSHAPED_PAGE_WIDTH`). The dictionaries are list beside detail — the Catalog group's with
 * #1471, the rest with #1476; Album templates and Ref card templates are list beside preview (#1474,
 * #1478); the plain forms are the grid of fields (#1473); Allegro is a summary strip over three tabs
 * (#1475), Delcampe over two (#1479).
 */
const RESHAPED_ENTRIES: ReadonlySet<SettingsEntryKey> = new Set([
  "catalogs",
  "conditions",
  "certificates",
  "formats",
  "subtypes",
  "attributes",
  "size-presets",
  "scanning",
  "tags",
  "hawid-stock",
  "ornaments",
  "shipping",
  "acceptance",
  "assistant",
  "album-templates",
  "refcards",
  "general",
  "storage",
  "duplicates",
  "philasearch",
  "allegro",
  "delcampe",
  "bids",
]);

/** Where the navigation stays put: the window scrolls the page, never the list (#1469). */
const NAV_TOP = "2rem";

/**
 * The Settings screen (#1469; ADR-0059): the grouped navigation down the left, every group open,
 * and the chosen entry in the shared page skeleton beside it. What each entry holds is unchanged;
 * the entries are `settings-nav.ts`'s.
 */
export function SettingsScreen(props: SettingsScreenProps) {
  // Everything that takes an edited row off the screen asks first (#1471) — the page's own rows,
  // its tabs, and the navigation beside it.
  return (
    <LeaveGuardProvider>
      <SettingsScreenBody {...props} />
    </LeaveGuardProvider>
  );
}

function SettingsScreenBody(props: SettingsScreenProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { guard } = useLeaveGuard();

  const { entry, part } = resolveSettingsAddress(searchParams.get("tab"), searchParams.get("part"));

  // A tab inside an entry replaces rather than pushes, as the album screen's do (#1430): it is a
  // view of one page, and Back should leave the page rather than step through its tabs.
  function choosePart(next: string) {
    guard(() =>
      router.replace(`${pathname}${settingsSearch(searchParams, entry.key, next)}`, { scroll: false })
    );
  }

  // The search (#1470) is local rather than in the address: it is a way of finding an entry, not a
  // view of one, so a reload or a bookmark should open the page it names with the whole list beside
  // it. Moving between entries keeps it, since the screen stays mounted.
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchSettings(query), [query]);

  // The field a picked match should land on, held until the page it is on has rendered. `nonce`
  // lets the same match be picked twice.
  const [target, setTarget] = useState<FieldTarget | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  function pick(entryKey: SettingsEntryKey, field: SettingsFieldMatch | null) {
    if (field) setTarget({ entry: entryKey, ...field, nonce: Date.now() });
    router.push(`${pathname}${settingsSearch(new URLSearchParams(), entryKey, field?.part ?? null)}`, {
      scroll: false,
    });
  }

  useEffect(() => {
    if (!target || target.entry !== entry.key || target.part !== part) return;
    // A tab is found among the tabs, a field in the page's body — never the page title, which on an
    // entry like Formats says the same word as its first tab.
    const root = target.kind === "part" ? frameRef.current : bodyRef.current;
    if (!root) return;
    // A page that reads its data after mounting (Acceptance profiles, Corner ornaments) shows its
    // fields a moment late, so the field is looked for on each frame for a couple of seconds
    // rather than once.
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      // A marketplace page's platform choice is portalled into the header (#1473, #1475), outside
      // the body, so a field the body does not have is looked for among the frame's labelled
      // controls — by its `aria-label` only, never its text, for the title's reason above.
      const found =
        findField(root, target) ??
        (target.kind === "field" && frameRef.current
          ? findLabelled(frameRef.current, target.label)
          : null);
      if (found || ++tries > FIELD_LOOKUP_FRAMES) {
        if (found) markField(found, root, target.label);
        setTarget(null);
        return;
      }
      frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [target, entry.key, part]);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "2.5rem" }}>
      <SettingsNav
        activeKey={entry.key}
        pathname={pathname}
        appVersion={props.appVersion}
        appReleaseDate={props.appReleaseDate}
        query={query}
        onQuery={setQuery}
        matches={matches}
        onPick={pick}
      />
      <div ref={frameRef} style={{ flex: 1, minWidth: 0 }}>
        <SettingsPageFrame
          // Keyed on the entry so a page's own state — a half-typed field, an open row — does not
          // follow the collector onto the next entry.
          key={entry.key}
          group={settingsGroupOf(entry)}
          title={entry.label}
          hint={entry.hint}
          unshaped={!RESHAPED_ENTRIES.has(entry.key)}
          summary={entrySummary(entry.key, part, choosePart, props)}
          tabs={
            entry.parts && part ? { parts: entry.parts, active: part, onChoose: choosePart } : undefined
          }
        >
          <div ref={bodyRef}>
            <SettingsEntryBody entryKey={entry.key} part={part} {...props} />
          </div>
        </SettingsPageFrame>
      </div>
    </div>
  );
}

/**
 * The summary strip over an entry's tabs (#1475; ADR-0059 §4), for the entries that have one. Built
 * here rather than portalled up by the body, as the main action is, because each tile opens a tab —
 * and choosing a tab, through the leave guard, is the screen's.
 */
function entrySummary(
  entryKey: SettingsEntryKey,
  part: string | null,
  choosePart: (part: string) => void,
  props: SettingsScreenProps
): React.ReactNode {
  switch (entryKey) {
    case "allegro":
      return (
        <AllegroSummary
          connection={props.allegroConnection}
          profiles={props.allegroListingProfiles}
          categories={props.allegroLearnedCategories}
          active={part}
          onOpen={choosePart}
        />
      );
    case "delcampe":
      return (
        <DelcampeSummary
          profiles={props.delcampeListingProfiles}
          categories={props.delcampeLearnedCategories}
          active={part}
          onOpen={choosePart}
        />
      );
    default:
      return undefined;
  }
}

interface FieldTarget {
  entry: SettingsEntryKey;
  part: string | null;
  label: string;
  kind: SettingsFieldMatch["kind"];
  nonce: number;
}

/** About two seconds at sixty frames. */
const FIELD_LOOKUP_FRAMES = 120;

/**
 * The element on the open page that shows `label`. The index holds the page's own words
 * (`settings-search.ts`, pinned to each page's source by its test), so the field is found by what it
 * says rather than by an anchor every page would have to carry. A label that is only an
 * `aria-label` — a control with no visible caption — is the fallback.
 */
function findField(root: HTMLElement, target: FieldTarget): HTMLElement | null {
  const want = normalizeSettingsText(target.label);
  const visible = (el: Element) => el.getClientRects().length > 0;
  if (target.kind === "part") {
    return (
      Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (el) => normalizeSettingsText(el.textContent ?? "") === want
      ) ?? null
    );
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !visible(el)) continue;
    if (
      normalizeSettingsText(node.nodeValue ?? "") === want ||
      normalizeSettingsText(el.textContent ?? "") === want
    ) {
      return el;
    }
  }
  return findLabelled(root, target.label);
}

/** The visible control under `root` whose `aria-label` is `label`. */
function findLabelled(root: HTMLElement, label: string): HTMLElement | null {
  const want = normalizeSettingsText(label);
  return (
    Array.from(root.querySelectorAll<HTMLElement>("[aria-label]")).find(
      (el) =>
        el.getClientRects().length > 0 &&
        normalizeSettingsText(el.getAttribute("aria-label") ?? "") === want
    ) ?? null
  );
}

/**
 * Scroll to the field and mark it for a moment (#1470). A card whose title the label is — Base
 * currency, a retention period — is marked whole, since the card *is* the setting; a heading over a
 * run of panels is marked alone, or the mark would light up the rest of the page with it.
 */
function markField(el: HTMLElement, root: HTMLElement, label: string) {
  const want = normalizeSettingsText(label);
  let marked = el;
  const card = el.parentElement?.closest("section, fieldset");
  if (
    card instanceof HTMLElement &&
    root.contains(card) &&
    normalizeSettingsText(card.textContent ?? "").startsWith(want)
  ) {
    marked = card;
  }
  scrollIntoView(marked, { block: "center" });
  // Restart the mark when the same field is picked again while it is still showing.
  marked.classList.remove(FIELD_FLASH);
  void marked.offsetWidth;
  marked.classList.add(FIELD_FLASH);
  marked.addEventListener("animationend", () => marked.classList.remove(FIELD_FLASH), {
    once: true,
  });
}

const FIELD_FLASH = "field-arrival-flash";

/**
 * The navigation (#1465): a vertical list beside the content, as in the Page template dialog
 * (#1453), with **every group always open** — the sidebar's sections collapse (#762), but a list a
 * collector opens to *find* something should not hide half of it. It scrolls on its own when the
 * window is short. The group headings speak in the sidebar's tints, so a group reads as the part of
 * the app it configures.
 *
 * The search above it (#1470) narrows the same list rather than opening a second one: the entries
 * that match keep their group and their place, and under each is the field or tab that matched,
 * which opens the page at it.
 */
function SettingsNav({
  activeKey,
  pathname,
  appVersion,
  appReleaseDate,
  query,
  onQuery,
  matches,
  onPick,
}: {
  activeKey: string;
  pathname: string;
  appVersion: string;
  appReleaseDate: string | null;
  query: string;
  onQuery: (query: string) => void;
  /** Null while nothing is typed: the whole list. */
  matches: SettingsMatch[] | null;
  onPick: (entry: SettingsEntryKey, field: SettingsFieldMatch | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shownGroups = matches
    ? SETTINGS_GROUPS.filter((g) => matches.some((m) => m.entry.group === g.key))
    : SETTINGS_GROUPS;

  return (
    <nav
      aria-label="Settings"
      style={{
        flex: "0 0 13rem",
        position: "sticky",
        top: NAV_TOP,
        maxHeight: `calc(100vh - 2 * ${NAV_TOP})`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TextInput
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Clears first; a second Escape on an empty field leaves it.
            e.preventDefault();
            if (query) onQuery("");
            else inputRef.current?.blur();
          } else if (e.key === "Enter" && matches && matches.length > 0) {
            e.preventDefault();
            const first = matches[0];
            onPick(first.entry.key, first.fields[0] ?? null);
          }
        }}
        placeholder="Find a setting…"
        aria-label="Find a setting by name"
        autoComplete="off"
        style={{
          width: "100%",
          boxSizing: "border-box",
          marginBottom: "1rem",
          padding: "0.375rem 0.625rem",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          fontSize: "0.875rem",
          color: "var(--color-text-primary)",
          background: "var(--color-bg-elevated)",
        }}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {matches && matches.length === 0 && (
          <p
            style={{
              margin: 0,
              padding: "0 0.75rem",
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
            }}
          >
            No setting is called that.
          </p>
        )}
        {shownGroups.map((group, i) => (
          <SettingsNavGroup
            key={group.key}
            group={group}
            first={i === 0}
            activeKey={activeKey}
            pathname={pathname}
            matches={matches}
            onPick={onPick}
          />
        ))}
      </div>
      {/* The running build is not a setting of the collection (#1469), so it is a line at the foot
          of the list rather than a card among the settings. */}
      <p
        style={{
          margin: "0.75rem 0 0",
          padding: "0.75rem 0.75rem 0",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
        }}
      >
        Stamporama <AppVersionLabel version={appVersion} releaseDate={appReleaseDate} />
      </p>
    </nav>
  );
}

function SettingsNavGroup({
  group,
  first,
  activeKey,
  pathname,
  matches,
  onPick,
}: {
  group: SettingsGroup;
  first: boolean;
  activeKey: string;
  pathname: string;
  matches: SettingsMatch[] | null;
  onPick: (entry: SettingsEntryKey, field: SettingsFieldMatch | null) => void;
}) {
  const router = useRouter();
  const { guard } = useLeaveGuard();
  // Outside the app's sections (General, System) the active row is the accent's, as Overview's and
  // the footer's are in the sidebar.
  const hue = group.tint ? `var(--color-tag-${group.tint})` : "var(--color-accent)";
  const plate = group.tint ? `var(--color-tag-${group.tint}-soft)` : "var(--color-bg-muted)";
  const rows = matches
    ? matches.filter((m) => m.entry.group === group.key)
    : settingsEntriesOf(group.key).map((entry) => ({ entry, fields: [] }));
  return (
    <div>
      <p
        style={{
          margin: 0,
          padding: `${first ? "0" : "1rem"} 0.75rem 0.375rem`,
          fontSize: "0.75rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: group.tint ? hue : "var(--color-text-muted)",
        }}
      >
        {group.label}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map(({ entry, fields }) => {
          const active = entry.key === activeKey;
          const href = `${pathname}${settingsSearch(new URLSearchParams(), entry.key, null)}`;
          return (
            <li key={entry.key}>
              <Link
                href={href}
                onClick={(e) => {
                  // A plain click leaves through the guard; a modified one opens a new tab and
                  // leaves nothing behind, so it goes straight through.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  guard(() => router.push(href));
                }}
                aria-current={active ? "page" : undefined}
                style={{
                  display: "block",
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 400,
                  textDecoration: "none",
                  color: active ? hue : "var(--color-text-secondary)",
                  background: active ? plate : "transparent",
                  boxShadow: active ? `inset 2px 0 0 ${hue}` : undefined,
                }}
              >
                {entry.label}
              </Link>
              {fields.length > 0 && (
                <ul style={{ listStyle: "none", margin: "0 0 0.25rem", padding: 0 }}>
                  {fields.map((field) => (
                    <li key={`${field.part ?? ""}:${field.label}`}>
                      {/* A link as well as a pick: it is a place, so it opens in a new tab like
                          any other, and the click is what carries the collector to the field. */}
                      <Link
                        href={`${pathname}${settingsSearch(new URLSearchParams(), entry.key, field.part)}`}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                          e.preventDefault();
                          onPick(entry.key, field);
                        }}
                        style={{
                          display: "block",
                          padding: "0.1875rem 0.75rem 0.1875rem 1.5rem",
                          fontSize: "0.8125rem",
                          textDecoration: "none",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {field.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What one entry holds — today's panels, unchanged, until each page's own issue reshapes it. */
function SettingsEntryBody({
  entryKey,
  part,
  collectionId,
  collectionName,
  baseCurrency,
  defaultLanguage,
  collectionSlug,
  initialAreas,
  titleLanguages,
  initialTree,
  initialConditions,
  initialFormats,
  initialFormatFactors,
  initialCertificateStatuses,
  initialSubtypes,
  initialAttributes,
  initialStampSizePresets,
  initialTags,
  initialCollageTemplates,
  initialRefCardTemplates,
  initialHawidStrips,
  initialAlbumTemplates,
  initialCarriers,
  initialColnectMappings,
  initialColnectConditionMappings,
  initialColnectListMappings,
  colnectPlatformId,
  allegroPlatformId,
  allegroConnection,
  allegroListingProfiles,
  allegroLearnedCategories,
  delcampePlatformId,
  delcampeListingProfiles,
  delcampeLearnedCategories,
  philasearchPlatformId,
  platformContacts,
  initialAssistantTokens,
  mailSettings,
  auctionReminder,
  itemNoPad,
  bidFloorPercent,
  bidCeilingPercent,
  bidFallbackPercent,
  closedOfferPhotoTtl,
  instanceClosedOfferPhotoTtlLabel,
  scanSheetTtl,
  instanceScanSheetTtlLabel,
  initialScanningProfiles,
  duplicateCatalogMode,
  photoStorageBytes,
  storageCache,
}: SettingsScreenProps & { entryKey: string; part: string | null }) {
  switch (entryKey as SettingsEntryKey) {
    case "general":
      return (
        <CollectionSettingsPanel
          collectionId={collectionId}
          collectionName={collectionName}
          baseCurrency={baseCurrency}
          defaultLanguage={defaultLanguage}
          itemNoPad={itemNoPad}
        />
      );
    case "storage":
      return (
        <StorageSettingsPanel
          collectionId={collectionId}
          closedOfferPhotoTtl={closedOfferPhotoTtl}
          instanceClosedOfferPhotoTtlLabel={instanceClosedOfferPhotoTtlLabel}
          scanSheetTtl={scanSheetTtl}
          instanceScanSheetTtlLabel={instanceScanSheetTtlLabel}
          photoStorageBytes={photoStorageBytes}
          storageCache={storageCache}
        />
      );
    case "catalogs":
      return <CatalogPanel collectionId={collectionId} initialTree={initialTree} />;
    case "conditions":
      return (
        <ConditionsPanel
          collectionId={collectionId}
          initialConditions={initialConditions}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "certificates":
      return (
        <CertificateStatusesPanel
          collectionId={collectionId}
          initialStatuses={initialCertificateStatuses}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "formats":
      // Formats and their multipliers are one thing (#1469): a multiplier is a format's worth, set
      // per area and condition, so the two are tabs of one entry rather than two entries.
      return part === "multipliers" ? (
        <FormatFactorsPanel
          collectionId={collectionId}
          initialFactors={initialFormatFactors}
          formats={initialFormats}
          conditions={initialConditions}
          areas={initialAreas}
        />
      ) : (
        <FormatsPanel
          collectionId={collectionId}
          initialFormats={initialFormats}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "subtypes":
      return (
        <SubtypesPanel
          collectionId={collectionId}
          initialSubtypes={initialSubtypes}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    case "attributes": {
      // The four attribute dictionaries are one subject (#72) — what a catalogue says about a
      // stamp — so they are tabs of one entry. Keyed on the kind, so each tab is its own list.
      const kind = (STAMP_ATTRIBUTE_KINDS as readonly string[]).includes(part ?? "")
        ? (part as StampAttributeKind)
        : STAMP_ATTRIBUTE_KINDS[0];
      return (
        <AttributeDictionaryPanel
          key={kind}
          collectionId={collectionId}
          kind={kind}
          initialRows={initialAttributes[kind]}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
        />
      );
    }
    case "size-presets":
      // An entry of its own rather than a fifth tab of Attributes (#1469): a preset is a saved pair
      // of millimetres copied onto a stamp (#804; ADR-0048 §8), not a value a stamp refers to.
      return (
        <StampSizePresetsPanel collectionId={collectionId} initialPresets={initialStampSizePresets} />
      );
    case "duplicates":
      return (
        <DuplicatesPanel
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          initialMode={duplicateCatalogMode}
        />
      );
    case "scanning":
      return (
        <ScanningProfilesPanel collectionId={collectionId} initialProfiles={initialScanningProfiles} />
      );
    case "tags":
      return <TagsPanel collectionId={collectionId} initialTags={initialTags} />;
    case "album-templates":
      return (
        <AlbumTemplatesPanel collectionId={collectionId} initialTemplates={initialAlbumTemplates} />
      );
    case "hawid-stock":
      return <HawidStockPanel collectionId={collectionId} initialStrips={initialHawidStrips} />;
    case "ornaments":
      return <AlbumOrnamentsPanel collectionId={collectionId} />;
    case "refcards":
      return (
        <RefCardTemplatesPanel
          collectionId={collectionId}
          initialTemplates={initialRefCardTemplates}
        />
      );
    case "collages":
      return (
        <CollageTemplatesPanel
          collectionId={collectionId}
          initialTemplates={initialCollageTemplates}
        />
      );
    case "shipping":
      // Carriers are the collection's, while the price list they are named on is each platform's
      // (#468/#491) — a marketplace quotes the postage, a carrier moves the parcel and tracks it the
      // same way whichever marketplace it came from.
      return <CarriersPanel collectionId={collectionId} initialCarriers={initialCarriers} />;
    case "allegro":
      return (
        <AllegroSettingsBody
          part={part}
          collectionId={collectionId}
          platforms={platformContacts}
          platformId={allegroPlatformId}
          connection={allegroConnection}
          profiles={allegroListingProfiles}
          categories={allegroLearnedCategories}
        />
      );
    case "delcampe":
      return (
        <DelcampeSettingsBody
          part={part}
          collectionId={collectionId}
          platforms={platformContacts}
          platformId={delcampePlatformId}
          profiles={delcampeListingProfiles}
          categories={delcampeLearnedCategories}
        />
      );
    case "philasearch":
      // The whole page (#742): a marketplace this collection only bids on needs nothing else.
      return (
        <PhilasearchPlatformPanel
          collectionId={collectionId}
          platforms={platformContacts}
          selectedId={philasearchPlatformId}
        />
      );
    case "acceptance":
      // Written entirely in the Catalog group's three vocabularies — condition, certificate, format
      // (#533) — and it reads its own list client-side, being the same query the want form's picker
      // reads.
      return <AcceptanceProfilesPanel collectionId={collectionId} />;
    case "bids":
      return (
        <BidRecommendationPanel
          collectionId={collectionId}
          bidFloorPercent={bidFloorPercent}
          bidCeilingPercent={bidCeilingPercent}
          bidFallbackPercent={bidFallbackPercent}
        />
      );
    case "auction-reminder":
      return <AuctionReminderPanel collectionId={collectionId} settings={auctionReminder} />;
    case "colnect":
      return (
        <section>
          {/* Which platform is Colnect (#406) leads the page: the mappings below it only ever
              matter for offers headed there, and it is what switches the listing checks on. */}
          <h3 style={sectionHeadingStyle}>Colnect platform</h3>
          <ColnectPlatformPanel
            collectionId={collectionId}
            platforms={platformContacts}
            selectedId={colnectPlatformId}
          />

          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect catalog mapping</h3>
          <ColnectPanel
            collectionId={collectionId}
            initialMappings={initialColnectMappings}
            vendors={initialTree.map((v) => ({
              id: v.id,
              name: v.name,
              abbreviation: v.abbreviation,
            }))}
          />

          {/* The condition side of the same translation (#404): our grades → Colnect's fixed five.
              Same page as the catalog mapping because they answer one question — what our
              vocabulary is called on Colnect — and are set up in one sitting. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect condition mapping</h3>
          <ColnectConditionsPanel mappings={initialColnectConditionMappings} />

          {/* The third form of the same translation (#739): our four attribute dictionaries →
              the words Colnect prints. A field rather than a select, Colnect's side being open text
              — there is no list of every colour it names — and beside the two above it because a
              collector sets all three up in one sitting, looking at one catalogue page. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect attribute mapping</h3>
          <ColnectAttributesPanel lists={initialAttributes} />

          {/* The fourth translation on the page (#684), and the one that reads in the other
              direction: the two above say what our vocabulary is called on Colnect, this says what
              a list *of theirs* is a list of here. Last because it is what the export → compare →
              fix loop (#685–#690) is configured with, and that loop presupposes the rest. */}
          <h3 style={{ ...sectionHeadingStyle, marginTop: "2rem" }}>Colnect list sync</h3>
          <ColnectListsPanel collectionId={collectionId} mappings={initialColnectListMappings} />
        </section>
      );
    case "assistant":
      return (
        <AssistantPanel
          collectionId={collectionId}
          collectionName={collectionName}
          initialTokens={initialAssistantTokens}
        />
      );
    case "email":
      return <EmailPanel collectionId={collectionId} settings={mailSettings} />;
    default: {
      // Every entry has a body: a new one in `settings-nav.ts` without a case here does not compile.
      const unreachable: never = entryKey as never;
      return unreachable;
    }
  }
}
