# 0003 — Tree-select pattern for hierarchical pickers

## Status

Accepted

## Context

The collection areas feature (#39) introduced a parent-child area hierarchy. The initial implementation used a flat HTML `<select>` with em-dash depth prefixes to convey hierarchy, which does not communicate structure well and becomes hard to navigate as the tree grows.

Issue #62 requires replacing this with a proper tree-aware picker that shows expandable/collapsible nodes, supports keyboard navigation, and will be reused for stamp assignment (#40) and stamp list filtering (#41).

## Decision

Implement a custom tree-select primitive using the pattern established in the ohm-sweet-ohm sibling project (`/Users/michalwy/ohm-sweet-ohm`). The implementation consists of three layers:

1. **`src/app/tree-picker-utils.ts`** — Generic, pure TypeScript utilities:
   - `buildTree<T>` — converts a flat array with `parentId` references into a `TreeNode<T>[]` hierarchy
   - `getAncestorIds` / `getExpandableIds` / `getVisibleOptions` — state helpers
   - `getFloatingPanelStyle` — positions a dropdown panel above or below its anchor

2. **`src/app/tree-select.tsx`** — Generic React hook and UI primitives:
   - `useTreeSelect<T>` — manages open/closed, search, expansion, keyboard navigation
   - `TreeSelectButton` — the trigger button
   - `TreeSelectPanel` — the floating dropdown with search input and listbox, rendered via `createPortal`

3. **Domain-specific wrapper** (e.g. `src/app/area-tree-select.tsx`):
   - Binds the generic primitives to a concrete data type
   - Computes the selected-value label (area path shown as "Poland › 1918–1939")
   - Renders a hidden `<input>` for server-action form submission
   - Supplies `filterAreaTree` for real-time search

## Rationale

- **No external library**: the pattern is straightforward and already battle-tested in a sibling project; an external dependency would need evaluation and updates tracking
- **Generic core, domain-specific shell**: the two base files (`tree-picker-utils.ts`, `tree-select.tsx`) are reusable for any hierarchy; each domain gets its own thin wrapper
- **Portal rendering**: the dropdown is rendered via `createPortal` to avoid overflow clipping inside dialogs and scrollable containers
- **Form compatibility**: a hidden `<input>` carries the selected ID so server actions can read it from `FormData` without changes to action signatures

## Consequences

- New components must follow the three-layer pattern when adding another tree picker (e.g. catalog hierarchy if needed in the future)
- `tree-picker-utils.ts` and `tree-select.tsx` must remain free of domain logic
- Tailwind CSS classes are used in the tree-select layer (consistent with Tailwind 4 already in use); domain wrappers may use inline styles where that matches the surrounding component
