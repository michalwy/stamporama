// A corner ornament, read out of an SVG file into a drawing the album can print (#1427).
//
// **Pure.** No Prisma, no PDF library, no React — the same rule `album-layout.ts` follows. The
// upload route reads a file through this, the built-in set is written through this, and both the
// PDF (#768) and the canvas (#769) draw what comes out of it.
//
// ## Read once, into one shape, and never drawn as SVG again
//
// The file the collector uploads is not what gets printed, and it is never handed to a browser. It
// is read here into an {@link AlbumOrnamentDrawing}: a list of paths in the drawing's own
// coordinates, every one written with four commands — move, line, cubic curve, close — and every
// transform already applied to the points. Shapes become paths, arcs and quadratics become cubics,
// relative coordinates become absolute. That is what makes the PDF and the screen one drawing
// rather than two readings of a file:
//
// - pdf-lib is handed exactly these four operators and a fill rule, which it cannot misread;
// - the canvas draws the same numbers as `<path>` elements, and nothing the collector uploaded
//   reaches the page as markup — no script, no external reference, no stylesheet;
// - a printed card copies the drawing into its snapshot (ADR-0047 §1), so a reprint a year later
//   draws the same corners whatever has happened to the file since.
//
// ## A subset, refused loudly outside it
//
// An ornament is ink on paper: filled and stroked outlines in solid colours. The reader takes the
// shapes and paint that describes — paths, rectangles, circles, ellipses, lines, polylines and
// polygons, in groups with transforms, painted by attribute, inline style or a stylesheet of class
// rules — and refuses what it would otherwise have to guess at: text, embedded pictures, `<use>`,
// gradients and patterns, clipping, masks, filters, dashes and anything partly transparent. A
// refusal names the thing, because a corner that printed without its gradient would be wrong in a
// way the collector only finds on the card (ADR-0046 §5 is the same rule for faces).
//
// Things that draw nothing are passed over rather than refused: titles, metadata, the editor's own
// namespaced elements, and the contents of `<defs>` — which only draw through a reference, and a
// reference is refused where it is made.
//
// The XML reader is hand-rolled and deliberately small (ADR-0057): it reads elements, attributes,
// text, comments, CDATA and a DOCTYPE, and expands no entity beyond the five XML predefines and
// character references, so a file cannot make it do more work than its own length.

/** One step of an outline, in the drawing's own coordinates. Four commands and no others. */
export type AlbumPathCommand =
  | ["M", number, number]
  | ["L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Z"];

export interface AlbumOrnamentPath {
  commands: AlbumPathCommand[];
  /** `#rrggbb`, or null for an outline that is not filled. */
  fill: string | null;
  fillRule: "nonzero" | "evenodd";
  /** `#rrggbb`, or null for an outline that is not stroked. */
  stroke: string | null;
  /** In the drawing's own units, with the element's transform already applied. */
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
}

/** A corner ornament, drawn for the **top-left** corner. The other three are mirrors of it. */
export interface AlbumOrnamentDrawing {
  /** The drawing's frame. Its point (0, 0) is laid on the corner of the frame's centre line, so a
   *  frame that starts at 0 0 sits wholly inside the page and one with negative x or y reaches
   *  outwards past the rule. */
  viewBox: { x: number; y: number; width: number; height: number };
  paths: AlbumOrnamentPath[];
}

/** Thrown for a file this reader will not turn into a drawing. The message reaches the collector.
 *
 *  `reason` is set where the file is a perfectly good SVG this reader chooses not to follow — a
 *  gradient, transparency, text — as a phrase that completes *"the drawing …"*. A free page's picture
 *  (#1429) reads SVG through this same reader and prints such a file as a picture instead of refusing
 *  it, and says why in those words rather than in a corner ornament's. Absent on a file that cannot
 *  be read at all. */
export class AlbumOrnamentSvgError extends Error {
  constructor(
    message: string,
    readonly reason?: string
  ) {
    super(message);
  }
}

/** Refuse a file that is not worth reading before a byte of it is parsed. An ornament is a few
 *  kilobytes; a megabyte is a scanned picture wrapped in SVG or a whole page of clip art. */
export const MAX_ORNAMENT_SVG_BYTES = 1024 * 1024;

/** Ceilings on what one drawing may hold, so a pathological file costs a refusal rather than a
 *  megabyte of JSON on every printed card that copies it. */
