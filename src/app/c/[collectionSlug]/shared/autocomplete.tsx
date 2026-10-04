"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "@/app/escape-stack";
import { TextInput } from "./text-input";

// Shared flat search-suggestion autocomplete primitive (#109). A single
// `Autocomplete` component owns every interaction — the input, debounced open,
// click-outside, keyboard navigation, and selection dispatch. Specializations
// supply only *data* (the `items` from their own search hook, keyed on a
// `useDebouncedValue` query) and *rendering* (`renderItem`, optional `actions`).
// Selected-state chrome (a chip, a "Change" affordance, an editable input) stays
// at each call site, which conditionally renders `Autocomplete` for the searching
// phase. Previously this scaffolding was hand-rolled and duplicated across four
// places (the issue filter, the copy-form issue picker, the list search box, and
// the inventory Source picker).

// ── Shared styles ─────────────────────────────────────────────────────────────

/** Base text-input style for the compact (0.8125rem) autocompletes. Call sites
 * spread this and add `width` (or override padding/fontSize for larger inputs). */
export const SEARCH_INPUT_STYLE: CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2rem",
};

const DROPDOWN_STYLE: CSSProperties = {
  position: "fixed",
  boxSizing: "border-box",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  overflowY: "auto",
};

/** The list's height when the window has room for it (12rem). */
const DROPDOWN_MAX_HEIGHT = 192;
/** Between the field and its list, and between the list and the window's edge. */
const DROPDOWN_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** The rank of the surface the field sits in — the dialog panel, usually — read off the nearest
 * ancestors that set one, so the list is drawn just above whatever it was opened in without each
 * caller having to know its dialog's `zIndexBase`. */
function surfaceRank(el: HTMLElement): number {
  let rank = 0;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const z = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(z)) rank = Math.max(rank, z);
  }
  return rank;
}

/** Draw the portaled list against its field: under it, or over it when the window has no room
 * below, and never taller than the window leaves it. */
function placeDropdown(anchor: HTMLElement, list: HTMLElement, floor: number) {
  const rect = anchor.getBoundingClientRect();
  const wanted = Math.min(list.scrollHeight, DROPDOWN_MAX_HEIGHT);
  const below = window.innerHeight - rect.bottom - DROPDOWN_GAP - VIEWPORT_MARGIN;
  const above = rect.top - DROPDOWN_GAP - VIEWPORT_MARGIN;
  // Below when it fits there; otherwise on whichever side has more room, cut to that room.
  const down = wanted <= below || below >= above;
  const style = list.style;
  style.left = `${rect.left}px`;
  style.width = `${rect.width}px`;
  style.zIndex = String(Math.max(floor, surfaceRank(anchor) + 1));
  style.top = down ? `${rect.bottom + DROPDOWN_GAP}px` : "";
  style.bottom = down ? "" : `${window.innerHeight - rect.top + DROPDOWN_GAP}px`;
  style.maxHeight = `${Math.max(0, Math.min(wanted, down ? below : above))}px`;
}

const OPTION_STYLE: CSSProperties = {
  padding: "0.375rem 0.625rem",
  fontSize: "0.8125rem",
  cursor: "pointer",
  color: "var(--color-text-primary)",
};

// ── Debounce hook ─────────────────────────────────────────────────────────────

/** Debounce a value by `delay` ms. The data-owner feeds the result to its search
 * query hook, keeping fetching (a specialization concern) out of `Autocomplete`. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

/** A synthetic, keyboard-navigable row appended after the fetched items — e.g. a
 * "Create …" option. Selecting it runs `onSelect` and closes the dropdown. */
export interface AutocompleteAction {
  /** Stable key, distinct from every item key. */
  key: string;
  /** Row content. */
  node: ReactNode;
  onSelect: () => void;
  /** Extra style layered on the base row (accent color, separating border, …). */
  style?: CSSProperties;
}

export interface AutocompleteProps<T> {
  /** Current input text (controlled by the call site, which also debounces it). */
  value: string;
  /** Raw input change — fires on every keystroke before debouncing. */
  onValueChange: (value: string) => void;
  /** Current suggestions (from the call site's debounced search query). */
  items: readonly T[];
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  /** Synthetic rows appended after the items (keyboard-navigable). */
  actions?: AutocompleteAction[];
  placeholder?: string;
  /** Input style; defaults to {@link SEARCH_INPUT_STYLE}. */
  inputStyle?: CSSProperties;
  inputId?: string;
  disabled?: boolean;
  /** The lowest rank the dropdown is drawn at (default 30); inside a dialog it is raised above the
   *  dialog on its own. */
  zIndex?: number;
  /** Whether the dropdown may open for a query (default: non-empty when trimmed). */
  canOpen?: (value: string) => boolean;
  /** A key the dropdown did not consume — Enter with no row highlighted, Backspace, … — for a call
   *  site whose input means more than a search (the tag field commits a chip on Enter, #1192). */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}

