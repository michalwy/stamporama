// A stamp's whole variant tree typed as indented text (#1447) — the pure half.
//
// `add variant range` (#722) types one level at a time, and a real tree is irregular: one watermark
// has three perforations, the other none, and under each perforation a run of colours. Building it
// with #722 means one dialog per node that has children. Here the collector types the tree the way a
// catalogue prints it — **one variant per line, its suffix, and indentation for its level**:
//
//     X
//       A
//         a
//         b
//       B
//     Y
//
// under `123` is `123X`, `123XA`, `123XAa`, `123XAb`, `123XB` and `123Y`. **A variant's number is
// its parent's number with its suffix appended**, the form variant numbers already take in the app,
// and the preview shows exactly the numbers that will be written.
//
// The **kind** (the subtype: watermark, perforation, colour) is deliberately not typed. It is chosen
// in the preview, on the variant, so the text holds nothing a typo could turn into a wrong record.
//
// The text opens on the stamp's existing variants, and **only lines that do not exist yet are
// created**: a line is matched to an existing variant by the number it would give. Nothing existing
// is renamed or deleted from here — a variant whose line is removed is *kept*, where it stood, and
// the preview says so. Deleting stays on the stamp's page (#630).

/** Past this many new variants the tree is refused. A line is one variant, so nothing here expands
 *  the way a range can (`1-10000`); the cap is only a bound on one write, well above a real page. */
export const VARIANT_TREE_MAX_STAMPS = 200;

/** The indentation {@link variantTreeToText} writes and Tab inserts into a text that has none yet. */
export const VARIANT_TREE_INDENT = "  ";

/** A variant already stored under the stamp, as the dialog is handed it. */
export interface ExistingVariant {
  stampId: string;
  /** Its number in the catalogue the tree is numbered in; null when it carries none there. */
  number: string | null;
  subtypeId: string | null;
  children: ExistingVariant[];
}

/** One non-blank line of the text. */
export interface VariantTreeLine {
  /** 1-based, as an editor counts, so a message can name it. */
  line: number;
  /** The level the line is drawn at: 0 is a direct variant of the stamp. Clamped to one below the
   *  line above when the text skips a level, so the preview still has a tree to draw. */
  level: number;
  suffix: string;
}

export interface VariantTreeProblem {
  line: number;
  message: string;
}

/** What one indentation is worth: a tab is a level, and so is the first run of spaces the text
 *  indents by — which is how a tree pasted with four spaces reads the same as one typed with two. */
function indentUnit(text: string): number {
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const spaces = /^( +)/.exec(raw)?.[1].length ?? 0;
    if (spaces > 0) return spaces;
  }
  return VARIANT_TREE_INDENT.length;
}

/** The indentation Tab adds to a line of `text`: a tab if the text is indented with tabs, otherwise
 *  the run of spaces it already indents by. */
export function indentStringFor(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const lead = /^[ \t]*/.exec(raw)?.[0] ?? "";
    if (lead.startsWith("\t")) return "\t";
    if (lead.length > 0) return " ".repeat(lead.length);
  }
  return VARIANT_TREE_INDENT;
}

/**
 * Read the text into its lines and their levels. Blank lines are ignored; a line's suffix is the
 * line without the whitespace around it.
 *
 * Two mistakes are reported against the line that makes them — **a line indented more than one
 * level below the line above** (which also covers a first line that is indented at all), and **an
 * indentation that lines up with no level**, three spaces in a text indented by two.
 */
export function parseVariantTreeText(text: string): {
  lines: VariantTreeLine[];
  problems: VariantTreeProblem[];
} {
  const unit = indentUnit(text);
  const lines: VariantTreeLine[] = [];
  const problems: VariantTreeProblem[] = [];
  let previous = -1;

  text.split(/\r?\n/).forEach((raw, i) => {
    const suffix = raw.trim();
    if (!suffix) return;
    const line = i + 1;
    const lead = /^[ \t]*/.exec(raw)?.[0] ?? "";
    const tabs = [...lead].filter((c) => c === "\t").length;
    const spaces = lead.length - tabs;

    let level = tabs + Math.floor(spaces / unit);
    if (spaces % unit !== 0) {
      problems.push({ line, message: "Its indentation does not line up with a level." });
    }
    if (level > previous + 1) {
      problems.push({ line, message: "It is indented more than one level below the line above." });
      level = previous + 1;
    }
    previous = level;
    lines.push({ line, level, suffix });
  });

  return { lines, problems };
}