const MAX_PATHS = 4000;
const MAX_COMMANDS = 120_000;
const MAX_DEPTH = 64;

/** Four decimals of a drawing unit: well under a thousandth of a millimetre at any size a corner is
 *  printed at, and it keeps a stored drawing compact. */
const round = (n: number) => Math.round(n * 10_000) / 10_000;

// ── XML ──────────────────────────────────────────────────────────────────────

interface XmlElement {
  name: string;
  attrs: Map<string, string>;
  children: XmlElement[];
  text: string;
}

function notSvg(detail?: string): AlbumOrnamentSvgError {
  return new AlbumOrnamentSvgError(
    detail ? `This file is not a readable SVG drawing: ${detail}.` : "This file is not a readable SVG drawing."
  );
}

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (whole, body: string) => {
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "amp") return "&";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    const code = body.startsWith("#x") ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** The element tree of an XML document — elements, attributes and text, nothing else. */
function parseXml(source: string): XmlElement {
  let i = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const n = source.length;

  const skipPast = (marker: string, what: string) => {
    const at = source.indexOf(marker, i);
    if (at < 0) throw notSvg(`an unterminated ${what}`);
    i = at + marker.length;
  };

  while (i < n) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i);
      const end = next < 0 ? n : next;
      if (stack.length > 0) stack[stack.length - 1].text += decodeEntities(source.slice(i, end));
      else if (source.slice(i, end).trim() && root === null) throw notSvg();
      i = end;
      continue;
    }
    if (source.startsWith("<?", i)) {
      skipPast("?>", "processing instruction");
      continue;
    }
    if (source.startsWith("<!--", i)) {
      skipPast("-->", "comment");
      continue;
    }
    if (source.startsWith("<![CDATA[", i)) {
      const start = i + 9;
      skipPast("]]>", "CDATA section");
      if (stack.length > 0) stack[stack.length - 1].text += source.slice(start, i - 3);
      continue;
    }
    if (source.startsWith("<!", i)) {
      // A DOCTYPE, possibly with an internal subset in brackets. Nothing in it is read — in
      // particular no entity it declares is ever expanded.
      let depth = 0;
      i += 2;
      while (i < n) {
        const c = source[i];
        if (c === "[") depth += 1;
        else if (c === "]") depth -= 1;
        else if (c === ">" && depth <= 0) break;
        i += 1;
      }
      if (i >= n) throw notSvg("an unterminated declaration");
      i += 1;
      continue;
    }
    if (source.startsWith("</", i)) {
      const end = source.indexOf(">", i);
      if (end < 0) throw notSvg("an unterminated closing tag");
      const name = source.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw notSvg(`a closing </${name}> that closes nothing`);
      i = end + 1;
      continue;
    }

    // An opening tag.
    i += 1;
    const nameMatch = /^[^\s/>]+/.exec(source.slice(i, i + 256));
    if (!nameMatch) throw notSvg("a tag with no name");
    const element: XmlElement = { name: nameMatch[0], attrs: new Map(), children: [], text: "" };
    i += nameMatch[0].length;
    let selfClosing = false;
    for (;;) {
      while (i < n && /\s/.test(source[i])) i += 1;
      if (i >= n) throw notSvg("an unterminated tag");
      if (source[i] === ">") {
        i += 1;
        break;
      }
      if (source.startsWith("/>", i)) {
        i += 2;
        selfClosing = true;
        break;
      }
      const attrMatch = /^[^\s=/>]+/.exec(source.slice(i, i + 256));
      if (!attrMatch) throw notSvg("a malformed attribute");
      i += attrMatch[0].length;
      while (i < n && /\s/.test(source[i])) i += 1;
      if (source[i] !== "=") throw notSvg(`an attribute "${attrMatch[0]}" with no value`);
      i += 1;
      while (i < n && /\s/.test(source[i])) i += 1;
      const quote = source[i];
      if (quote !== '"' && quote !== "'") throw notSvg(`an unquoted attribute "${attrMatch[0]}"`);
      const close = source.indexOf(quote, i + 1);
      if (close < 0) throw notSvg("an unterminated attribute value");
      element.attrs.set(attrMatch[0], decodeEntities(source.slice(i + 1, close)));
      i = close + 1;
    }

    if (stack.length > 0) stack[stack.length - 1].children.push(element);
    else if (root === null) root = element;
    else throw notSvg("more than one top-level element");
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) throw notSvg("elements nested too deeply");
      stack.push(element);
    }
  }
  if (stack.length > 0) throw notSvg(`an unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw notSvg();
  return root;
}

/** An element's name without its prefix, or null for one in another vocabulary (an editor's own
 *  `sodipodi:namedview`, say). `svg:` is SVG spelled with a prefix. */
function localName(name: string): string | null {
  const colon = name.indexOf(":");
  if (colon < 0) return name;
  return name.slice(0, colon) === "svg" ? name.slice(colon + 1) : null;
}

// ── Numbers, lengths, transforms ─────────────────────────────────────────────

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m1 ∘ m2`: apply `m2`, then `m1`. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function numbers(raw: string, what: string): number[] {
  const cleaned = raw.trim();
  if (!cleaned) return [];
  const found = cleaned.match(NUMBER) ?? [];
  // Everything that is not a number must be a separator, or the list is not one.
  if (cleaned.replace(NUMBER, "").replace(/[\s,]/g, "") !== "") throw notSvg(`a malformed ${what}`);
  return found.map(Number);
}

/** A length in user units: a plain number or pixels. A geometry attribute in millimetres or
 *  percentages would need a viewport this reader does not have, so it is refused rather than
 *  approximated. */
function userLength(raw: string | undefined, what: string, fallback = 0): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px)?\s*$/.exec(raw);
  if (!m) throw new AlbumOrnamentSvgError(`The drawing gives ${what} as "${raw.trim()}"; only plain numbers can be read.`);
  return Number(m[1]);
}