export function Autocomplete<T>({
  value,
  onValueChange,
  items,
  getItemKey,
  renderItem,
  onSelect,
  actions = [],
  placeholder,
  inputStyle,
  inputId,
  disabled,
  zIndex = 30,
  canOpen = (v) => v.trim().length > 0,
  onKeyDown,
}: AutocompleteProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const itemKeys = items.map(getItemKey);
  const optionKeys = [...itemKeys, ...actions.map((a) => a.key)];
  const showDropdown = isOpen && optionKeys.length > 0;
  const activeOptionId = activeKey ? `${baseId}-${activeKey}` : undefined;

  // The list is portaled to `<body>` with fixed positioning (#1597), so a dialog's scrolling body
  // can never clip it. Placed before paint after every render while open — its rows change with
  // each keystroke, and so does the room it needs — and written straight onto the element, since
  // the place is a measurement and not something the render decides.
  useLayoutEffect(() => {
    if (showDropdown && containerRef.current && listRef.current) {
      placeDropdown(containerRef.current, listRef.current, zIndex);
    }
  });

  // While its list is up the autocomplete is the topmost escape layer, so Escape closes the list and
  // leaves the dialog it sits in open (#1597). It cannot stop the key from the input: the escape
  // stack listens on the document in the capture phase and would close the dialog first.
  useEscapeLayer(() => setIsOpen(false), showDropdown);

  // Close on any click outside the input+dropdown, and on a scroll or resize that would leave the
  // fixed list behind its field — except a scroll *within* the list, which is how a long one is read.
  useEffect(() => {
    if (!isOpen) return;
    function inside(target: EventTarget | null) {
      return (
        target instanceof Node &&
        (containerRef.current?.contains(target) || listRef.current?.contains(target))
      );
    }
    function onPointerDown(e: PointerEvent) {
      if (!inside(e.target)) setIsOpen(false);
    }
    function onScroll(e: Event) {
      if (!inside(e.target)) setIsOpen(false);
    }
    function onResize() {
      setIsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [isOpen]);

  // Keep the highlighted row scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!isOpen || !activeKey) return;
    document
      .getElementById(`${baseId}-${activeKey}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey, isOpen, baseId]);

  function close() {
    setIsOpen(false);
    setActiveKey(null);
  }

  function selectItem(item: T) {
    close();
    onSelect(item);
  }

  function selectAction(action: AutocompleteAction) {
    close();
    action.onSelect();
  }

  function selectKey(key: string) {
    const index = itemKeys.indexOf(key);
    if (index !== -1) {
      selectItem(items[index]);
      return;
    }
    const action = actions.find((a) => a.key === key);
    if (action) selectAction(action);
  }

  function moveActive(direction: 1 | -1) {
    if (optionKeys.length === 0) return;
    const current = activeKey ? optionKeys.indexOf(activeKey) : -1;
    const next =
      current === -1
        ? direction === 1
          ? 0
          : optionKeys.length - 1
        : (current + direction + optionKeys.length) % optionKeys.length;
    setActiveKey(optionKeys[next]);
  }

  function handleChange(next: string) {
    setActiveKey(null);
    setIsOpen(canOpen(next));
    onValueChange(next);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) setIsOpen(canOpen(value));
      else moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) setIsOpen(canOpen(value));
      else moveActive(-1);
    } else if (e.key === "Enter") {
      if (isOpen && activeKey) {
        e.preventDefault();
        selectKey(activeKey);
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    }
    if (!e.defaultPrevented) onKeyDown?.(e);
  }

  function renderRow(key: string, content: ReactNode, extraStyle?: CSSProperties) {
    return (
      <div
        key={key}
        id={`${baseId}-${key}`}
        role="option"
        aria-selected={activeKey === key}
        // Keep focus on the input so click-selection doesn't blur mid-interaction.
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActiveKey(key)}
        onClick={() => selectKey(key)}
        style={{
          ...OPTION_STYLE,
          background: activeKey === key ? "var(--color-bg-page)" : "transparent",
          ...extraStyle,
        }}
      >
        {content}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <TextInput
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        // No open-on-focus: the dropdown opens only when the user types (or presses ↓), so a
        // pre-filled/auto-focused field never pops its suggestions unprompted.
        onKeyDown={handleKeyDown}
        style={inputStyle ?? SEARCH_INPUT_STYLE}
      />
      {showDropdown &&
        createPortal(
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            style={DROPDOWN_STYLE}
          >
            {items.map((item) => renderRow(getItemKey(item), renderItem(item)))}
            {actions.map((action) => renderRow(action.key, action.node, action.style))}
          </div>,
          document.body
        )}
    </div>
  );
}