/** Where a variant sits in the tree, as the suffixes from the stamp down. The key kinds are chosen
 *  by, so a kind stays with a line while the line keeps its place — and not its line number, which
 *  every line inserted above would move. */
export function variantPathKey(suffixes: readonly string[]): string {
  return JSON.stringify(suffixes);
}

export type VariantTreeNodeStatus =
  /** A line the text adds: created on confirming. */
  | "new"
  /** A line matched to a variant already stored. */
  | "existing"
  /** A stored variant no line names: left exactly as it is, where it stood. */
  | "kept";

export interface VariantTreeNode {
  /** {@link variantPathKey} for a line; `#<stampId>` for a kept variant, which has no line. */
  key: string;
  status: VariantTreeNodeStatus;
  /** The full number this variant carries in the tree's catalogue — the one written, for a new one.
   *  Null only for a kept variant that carries none there. */
  number: string | null;
  /** The line that names it; null for a kept variant. */
  line: number | null;
  suffix: string | null;
  /** Set on an existing or kept variant. */
  stampId: string | null;
  /** The stored subtype of an existing or kept variant; null on a new one (see {@link effectiveKinds}). */
  subtypeId: string | null;
  children: VariantTreeNode[];
}

export interface ResolvedVariantTree {
  /** The stamp's variants as they will read after confirming, in order. */
  roots: VariantTreeNode[];
  /** Every mistake, by line, in line order. Confirming is refused while any remain. */
  problems: VariantTreeProblem[];
  /** The variants confirming would create, in the order they are written: each after its parent. */
  created: VariantTreeNode[];
}

/**
 * The tree the text describes, laid over the variants already stored under a stamp numbered
 * `baseNumber`.
 *
 * A line under a stored variant is matched to the stored child carrying the number the line would
 * give; everything else it names is new. A stored variant no line names is kept where it stood,
 * with everything under it. A suffix repeated among siblings is a mistake on its second
 * line — it would give two variants one number.
 */
export function resolveVariantTree(
  text: string,
  existing: readonly ExistingVariant[],
  baseNumber: string
): ResolvedVariantTree {
  const { lines, problems } = parseVariantTreeText(text);
  const created: VariantTreeNode[] = [];

  const kept = (v: ExistingVariant): VariantTreeNode => ({
    key: `#${v.stampId}`,
    status: "kept",
    number: v.number,
    line: null,
    suffix: null,
    stampId: v.stampId,
    subtypeId: v.subtypeId,
    children: v.children.map(kept),
  });

  // The lines are consumed in order; each call builds one level's run of siblings under `parent`.
  let cursor = 0;
  const build = (
    level: number,
    parentNumber: string,
    parentPath: string[],
    stored: readonly ExistingVariant[]
  ): VariantTreeNode[] => {
    const nodes: VariantTreeNode[] = [];
    const matched = new Set<string>();
    const suffixes = new Set<string>();

    while (cursor < lines.length && lines[cursor].level === level) {
      const { line, suffix } = lines[cursor++];
      const path = [...parentPath, suffix];
      const number = `${parentNumber}${suffix}`;
      if (suffixes.has(suffix)) {
        problems.push({ line, message: `The suffix ${suffix} is already used at this level.` });
      }
      suffixes.add(suffix);

      const match = stored.find((v) => !matched.has(v.stampId) && v.number === number) ?? null;
      if (match) matched.add(match.stampId);
      const node: VariantTreeNode = {
        key: variantPathKey(path),
        status: match ? "existing" : "new",
        number,
        line,
        suffix,
        stampId: match?.stampId ?? null,
        subtypeId: match?.subtypeId ?? null,
        children: [],
      };
      if (!match) created.push(node);
      node.children = build(level + 1, number, path, match?.children ?? []);
      nodes.push(node);
    }

    // A stored variant no line names stays where it stood: after the stored sibling it followed,
    // or first when it followed none. Removing a line therefore changes nothing at all.
    let at = 0;
    for (const v of stored) {
      if (matched.has(v.stampId)) {
        at = nodes.findIndex((n) => n.stampId === v.stampId) + 1;
      } else {
        nodes.splice(at++, 0, kept(v));
      }
    }
    return nodes;
  };

  let roots: VariantTreeNode[];
  if (!baseNumber.trim()) {
    // Nothing to hang a suffix off. The stored variants still show, so the preview is not a lie
    // about what is there.
    roots = existing.map(kept);
    if (lines.length > 0) {
      problems.push({
        line: lines[0].line,
        message: "This stamp has no number in that catalogue, so a suffix has nothing to follow.",
      });
    }
  } else {
    roots = build(0, baseNumber.trim(), [], existing);
  }

  if (created.length > VARIANT_TREE_MAX_STAMPS) {
    problems.push({
      line: created[VARIANT_TREE_MAX_STAMPS].line ?? 0,
      message: `A tree can add at most ${VARIANT_TREE_MAX_STAMPS} variants at once (${created.length} here).`,
    });
  }

  problems.sort((a, b) => a.line - b.line);
  return { roots, problems, created };
}