/** The root's width or height, which may carry a unit — used only to stand in for a missing
 *  `viewBox`, where only the proportion and the number matter. */
function rootLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /^\s*((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|mm|cm|in|pt|pc)?\s*$/.exec(raw);
  if (!m) return null;
  const factor = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16 }[m[2] ?? "px"] ?? 1;
  return Number(m[1]) * factor;
}

function parseTransform(raw: string | undefined): Matrix {
  if (!raw || !raw.trim()) return IDENTITY;
  let m = IDENTITY;
  const re = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    consumed = re.lastIndex;
    const args = numbers(match[2], "transform");
    const rad = (deg: number) => (deg * Math.PI) / 180;
    let step: Matrix;
    switch (match[1]) {
      case "matrix":
        if (args.length !== 6) throw notSvg("a malformed transform");
        step = args as Matrix;
        break;
      case "translate":
        step = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale":
        step = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = rad(args[0] ?? 0);
        const r: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        if (args.length >= 3) {
          const [cx, cy] = [args[1], args[2]];
          step = multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
        } else step = r;
        break;
      }
      case "skewX":
        step = [1, 0, Math.tan(rad(args[0] ?? 0)), 1, 0, 0];
        break;
      default:
        step = [1, Math.tan(rad(args[0] ?? 0)), 0, 1, 0, 0];
    }
    m = multiply(m, step);
  }
  if (raw.slice(consumed).trim() !== "") throw notSvg("a malformed transform");
  return m;
}

// ── Paint ────────────────────────────────────────────────────────────────────

/** The sixteen colours CSS1 names, plus the three a drawing program writes most. A file naming any
 *  other is refused by name rather than printed in a guess. */
const NAMED_COLOURS: Record<string, string> = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  grey: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  dimgray: "#696969",
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** A colour as `#rrggbb`, `null` for none, or `"currentColor"`. */
function parseColour(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === "none" || v === "transparent") return null;
  if (v === "currentcolor") return "currentColor";
  if (v.startsWith("url(")) {
    throw new AlbumOrnamentSvgError(
      "The drawing is painted with a gradient or a pattern. A corner ornament prints in solid colours — fill it with one.",
      "is painted with a gradient or a pattern"
    );
  }
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${m[1][0]}${m[1][0]}${m[1][1]}${m[1][1]}${m[1][2]}${m[1][2]}`;
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgb\(\s*([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,]+/).filter(Boolean);
    if (parts.length === 3) {
      const channel = (p: string) => (p.endsWith("%") ? (Number(p.slice(0, -1)) * 255) / 100 : Number(p));
      const rgb = parts.map(channel);
      if (rgb.every(Number.isFinite)) return `#${rgb.map(hex2).join("")}`;
    }
  }
  if (NAMED_COLOURS[v]) return NAMED_COLOURS[v];
  throw new AlbumOrnamentSvgError(`The drawing uses the colour "${raw.trim()}", which cannot be read. Use a hex colour.`);
}

