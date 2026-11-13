// How the list of posts words a post's dates (#2502) — "12 Nov", "14 Nov 20:00", "(1 day ago)",
// "(tomorrow)". Read only in the browser: the list is fetched after mount, and the collector's own zone
// and locale are known only there (#490). Days are counted in calendar days, so an auction ending at
// eight tomorrow evening is "tomorrow" however many hours away it is.

const DAY = 24 * 60 * 60 * 1000;
const PAST = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });
const FUTURE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** A `YYYY-MM-DD` calendar day as a local date, so it is not moved a day by the zone. */
export function calendarDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "today", "tomorrow", "in 3 days", "1 day ago". */
export function relativeDay(when: Date, now: Date): string {
  const days = Math.round((startOfDay(when) - startOfDay(now)) / DAY);
  return days < 0 ? PAST.format(days, "day") : FUTURE.format(days, "day");
}

/** "12 Nov" — with the year when it is not this one. */
export function shortDay(when: Date, now: Date): string {
  return when.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(when.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "14 Nov 20:00". */
export function shortDayTime(when: Date, now: Date): string {
  return `${shortDay(when, now)} ${when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
