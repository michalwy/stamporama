"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import {
  type DelcampeCategoryRow,
  type DelcampeCategoryTreeNode,
  buildDelcampeCategoryTree,
  delcampeCategoryAncestorIds,
  expandableDelcampeCategoryIds,
  filterDelcampeCategoryTree,
} from "@/lib/delcampe-category-catalog-rules";
import { readDelcampeCategoriesAction } from "@/app/actions/delcampe";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

// Picking a Delcampe category (#609; ADR-0035 §5).
//
// Shared rather than local to one screen, for the Allegro picker's reason: a category is chosen in
// two places — on the offer's own **On Delcampe** card, and in Settings → Delcampe when correcting an
// association learned wrong — and it has to be chosen the same way in both.
//
// **Delcampe's own tree, searched.** Both halves earn their place. The tree is how a collector who
// knows where their stamps live gets there — `Europe → Poland → 1944-…. Republic → 1961-70` reads as
// the marketplace's own filing and not as a list of eight thousand strings — and it is the only thing
// that makes a *heading* legible as a heading. The search is how anyone else gets there, six levels
// being a long way to click: typing `poland used` is one gesture, and a search narrows the tree in
// place rather than flattening it, so a result is still shown where it sits.
//
// **A heading cannot be chosen.** `Stamps > Europe > Poland` is a place in Delcampe's tree and not a
// category anything can be uploaded into, so it is shown, expandable, and refuses the click — the
// rule `LocationTreeSelect` already applies to grouping-only storage, said in the same words.
//
// **The whole list is loaded once**, not queried per keystroke. It is a few tens of kilobytes
// compressed, and having it here is what lets expanding and searching agree with each other
// instantly. It is public data with nothing of the collection's in it.
//
// **A typed id is always accepted.** The catalogue is a snapshot and Delcampe's list is the
// authority — an id read off Delcampe's own selling form must be usable the moment it exists, before
// any refresh has seen it.

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

/** What a finished pick is — everything a caller needs to upload with it and to record it. */
export interface DelcampeCategoryChoice {
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
}

/** A path as one readable line: the ancestors muted, the leaf in full strength, so a six-segment path
 *  can be scanned without the last segment — the part that identifies it — being lost in it. */
export function DelcampeCategoryPath({ path, name }: { path: string | null; name: string }) {
  const segments = path?.split(" > ").filter((segment) => segment.trim()) ?? [];
  if (segments.length === 0) return <span>{name}</span>;
  const leaf = segments[segments.length - 1];
  const ancestors = segments.slice(0, -1);
  return (
    <span>
      {ancestors.length > 0 && (
        <span style={{ color: "var(--color-text-muted)" }}>{ancestors.join(" › ")} › </span>
      )}
      <span>{leaf}</span>
    </span>
  );
}