/**
 * The text the dialog opens on: every stored variant whose number is its parent's with something
 * appended, as that something, indented by its level.
 *
 * A variant numbered any other way — or carrying no number in this catalogue — has no suffix to
 * write, so it is left out of the text, and with it everything under it; the preview still shows
 * it, kept.
 */
export function variantTreeToText(existing: readonly ExistingVariant[], baseNumber: string): string {
  const out: string[] = [];
  const walk = (nodes: readonly ExistingVariant[], parentNumber: string, depth: number) => {
    for (const v of nodes) {
      if (!v.number || v.number.length <= parentNumber.length || !v.number.startsWith(parentNumber)) {
        continue;
      }
      const suffix = v.number.slice(parentNumber.length);
      // A suffix that starts or ends in whitespace would not survive being read back as a line.
      if (suffix.trim() !== suffix) continue;
      out.push(`${VARIANT_TREE_INDENT.repeat(depth)}${suffix}`);
      walk(v.children, v.number, depth + 1);
    }
  };
  const base = baseNumber.trim();
  if (base) walk(existing, base, 0);
  return out.join("\n");
}

/** Every node of `roots`, parents before their children. */
function eachNode(roots: readonly VariantTreeNode[], visit: (node: VariantTreeNode, siblings: readonly VariantTreeNode[]) => void) {
  const walk = (level: readonly VariantTreeNode[]) => {
    for (const node of level) {
      visit(node, level);
      walk(node.children);
    }
  };
  walk(roots);
}

/** The kinds chosen in the preview, by {@link VariantTreeNode.key}. An empty string is the default
 *  subtype chosen on purpose, which a line keeps rather than taking its siblings' kind. */
export type VariantKindChoices = Readonly<Record<string, string>>;

/**
 * The kind each **new** variant will carry, by key; null where none is chosen, which is written as
 * the collection's default subtype, as any new child stamp is.
 *
 * A new variant carries the kind chosen on it. Without one it takes its siblings' — the first
 * sibling, in order, that has a kind chosen or stored — so a line added to a level whose kind is
 * already set starts with that kind.
 */
export function effectiveKinds(
  roots: readonly VariantTreeNode[],
  choices: VariantKindChoices
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  eachNode(roots, (node, siblings) => {
    if (node.status !== "new") return;
    if (Object.hasOwn(choices, node.key)) {
      out.set(node.key, choices[node.key] || null);
      return;
    }
    const sibling = siblings.find((s) =>
      s.status === "new" ? !!choices[s.key] : !!s.subtypeId
    );
    out.set(
      node.key,
      sibling ? (sibling.status === "new" ? choices[sibling.key] : sibling.subtypeId) : null
    );
  });
  return out;
}

/**
 * Choose a kind on one new variant — `""` for the collection's default. **Its new siblings that
 * have no kind yet get it too**, so a level's kind is chosen once; each can then be changed on its
 * own.
 *
 * Every new sibling's kind is pinned in the answer as it stands, so changing this one later cannot
 * change what the others read by inheritance.
 */