/** What an element's paint resolves to, inherited down the tree as SVG inherits it. */
interface Paint {
  fill: string | null;
  fillRule: "nonzero" | "evenodd";
  stroke: string | null;
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  color: string;
  visible: boolean;
}

const INITIAL_PAINT: Paint = {
  fill: "#000000",
  fillRule: "nonzero",
  stroke: null,
  strokeWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  color: "#000000",
  visible: true,
};

/** Properties that would change the ink and are refused unless they say "nothing". */
const REFUSED_UNLESS_NONE: Record<string, string> = {
  "clip-path": "is clipped",
  mask: "is masked",
  filter: "uses a filter",
  "marker-start": "uses line markers",
  "marker-mid": "uses line markers",
  "marker-end": "uses line markers",
  marker: "uses line markers",
  "stroke-dasharray": "uses dashed lines",
};

/** The properties `inherit` can name, and the part of {@link Paint} each one is. */
const INHERITABLE: Record<string, keyof Paint> = {
  fill: "fill",
  stroke: "stroke",
  color: "color",
  "stroke-width": "strokeWidth",
  "fill-rule": "fillRule",
  "stroke-linecap": "lineCap",
  "stroke-linejoin": "lineJoin",
};

function applyProperty(paint: Paint, parent: Paint, name: string, rawValue: string): void {
  const value = rawValue.replace(/!important\s*$/, "").trim();
  if (value === "inherit") {
    const key = INHERITABLE[name];
    if (key) (paint as unknown as Record<string, unknown>)[key] = parent[key];
    return;
  }
  switch (name) {
    case "fill":
      paint.fill = parseColour(value);
      return;
    case "stroke":
      paint.stroke = parseColour(value);
      return;
    case "color": {
      const c = parseColour(value);
      paint.color = c === null ? parent.color : c === "currentColor" ? parent.color : c;
      return;
    }
    case "stroke-width": {
      if (value.endsWith("%")) {
        throw new AlbumOrnamentSvgError("The drawing gives a line weight as a percentage; give it as a number.");
      }
      paint.strokeWidth = userLength(value, "a line weight", 1);
      return;
    }
    case "fill-rule":
      paint.fillRule = value === "evenodd" ? "evenodd" : "nonzero";
      return;
    case "stroke-linecap":
      paint.lineCap = value === "round" || value === "square" ? value : "butt";
      return;
    case "stroke-linejoin":
      paint.lineJoin = value === "round" || value === "bevel" ? value : "miter";
      return;
    case "opacity":
    case "fill-opacity":
    case "stroke-opacity": {
      const o = value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value);
      if (!Number.isFinite(o) || o < 1) {
        throw new AlbumOrnamentSvgError(
          "Part of the drawing is transparent. A corner ornament prints in solid ink — make every part fully opaque.",
          "is partly transparent"
        );
      }
      return;
    }
    case "display":
      if (value === "none") paint.visible = false;
      return;
    case "visibility":
      paint.visible = value === "visible";
      return;
    case "transform":
      throw new AlbumOrnamentSvgError("The drawing sets a transform in its styles; this reader takes it only as an attribute.");
  }
  const refusal = REFUSED_UNLESS_NONE[name];
  if (refusal && value !== "none" && !(name === "stroke-dasharray" && value === "0")) {
    throw new AlbumOrnamentSvgError(`The drawing ${refusal}, which a corner ornament cannot print.`, refusal);
  }
}

function parseDeclarations(block: string): [string, string][] {
  const out: [string, string][] = [];
  for (const decl of block.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (name && value) out.push([name, value]);
  }
  return out;
}

/** Class rules from the drawing's own `<style>`: `.cls-1 { fill: #231f20 }`, which is how a drawing
 *  program commonly writes its paint. Anything but a list of class selectors is refused, because a
 *  rule this reader would silently not apply is a colour that silently does not print. */
