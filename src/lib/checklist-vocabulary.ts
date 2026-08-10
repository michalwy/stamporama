// The one word about checklists (#531) that both halves of the app need. Pure and free of
// `server-only`, because the stamp form is a client component and the sentinel it submits has to
// mean the same thing on both ends.

/**
 * The stamp form's stand-in for "the issue's own set", sent instead of a real checklist id. The
 * dialog is often the very thing that *starts* an issue — the first stamp of a freshly created
 * one — and at that moment there is no checklist to name yet. Ticking the box then means what
 * `requiredForCompleteness = true` meant: this stamp belongs to the set this issue is.
 */
export const DEFAULT_CHECKLIST = "default";
