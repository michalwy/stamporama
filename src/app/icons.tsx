/**
 * The app's **one** icon vocabulary (#459; ADR-0030).
 *
 * Every icon on screen comes from here, named for **what it means** rather than for the picture it
 * happens to be — `"edit"`, not `"pencil"`. That is what makes a change of picture a one-line edit
 * in this file instead of a sweep over two hundred call sites, and it is why a surface cannot
 * quietly invent a second glyph for an act the app already has one for: an unknown name does not
 * type-check.
 *
 * The drawings are lucide's. Nothing else in the app imports `lucide-react` — a screen that reached
 * past this module could pick any size, weight and picture it liked, which is the state #459 was
 * filed about.
 *
 * Conventions, all applied here rather than at the call site:
 *
 * - **Size** is one of five steps, never a free number. `md` (16px) is the default and is what a
 *   button, a nav entry or a card header uses; `sm` (14px) is for a menu entry, a chip or a dense
 *   inline marker, `xs` (12px) for a caret inside a small control, `lg` (18px) where an icon leads
 *   a heading, `xl` (24px) for an empty state.
 * - **Stroke** is `1.75` everywhere. Lucide's own default of `2` reads heavy beside this app's
 *   text, and a per-icon weight is exactly the inconsistency being removed.
 * - **Colour** is inherited (`currentColor`): an icon takes the colour of the control it sits in,
 *   so the danger/muted/accent decisions stay with the surface that already makes them. Pass
 *   `color` only where the icon carries a meaning its container does not — a warning marker beside
 *   plain text.
 * - **Alignment** is decided here too, and only once: every icon is an `inline-block` nudged onto
 *   the text's optical centre, so the same element drops into a sentence, a chip and a flex row
 *   without the call site knowing which it is. (A flex row ignores the nudge, which is why one
 *   rule can serve both.)
 * - Icons are **decorative by default** (`aria-hidden`): the control around them carries the label.
 *   An icon that is the control's *only* content needs an `aria-label` on the control itself.
 */
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ArrowUpToLine,
  Ban,
  Banknote,
  Bell,
  Boxes,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Coins,
  Columns2,
  Copy,
  CopyPlus,
  CornerDownRight,
  CornerRightUp,
  Crosshair,
  Dices,
  Diamond,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Flag,
  Eye,
  EyeOff,
  Gavel,
  Globe,
  GripVertical,
  Group,
  HandCoins,
  House,
  ImageOff,
  Layers,
  Lightbulb,
  Link2,
  List,
  Lock,
  LockOpen,
  LogOut,
  MapPin,
  Menu,
  Merge,
  Minus,
  Package,
  Pause,
  Percent,
  Pencil,
  Play,
  Plus,
  Printer,
  Receipt,
  Rows2,
  Rows3,
  RotateCcw,
  RotateCw,
  Ruler,
  Scale,
  ScanLine,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  SquarePlus,
  Stamp,
  Star,
  StickyNote,
  Tag,
  Trash2,
  TriangleAlert,
  Truck,
  Undo2,
  Upload,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The vocabulary. Keys are the app's own words for a meaning; values are the drawing.
 *
 * Where two meanings deliberately share a drawing they still get **two names** — `close` and
 * `clear` are both an ✕ and are not the same act, and `auctions` / `bidding` are one subject seen
 * from a nav entry and from a row action. Naming them apart is what lets one of them change later.
 */