function parseStylesheet(css: string): Map<string, [string, string][]> {
  const rules = new Map<string, [string, string][]>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(text)) !== null) {
    consumed = re.lastIndex;
    const selectors = match[1].trim();
    if (selectors.startsWith("@font-face")) continue;
    const decls = parseDeclarations(match[2]);
    for (const selector of selectors.split(",").map((s) => s.trim())) {
      if (!/^\.[A-Za-z_][\w-]*$/.test(selector)) {
        throw new AlbumOrnamentSvgError(
          `The drawing's stylesheet has a rule for "${selector}"; only class rules can be read.`
        );
      }
      rules.set(selector.slice(1), [...(rules.get(selector.slice(1)) ?? []), ...decls]);
    }
  }
  if (text.slice(consumed).trim() !== "") throw notSvg("a malformed stylesheet");
  return rules;
}

const PRESENTATION_ATTRIBUTES = [
  "fill",
  "stroke",
  "color",
  "stroke-width",
  "fill-rule",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "display",
  "visibility",
  ...Object.keys(REFUSED_UNLESS_NONE),
];

/** The element's paint: its parent's, then its presentation attributes, then class rules, then its
 *  inline style — CSS's order of precedence. `display` is not inherited, and neither is anything
 *  refused, so only the inherited half of the parent is carried. */
function resolvePaint(el: XmlElement, parent: Paint, classes: Map<string, [string, string][]>): Paint {
  const paint: Paint = { ...parent, visible: parent.visible };
  for (const name of PRESENTATION_ATTRIBUTES) {
    const value = el.attrs.get(name);
    if (value !== undefined) applyProperty(paint, parent, name, value);
  }
  for (const cls of (el.attrs.get("class") ?? "").split(/\s+/).filter(Boolean)) {
    for (const [name, value] of classes.get(cls) ?? []) applyProperty(paint, parent, name, value);
  }
  for (const [name, value] of parseDeclarations(el.attrs.get("style") ?? "")) {
    applyProperty(paint, parent, name, value);
  }
  return paint;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Bézier approximation of a quarter circle: the control distance for a unit radius. */
const KAPPA = 0.5522847498307936;

type Commands = AlbumPathCommand[];

function ellipseCommands(cx: number, cy: number, rx: number, ry: number): Commands {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

function rectCommands(x: number, y: number, w: number, h: number, rxRaw: number | null, ryRaw: number | null): Commands {
  let rx = rxRaw ?? ryRaw ?? 0;
  let ry = ryRaw ?? rxRaw ?? 0;
  rx = Math.min(Math.max(rx, 0), w / 2);
  ry = Math.min(Math.max(ry, 0), h / 2);
  if (rx === 0 || ry === 0) {
    return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  }
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", x + rx, y],
    ["L", x + w - rx, y],
    ["C", x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry],
    ["L", x + w, y + h - ry],
    ["C", x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h],
    ["L", x + rx, y + h],
    ["C", x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry],
    ["L", x, y + ry],
    ["C", x, y + ry - ky, x + rx - kx, y, x + rx, y],
    ["Z"],
  ];
}

/** An elliptical arc as cubic curves — the endpoint-to-centre conversion of SVG 1.1, appendix F.6. */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): Commands {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [["L", x2, y2]];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cos * dx2 + sin * dy2;
  const y1p = -sin * dx2 + cos * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  const t = (4 / 3) * Math.tan(step / 4);
  const map = (ux: number, uy: number): [number, number] => [
    cx + rx * cos * ux - ry * sin * uy,
    cy + rx * sin * ux + ry * cos * uy,
  ];
  const out: Commands = [];
  for (let s = 0; s < segments; s += 1) {
    const a1 = theta1 + s * step;
    const a2 = a1 + step;
    const [c1x, c1y] = map(Math.cos(a1) - t * Math.sin(a1), Math.sin(a1) + t * Math.cos(a1));
    const [c2x, c2y] = map(Math.cos(a2) + t * Math.sin(a2), Math.sin(a2) - t * Math.cos(a2));
    // The last point is the arc's own endpoint, exactly, rather than one recomputed through sines.
    const [ex, ey] = s === segments - 1 ? [x2, y2] : map(Math.cos(a2), Math.sin(a2));
    out.push(["C", c1x, c1y, c2x, c2y, ex, ey]);
  }
  return out;
}