export function chooseKind(
  roots: readonly VariantTreeNode[],
  choices: VariantKindChoices,
  key: string,
  subtypeId: string
): Record<string, string> {
  const next: Record<string, string> = { ...choices };
  // Choosing the default is choosing no kind, and fills nothing.
  if (!subtypeId) {
    next[key] = "";
    return next;
  }
  const current = effectiveKinds(roots, choices);
  eachNode(roots, (node, siblings) => {
    if (node.key !== key) return;
    for (const s of siblings) {
      if (s.status !== "new" || s.key === key) continue;
      next[s.key] = current.get(s.key) ?? subtypeId;
    }
  });
  next[key] = subtypeId;
  return next;
}

/**
 * The order to store for each level the tree touches (#549): the parent (null for the stamp
 * itself), and its variants in the order they will read — the lines' order, with each kept variant
 * where it stood.
 *
 * Only levels that change are answered: one gaining a variant, or one whose stored variants the
 * text puts in a different order. `storedOrder` is the order each level's stored variants read in
 * now, by parent stamp id (the stamp itself under `rootStampId`).
 */
export function levelsToReorder(
  roots: readonly VariantTreeNode[],
  rootStampId: string,
  storedOrder: ReadonlyMap<string, readonly string[]>
): { parent: VariantTreeNode | null; children: VariantTreeNode[] }[] {
  const out: { parent: VariantTreeNode | null; children: VariantTreeNode[] }[] = [];
  const visit = (parent: VariantTreeNode | null, level: VariantTreeNode[]) => {
    if (level.length > 0) {
      const gains = level.some((n) => n.status === "new");
      const now = level.filter((n) => n.stampId).map((n) => n.stampId as string);
      const parentId = parent ? parent.stampId : rootStampId;
      const before = (parentId && storedOrder.get(parentId)) || [];
      const moved = now.length !== before.length || now.some((id, i) => id !== before[i]);
      if (gains || moved) out.push({ parent, children: level });
    }
    for (const node of level) visit(node, node.children);
  };
  visit(null, [...roots]);
  return out;
}

/**
 * Tab and Shift+Tab in the text: indent or outdent **the current line** — every line the selection
 * touches, when it spans several — by one level, and answer the text with the selection moved to
 * follow the characters it was on.
 *
 * One level is {@link indentStringFor} the text, so a tree pasted with tabs or four spaces keeps
 * its own indentation. Outdenting a line that has none leaves it as it is.
 */
export function shiftLines(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "indent" | "outdent"
): { text: string; selectionStart: number; selectionEnd: number } {
  const unit = indentStringFor(text);
  const spaces = unit === "\t" ? VARIANT_TREE_INDENT.length : unit.length;
  const lines = text.split("\n");

  // The line each end of the selection is on. A selection ending right after a line break has not
  // reached into the next line.
  const lineAt = (pos: number) => text.slice(0, pos).split("\n").length - 1;
  const first = lineAt(selectionStart);
  const last =
    selectionEnd > selectionStart && text[selectionEnd - 1] === "\n"
      ? lineAt(selectionEnd - 1)
      : lineAt(selectionEnd);

  const deltas: number[] = [];
  for (let i = first; i <= last; i++) {
    if (direction === "indent") {
      lines[i] = unit + lines[i];
      deltas.push(unit.length);
    } else {
      const lead = /^[ \t]*/.exec(lines[i])?.[0] ?? "";
      const remove = lead.startsWith("\t") ? 1 : Math.min(/^ */.exec(lead)?.[0].length ?? 0, spaces);
      lines[i] = lines[i].slice(remove);
      deltas.push(-remove);
    }
  }

  const startOf = (line: number) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  const total = deltas.reduce((a, b) => a + b, 0);
  // Each end moves with the characters it was on, and never back past the start of its own line.
  return {
    text: lines.join("\n"),
    selectionStart: Math.max(startOf(first), selectionStart + deltas[0]),
    selectionEnd: Math.max(startOf(lineAt(selectionEnd)), selectionEnd + total),
  };
}