const GLYPHS = {
  // Navigation — the sidebar's subjects.
  overview: House,
  issues: Rows3,
  stamps: Stamp,
  inventory: Layers,
  locations: MapPin,
  offers: Tag,
  sales: Banknote,
  purchases: ShoppingBag,
  /** What the collection is looking for but does not have (#532) — the want list. A crosshair, not
   *  a magnifier: `search` is the act of finding something already recorded, while this marks a
   *  thing being *aimed at*. */
  wants: Crosshair,
  auctions: Gavel,
  contacts: Users,
  settings: Settings,
  signOut: LogOut,
  collections: Boxes,
  notifications: Bell,

  // The everyday verbs.
  add: Plus,
  remove: Minus,
  edit: Pencil,
  delete: Trash2,
  /** Dismisses a surface — a dialog, a popup, a card. */
  close: X,
  /** Empties the field it sits in (#446's auxiliary control). */
  clear: X,
  /** Confirms, or marks a state reached. */
  check: Check,
  /** Rejects, beside a `check` that accepts. */
  reject: X,
  /** Re-derives something the app generated — a text, a category, a bid. */
  refresh: RotateCw,
  /** Puts a state back the way it was: reopen a lot, bring a disposed copy back. */
  restore: RotateCcw,
  /** Steps a lifecycle *backwards* — an offer back to preparing. */
  revert: Undo2,
  /** Goes to this thing's own screen, inside the app. */
  open: ArrowUpRight,
  /** Leaves the app — a listing on its marketplace, a transaction on its platform. */
  externalLink: ExternalLink,
  /** Ties two records together here. */
  link: Link2,
  copy: Copy,
  /** Makes a second one — the same offer on another platform. */
  duplicate: CopyPlus,
  /** Adds copies of a stamp already on the row. Deliberately not `add`: promoted onto a row it
   * sits beside *Add stamp*, and two identical plus signs name neither (#125). */
  addCopies: CopyPlus,
  print: Printer,
  move: ArrowLeftRight,
  merge: Merge,
  /** Re-derives a declared range from what is inside it. */
  range: Ruler,
  /** Hand-sorted order, and the way back to the derived one. */
  reorder: ArrowUpDown,
  /** Copies a figure into the field above it. */
  copyUpwards: CornerRightUp,
  /** Takes the value from the level above instead of stating one. */
  inherit: CornerDownRight,

  // Controls that are the same everywhere.
  /** The single `⋮` row-action trigger. */
  rowActions: EllipsisVertical,
  /** A horizontal `⋯`, for a control that opens more of the same. */
  more: Ellipsis,
  /** A read-only list opened over the current screen. */
  list: List,
  /** Goes looking for something, where `externalLink` goes to a page already known (#441). */
  search: Search,
  /** A grouping mode on a list. */
  group: Group,
  /** What is inside something — a lot's composition. */
  contents: Menu,
  expand: ChevronRight,
  collapse: ChevronDown,
  /** The caret on a control that opens a menu. */
  caret: ChevronDown,
  next: ChevronRight,
  previous: ChevronLeft,
  /** Folds a side panel away; `expand` brings it back. */
  hidePanel: ChevronLeft,
  /** Drag handle on a reorderable row. */
  dragGrip: GripVertical,
  /** Moves something up a hand-sorted order, or into the leading slot. */
  promote: ArrowUp,

  // Markers — an icon that says something about the thing beside it.
  warning: TriangleAlert,
  suggestion: Lightbulb,
  date: Calendar,
  notes: StickyNote,
  location: MapPin,
  shipping: Truck,
  parcel: Package,
  receipt: Receipt,
  /** Money changing hands: sell an offer, a copy already sold. */
  sell: HandCoins,
  /** Bidding is running on this. */
  bidding: Gavel,
  /** What a lot came to: closed at a price, or cancelled. */
  settle: Flag,
  /** Called off — the lot never ran (#354). Same drawing as `disposed`, a different fact. */
  cancelled: CircleSlash,
  /** The auction sale (parcel) a record belongs to. */
  auctionSale: Scale,
  /** The default of a set — a main photo, the profile every listing uses. */
  primary: Star,
  visible: Eye,
  hidden: EyeOff,
  /** Stands in for a photo that was never taken, in an empty thumbnail slot. */
  noPhoto: ImageOff,
  /** Left the collection other than by being sold (#394). */
  disposed: CircleSlash,
  /** Deliberately not offered here (#506). */
  excluded: Ban,
  locked: Lock,
  unlocked: LockOpen,
  /** Per-language texts (#293–#296). */
  translations: Globe,
  /** Catalogue values recorded for a stamp. */
  prices: Coins,
  /** The per-format multipliers a value is scaled by (ADR-0020). */
  factors: Percent,
  /** Picks a different example at random. */
  random: Dices,
  /** A stamp's own subject, where a *stamp* is one thing among others. */
  stamp: Stamp,
  /** A variant to be identified (#338–#342). */
  variant: Diamond,

  // Offer lifecycle and the marketplaces.
  /** Puts a prepared offer live. */
  activate: Upload,
  pause: Pause,
  resume: Play,
  withdraw: ArrowLeftToLine,
  /** Posts to the marketplace itself. */
  publish: ShoppingCart,
  /** The Assistant extension does this part (#253). */
  assistant: Zap,
  /** Puts the copies into an offer that already exists. */
  addToOffer: Tag,
  /** Starts a new offer from them. */
  newOffer: SquarePlus,
  // Scan sheet ingest (#566). `merge` above is the other half of the pair — merging two boxes that
  // halved one stamp is the same act as merging anything else, so it does not get a second name.
  /** A retained card scan, and the act of adding one. */
  scan: ScanLine,
  /** Cut one box into a left and a right — two touching stamps taken for one, side by side. */
  splitColumns: Columns2,
  /** …and into a top and a bottom. */
  splitRows: Rows2,

  /** Fills a bid box with a figure the row already knows — a ceiling, upwards. */
  bidCeiling: ArrowUpToLine,
  /** …and a catalogue value, downwards. */
  bidCatalog: ArrowDownToLine,
} satisfies Record<string, LucideIcon>;

/** Every meaning the app has an icon for. An unknown name is a type error, deliberately. */
export type IconName = keyof typeof GLYPHS;

/** The five steps. A size outside this scale is what made icons look hand-placed (#459). */
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
} as const;

export type IconSize = keyof typeof ICON_SIZE;

/** One weight for every icon, everywhere. */
export const ICON_STROKE = 1.75;

export function Icon({
  name,
  size = "md",
  color,
  title,
  style,
}: {
  name: IconName;
  size?: IconSize;
  /** Only where the icon means something its container's colour does not. */
  color?: string;
  /** Makes the icon meaningful to assistive tech, for the rare marker that is not decorative. */
  title?: string;
  /** Layout only — margins and alignment. Sizing and colour belong to the props above. */
  style?: React.CSSProperties;
}) {
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      size={ICON_SIZE[size]}
      strokeWidth={ICON_STROKE}
      color={color}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
      // Never squeezed by the flex row it often sits in, and never a source of extra line height.
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "-0.15em", ...style }}
    />
  );
}