/** Path data, read into absolute move, line, cubic and close. */
export function parseSvgPathData(d: string): Commands {
  const out: Commands = [];
  let i = 0;
  const n = d.length;
  const skip = () => {
    while (i < n && /[\s,]/.test(d[i])) i += 1;
  };
  const numberAt = (): number | null => {
    skip();
    const sticky = new RegExp(NUMBER.source, "y");
    sticky.lastIndex = i;
    const m = sticky.exec(d);
    if (!m) return null;
    i = sticky.lastIndex;
    return Number(m[0]);
  };
  const need = (): number => {
    const v = numberAt();
    if (v === null) throw notSvg("malformed path data");
    return v;
  };
  const flag = (): boolean => {
    skip();
    const c = d[i];
    if (c !== "0" && c !== "1") throw notSvg("malformed path data");
    i += 1;
    return c === "1";
  };
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  let command = "";

  skip();
  while (i < n) {
    skip();
    if (i >= n) break;
    if (/[MmZzLlHhVvCcSsQqTtAa]/.test(d[i])) {
      command = d[i];
      i += 1;
    } else if (!command || command === "Z" || command === "z") {
      throw notSvg("malformed path data");
    }
    const rel = command === command.toLowerCase();
    const upper = command.toUpperCase();
    let cubic: [number, number] | null = null;
    let quad: [number, number] | null = null;
    switch (upper) {
      case "M": {
        const nx = need() + (rel ? x : 0);
        const ny = need() + (rel ? y : 0);
        out.push(["M", nx, ny]);
        [x, y, startX, startY] = [nx, ny, nx, ny];
        // Pairs after the first are line-tos, relative if the move was.
        command = rel ? "l" : "L";
        break;
      }
      case "Z":
        out.push(["Z"]);
        [x, y] = [startX, startY];
        break;
      case "L": {
        const nx = need() + (rel ? x : 0);
        const ny = need() + (rel ? y : 0);
        out.push(["L", nx, ny]);
        [x, y] = [nx, ny];
        break;
      }
      case "H": {
        const nx = need() + (rel ? x : 0);
        out.push(["L", nx, y]);
        x = nx;
        break;
      }
      case "V": {
        const ny = need() + (rel ? y : 0);
        out.push(["L", x, ny]);
        y = ny;
        break;
      }
      case "C":
      case "S": {
        let c1x: number;
        let c1y: number;
        if (upper === "C") {
          c1x = need() + (rel ? x : 0);
          c1y = need() + (rel ? y : 0);
        } else {
          [c1x, c1y] = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
        }
        const c2x = need() + (rel ? x : 0);
        const c2y = need() + (rel ? y : 0);
        const ex = need() + (rel ? x : 0);
        const ey = need() + (rel ? y : 0);
        out.push(["C", c1x, c1y, c2x, c2y, ex, ey]);
        cubic = [c2x, c2y];
        [x, y] = [ex, ey];
        break;
      }
      case "Q":
      case "T": {
        let qx: number;
        let qy: number;
        if (upper === "Q") {
          qx = need() + (rel ? x : 0);
          qy = need() + (rel ? y : 0);
        } else {
          [qx, qy] = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        }
        const ex = need() + (rel ? x : 0);
        const ey = need() + (rel ? y : 0);
        out.push([
          "C",
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          ex + (2 / 3) * (qx - ex),
          ey + (2 / 3) * (qy - ey),
          ex,
          ey,
        ]);
        quad = [qx, qy];
        [x, y] = [ex, ey];
        break;
      }
      case "A": {
        const rx = need();
        const ry = need();
        const rot = need();
        const large = flag();
        const sweep = flag();
        const ex = need() + (rel ? x : 0);
        const ey = need() + (rel ? y : 0);
        out.push(...arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey));
        [x, y] = [ex, ey];
        break;
      }
    }
    lastCubic = cubic;
    lastQuad = quad;
  }
  if (out.length > 0 && out[0][0] !== "M") throw notSvg("path data that does not start with a move");
  return out;
}

function transformCommands(commands: Commands, m: Matrix): Commands {
  return commands.map((c): AlbumPathCommand => {
    if (c[0] === "Z") return ["Z"];
    if (c[0] === "C") {
      const [x1, y1] = apply(m, c[1], c[2]);
      const [x2, y2] = apply(m, c[3], c[4]);
      const [x, y] = apply(m, c[5], c[6]);
      return ["C", round(x1), round(y1), round(x2), round(y2), round(x), round(y)];
    }
    const [x, y] = apply(m, c[1], c[2]);
    return [c[0], round(x), round(y)];
  });
}

function pointList(raw: string | undefined): number[] {
  const values = numbers(raw ?? "", "list of points");
  // An odd count drops the last value, as SVG does.
  return values.length % 2 === 0 ? values : values.slice(0, -1);
}