export function DelcampeCategoryPicker({
  title,
  initialTerm,
  initialPath,
  onClose,
  onChosen,
}: {
  title: string;
  /** What the search opens on. The offer's own key — "Poland used" — where the caller has one, so the
   *  first offer of a kind opens somewhere near rather than at the top of the tree. */
  initialTerm?: string | null;
  /** The path this subject already carries, so a re-pick opens on it in place rather than folded
   *  away. Ignored where the caller has none. */
  initialPath?: string | null;
  onClose: () => void;
  onChosen: (choice: DelcampeCategoryChoice) => void;
}) {
  const [rows, setRows] = useState<DelcampeCategoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [term, setTerm] = useState(initialTerm ?? "");
  const [picked, setPicked] = useState<DelcampeCategoryTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Null until the collector expands or collapses something themselves, which is the difference
  // between "nothing is open" and "nobody has said yet" — the second wants a sensible opening view
  // and the first must be left exactly as it is.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const answer = await readDelcampeCategoriesAction();
      if (!live) return;
      if (answer.status === "error") setLoadError(answer.message);
      else setRows(answer.categories);
    })();
    return () => {
      live = false;
    };
  }, []);

  // Built once per load, not per keystroke: the tree is the same tree whatever is typed, and only
  // the narrowing below changes.
  const tree = useMemo(() => (rows ? buildDelcampeCategoryTree(rows) : []), [rows]);

  // The selection is **derived** until somebody makes one: a picker opened on a category already
  // chosen shows that category as chosen, expanded to and scrolled to, so "change this" does not
  // start by finding the current answer again. Derived rather than seeded into state in an effect,
  // because the tree arrives after the first render and a seed would have to chase it.
  const opened = useMemo(
    () => (initialPath && tree.length > 0 ? findNode(tree, initialPath) : null),
    [initialPath, tree]
  );
  const chosen = picked ?? opened;
  const visible = useMemo(() => filterDelcampeCategoryTree(tree, term), [tree, term]);
  // While searching, everything the narrowed tree still holds is open — the matches *are* its
  // leaves, and a search that left them folded away would have found nothing as far as the collector
  // can see. With no search the collector's own expansions stand.
  const searching = term.trim().length > 0;
  /** What is open before anybody touches it: the branch holding the category already chosen, or —
   *  with nothing chosen — the top two levels, so the picker opens on Delcampe's continents rather
   *  than on one collapsed row saying `Stamps`. */
  const openingIds = useMemo(() => {
    if (initialPath) return delcampeCategoryAncestorIds(initialPath);
    return new Set(tree.flatMap((node) => [node.id, ...node.children.map((child) => child.id)]));
  }, [initialPath, tree]);
  const openIds = useMemo(
    () => (searching ? expandableDelcampeCategoryIds(visible) : (expanded ?? openingIds)),
    [searching, visible, expanded, openingIds]
  );

  const typedId = /^\d+$/.test(term.trim()) ? term.trim() : null;
  // An id created since the last read of Delcampe's list — or one being read off the selling form
  // right now. Offered as itself rather than refused.
  const offerTypedId = typedId !== null && !rows?.some((row) => row.id === typedId);

  function toggle(id: string) {
    // The first toggle takes over from the opening view rather than starting from nothing, or the
    // one collapse a collector makes would fold the whole tree away with it.
    const current = expanded ?? openIds;
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  function choose(node: DelcampeCategoryTreeNode) {
    if (!node.categoryId) return;
    onChosen({ categoryId: node.categoryId, categoryName: node.name, categoryPath: node.id });
  }

  function confirm() {
    if (chosen) {
      choose(chosen);
      return;
    }
    if (typedId) {
      onChosen({ categoryId: typedId, categoryName: null, categoryPath: null });
      return;
    }
    setError("Pick a category from the tree, or type its number.");
  }

  return (
    <DialogShell title={title} onClose={onClose} maxWidth="42rem" minHeight="32rem">
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {(error ?? loadError) && (
            <p style={{ ...helpTextStyle, color: "var(--color-error)" }}>{error ?? loadError}</p>
          )}

          <div>
            <input
              autoFocus
              type="search"
              value={term}
              placeholder="Country, period, condition — or a category number"
              style={INPUT_STYLE}
              onChange={(e) => {
                setPicked(null);
                setError(null);
                setTerm(e.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                confirm();
              }}
            />
            <p style={{ ...helpTextStyle, margin: "0.375rem 0 0" }}>
              Every word has to appear somewhere in the category&rsquo;s path, in any order —{" "}
              <em>poland used 1961</em> finds one branch. Leave it empty to walk the tree.
            </p>
          </div>

          {chosen && (
            <p style={{ margin: 0, fontSize: "0.875rem" }}>
              <DelcampeCategoryPath path={chosen.id} name={chosen.name} />{" "}
              <span style={helpTextStyle}>· #{chosen.categoryId}</span>
            </p>
          )}

          <div
            role="listbox"
            aria-label="Delcampe categories"
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              maxHeight: "22rem",
              overflow: "auto",
              padding: "0.25rem",
            }}
          >
            {offerTypedId && (
              <button
                type="button"
                style={TYPED_ID_BUTTON}
                onClick={() => onChosen({ categoryId: typedId, categoryName: null, categoryPath: null })}
              >
                <span style={{ fontSize: "0.875rem" }}>
                  Use category <strong>#{typedId}</strong> as typed
                </span>
                <span style={helpTextStyle}>
                  Not in the list this app has read — which is what a category created since the last
                  read looks like.
                </span>
              </button>
            )}
            {rows === null && !loadError ? (
              <p style={{ ...helpTextStyle, margin: 0, padding: "0.75rem" }}>
                Reading Delcampe&rsquo;s category list…
              </p>
            ) : visible.length === 0 && !offerTypedId ? (
              <p style={{ ...helpTextStyle, margin: 0, padding: "0.75rem" }}>
                Nothing matches. Delcampe files stamps by country and period rather than by the areas
                this collection uses, so try the country on its own.
              </p>
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {visible.map((node) => (
                  <CategoryNode
                    key={node.id}
                    node={node}
                    level={0}
                    openIds={openIds}
                    chosenId={chosen?.id ?? null}
                    revealId={initialPath ?? null}
                    onToggle={toggle}
                    onChoose={(node) => {
                      setError(null);
                      setPicked(node);
                    }}
                    onCommit={choose}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
      </DialogBody>
      <DialogActions actionLabel="Use this category" onCancel={onClose} onAction={confirm} />
    </DialogShell>
  );
}

/**
 * One row of the tree.
 *
 * A node with no `categoryId` is a **heading** — a place in Delcampe's filing, not a category — so it
 * is drawn muted and its click expands rather than selects. That is `LocationTreeSelect`'s rule for a
 * grouping-only location, and the tooltip says the same thing for the same reason: a control that
 * silently does nothing reads as broken.
 *
 * A node can be both listable and a parent (`Occupations` is), so the caret and the label are
 * separate controls rather than one row that has to mean one thing.
 */
function CategoryNode({
  node,
  level,
  openIds,
  chosenId,
  revealId,
  onToggle,
  onChoose,
  onCommit,
}: {
  node: DelcampeCategoryTreeNode;
  level: number;
  openIds: Set<string>;
  chosenId: string | null;
  /** The node to scroll into view once, if it is drawn. Six levels down a tree of eight thousand,
   *  "expanded to it" is not the same as "in front of you". */
  revealId: string | null;
  onToggle: (id: string) => void;
  onChoose: (node: DelcampeCategoryTreeNode) => void;
  /** A double-click is "this one, and I am done" — the same shortcut the rest of the app's pick
   *  lists offer. */
  onCommit: (node: DelcampeCategoryTreeNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = openIds.has(node.id);
  const isChosen = chosenId === node.id;
  const selectable = node.categoryId !== null;
  const revealed = useRef(false);

  // Once, and only for the node the picker was opened on: a scroll on every render would fight the
  // collector the moment they scrolled away from it.
  const reveal = (element: HTMLLIElement | null) => {
    if (!element || revealed.current || node.id !== revealId) return;
    revealed.current = true;
    element.scrollIntoView({ block: "center" });
  };

  const label = (
    <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", minWidth: 0 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.name}
      </span>
      {node.categoryId && <span style={{ ...helpTextStyle, flexShrink: 0 }}>#{node.categoryId}</span>}
    </span>
  );

  return (
    <li ref={reveal}>
      <div style={{ display: "flex", alignItems: "center", paddingLeft: `${level}rem` }}>
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}`}
            style={CARET_BUTTON}
            onClick={() => onToggle(node.id)}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                transition: "transform 120ms",
                transform: isOpen ? "rotate(90deg)" : undefined,
              }}
            >
              <Icon name="expand" size="sm" />
            </span>
          </button>
        ) : (
          <span style={{ width: "1.5rem", flexShrink: 0 }} />
        )}
        {selectable ? (
          <button
            type="button"
            role="option"
            aria-selected={isChosen}
            style={{
              ...ROW_BUTTON,
              background: isChosen ? "var(--color-accent-soft)" : "none",
              fontWeight: isChosen ? 600 : 400,
            }}
            onClick={() => onChoose(node)}
            onDoubleClick={() => onCommit(node)}
          >
            {label}
          </button>
        ) : (
          <Tooltip content="A place in Delcampe's tree — pick a category under it">
            <button
              type="button"
              style={{ ...ROW_BUTTON, color: "var(--color-text-muted)", cursor: "default" }}
              onClick={() => hasChildren && onToggle(node.id)}
            >
              {label}
            </button>
          </Tooltip>
        )}
      </div>
      {hasChildren && isOpen && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {node.children.map((child) => (
            <CategoryNode
              key={child.id}
              node={child}
              level={level + 1}
              openIds={openIds}
              chosenId={chosenId}
              revealId={revealId}
              onToggle={onToggle}
              onChoose={onChoose}
              onCommit={onCommit}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

const CARET_BUTTON: React.CSSProperties = {
  width: "1.5rem",
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--color-text-muted)",
  cursor: "pointer",
};

const ROW_BUTTON: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "block",
  padding: "0.25rem 0.375rem",
  border: "none",
  borderRadius: "0.25rem",
  textAlign: "left",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const TYPED_ID_BUTTON: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.125rem",
  width: "100%",
  padding: "0.5rem 0.75rem",
  marginBottom: "0.25rem",
  background: "none",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "0.375rem",
  textAlign: "left",
  cursor: "pointer",
  color: "var(--color-text-primary)",
};

/** The node at one path, or null where the catalogue no longer holds it — a category Delcampe
 *  retired between the offer being prepared and this picker being opened. Null is why the picker
 *  simply opens at the top rather than reporting anything: the stored value is still on the card,
 *  and "not in the list any more" is what the upload will say if it matters. */
function findNode(
  nodes: readonly DelcampeCategoryTreeNode[],
  path: string
): DelcampeCategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === path) return node;
    if (!path.startsWith(`${node.id} > `)) continue;
    const found = findNode(node.children, path);
    if (found) return found;
  }
  return null;
}