/** The outline an element draws, in its own coordinates, or null for one that draws nothing. */
function shapeCommands(name: string, el: XmlElement): Commands | null {
  const a = (k: string) => el.attrs.get(k);
  switch (name) {
    case "path":
      return parseSvgPathData(a("d") ?? "");
    case "rect": {
      const w = userLength(a("width"), "a rectangle's width");
      const h = userLength(a("height"), "a rectangle's height");
      if (w <= 0 || h <= 0) return null;
      const rx = a("rx") === undefined ? null : userLength(a("rx"), "a corner radius");
      const ry = a("ry") === undefined ? null : userLength(a("ry"), "a corner radius");
      return rectCommands(userLength(a("x"), "a position"), userLength(a("y"), "a position"), w, h, rx, ry);
    }
    case "circle": {
      const r = userLength(a("r"), "a radius");
      if (r <= 0) return null;
      return ellipseCommands(userLength(a("cx"), "a centre"), userLength(a("cy"), "a centre"), r, r);
    }
    case "ellipse": {
      const rx = userLength(a("rx"), "a radius");
      const ry = userLength(a("ry"), "a radius");
      if (rx <= 0 || ry <= 0) return null;
      return ellipseCommands(userLength(a("cx"), "a centre"), userLength(a("cy"), "a centre"), rx, ry);
    }
    case "line":
      return [
        ["M", userLength(a("x1"), "a line end"), userLength(a("y1"), "a line end")],
        ["L", userLength(a("x2"), "a line end"), userLength(a("y2"), "a line end")],
      ];
    case "polyline":
    case "polygon": {
      const pts = pointList(a("points"));
      if (pts.length < 4) return null;
      const out: Commands = [["M", pts[0], pts[1]]];
      for (let k = 2; k < pts.length; k += 2) out.push(["L", pts[k], pts[k + 1]]);
      if (name === "polygon") out.push(["Z"]);
      return out;
    }
  }
  return null;
}

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const CONTAINERS = new Set(["g", "a"]);
/** Elements that never draw by themselves — passed over whole, children included. */
const PASSED_OVER = new Set([
  "defs",
  "title",
  "desc",
  "metadata",
  "style",
  "script",
  "symbol",
  "clipPath",
  "mask",
  "marker",
  "pattern",
  "linearGradient",
  "radialGradient",
  "filter",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
]);
const REFUSED: Record<string, string> = {
  text: "contains text",
  image: "contains an embedded picture",
  use: "reuses parts of itself with <use>",
  foreignObject: "contains foreign content",
  svg: "contains a drawing inside the drawing",
  switch: "contains alternative content",
  video: "contains a video",
  audio: "contains sound",
  iframe: "contains a frame",
  canvas: "contains a canvas",
};

function colourOf(value: string | null, paint: Paint): string | null {
  return value === "currentColor" ? paint.color : value;
}

/**
 * Read an SVG file into a corner ornament.
 *
 * The result is drawn for the **top-left** corner, with the file's `viewBox` as its frame (its
 * `width` and `height` standing in when there is none). Throws {@link AlbumOrnamentSvgError} with a
 * message for the collector when the file is not one this reader takes.
 */
export function readOrnamentSvg(source: string): AlbumOrnamentDrawing {
  if (source.length > MAX_ORNAMENT_SVG_BYTES) {
    throw new AlbumOrnamentSvgError(
      "This file is too large to be a corner ornament (1 MB at most).",
      "is larger than a megabyte"
    );
  }
  const root = parseXml(source.replace(/^﻿/, ""));
  if (localName(root.name) !== "svg") throw notSvg("its outermost element is not <svg>");

  let viewBox: AlbumOrnamentDrawing["viewBox"] | null = null;
  const vb = root.attrs.get("viewBox");
  if (vb !== undefined) {
    const v = numbers(vb, "viewBox");
    if (v.length !== 4 || !(v[2] > 0) || !(v[3] > 0)) throw notSvg("a malformed viewBox");
    viewBox = { x: v[0], y: v[1], width: v[2], height: v[3] };
  } else {
    const w = rootLength(root.attrs.get("width"));
    const h = rootLength(root.attrs.get("height"));
    if (!w || !h) {
      throw new AlbumOrnamentSvgError("The drawing has no viewBox and no width and height, so its size cannot be known.");
    }
    viewBox = { x: 0, y: 0, width: w, height: h };
  }

  // Class rules from every `<style>` in the file, wherever it sits — a stylesheet applies to the
  // whole document, not to its siblings.
  const classes = new Map<string, [string, string][]>();
  const collectStyles = (el: XmlElement) => {
    if (localName(el.name) === "style") {
      for (const [k, v] of parseStylesheet(el.text)) classes.set(k, [...(classes.get(k) ?? []), ...v]);
    }
    el.children.forEach(collectStyles);
  };
  collectStyles(root);

  const paths: AlbumOrnamentPath[] = [];
  let commandCount = 0;

  const walk = (el: XmlElement, parentPaint: Paint, parentMatrix: Matrix, isRoot: boolean) => {
    const name = localName(el.name);
    if (name === null) return;
    if (!isRoot) {
      if (PASSED_OVER.has(name)) return;
      if (REFUSED[name]) {
        throw new AlbumOrnamentSvgError(
          `The drawing ${REFUSED[name]}, which a corner ornament cannot print.`,
          REFUSED[name]
        );
      }
      if (!SHAPES.has(name) && !CONTAINERS.has(name)) return;
    }
    const paint = resolvePaint(el, parentPaint, classes);
    if (!paint.visible && (isRoot || CONTAINERS.has(name))) {
      // A hidden group hides its children for `display`; `visibility` could be overridden below,
      // but a drawing that hides a group to show one child of it is not an ornament worth a rule.
      return;
    }
    const matrix = isRoot ? IDENTITY : multiply(parentMatrix, parseTransform(el.attrs.get("transform")));
    if (isRoot || CONTAINERS.has(name)) {
      for (const child of el.children) walk(child, paint, matrix, false);
      return;
    }
    if (!paint.visible) return;
    const own = shapeCommands(name, el);
    if (!own || own.length === 0) return;
    const stroke = paint.strokeWidth > 0 ? colourOf(paint.stroke, paint) : null;
    // A line encloses nothing, so its fill paints nothing.
    const fills = name === "line" ? null : colourOf(paint.fill, paint);
    if (fills === null && stroke === null) return;
    const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
    const commands = transformCommands(own, matrix);
    commandCount += commands.length;
    if (paths.length + 1 > MAX_PATHS || commandCount > MAX_COMMANDS) {
      throw new AlbumOrnamentSvgError(
        "The drawing is too detailed to print as a corner ornament.",
        "is too detailed to print as lines"
      );
    }
    paths.push({
      commands,
      fill: fills,
      fillRule: paint.fillRule,
      stroke,
      strokeWidth: stroke === null ? 0 : round(paint.strokeWidth * scale),
      lineCap: paint.lineCap,
      lineJoin: paint.lineJoin,
    });
  };
  walk(root, INITIAL_PAINT, IDENTITY, true);

  if (paths.length === 0) throw new AlbumOrnamentSvgError("The drawing draws nothing that could be printed.");
  return { viewBox, paths };
}

/**
 * A whole drawing as an SVG document **written from its outlines** — never the file that was uploaded.
 *
 * For a free page's picture (#1429), which the browser shows through an `<img>` and the PDF draws from
 * the same four commands. Everything in it is numbers and `#rrggbb` colours this reader produced, so
 * nothing the collector uploaded reaches a browser as markup (ADR-0057 §1).
 */
export function albumDrawingSvg(drawing: AlbumOrnamentDrawing): string {
  const { x, y, width, height } = drawing.viewBox;
  const paths = drawing.paths
    .map(
      (p) =>
        `<path d="${albumOrnamentPathData(p.commands)}" fill="${p.fill ?? "none"}" fill-rule="${p.fillRule}"` +
        ` stroke="${p.stroke ?? "none"}" stroke-width="${p.strokeWidth}" stroke-linecap="${p.lineCap}"` +
        ` stroke-linejoin="${p.lineJoin}"/>`
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}"` +
    ` width="${width}" height="${height}">${paths}</svg>`
  );
}

/** A drawing's outlines as SVG path data — for the canvas, which draws the same numbers the PDF
 *  does. Never used to *read* anything. */
export function albumOrnamentPathData(commands: readonly AlbumPathCommand[]): string {
  return commands
    .map((c) => (c[0] === "Z" ? "Z" : `${c[0]}${c.slice(1).join(" ")}`))
    .join("");
}
