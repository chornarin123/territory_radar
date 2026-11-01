// Dates in this app are always read in Phnom Penh time (+07:00), never the device's
// zone: a phone set to UTC must still see the same "today" visits and overdue tasks.
// data.json writes every timestamp with a +07:00 offset; "now" is metadata.asOf when
// metadata.fixedClock is true (spec §3).

const OFFSET_MS = 7 * 3_600_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Wall-clock parts in Phnom Penh for an ISO timestamp. */
function parts(iso: string) {
  const d = new Date(Date.parse(iso) + OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-15" — the calendar day in Phnom Penh. */
export function localDay(iso: string): string {
  const p = parts(iso);
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.day)}`;
}

/** "10:00" */
export function timeOfDay(iso: string): string {
  const p = parts(iso);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** "15 Oct" */
export function shortDate(iso: string): string {
  const p = parts(iso);
  return `${p.day} ${MONTHS[p.mo]}`;
}

/** "Thu 15 Oct 2026" */
export function longDate(iso: string): string {
  const p = parts(iso);
  return `${DAYS[p.dow]} ${p.day} ${MONTHS[p.mo]} ${p.y}`;
}

/** "Thu 15 Oct" */
export function dayMonth(iso: string): string {
  const p = parts(iso);
  return `${DAYS[p.dow]} ${p.day} ${MONTHS[p.mo]}`;
}

/** "Mon" */
export function weekday(iso: string): string {
  return DAYS[parts(iso).dow]!;
}

/** "Good morning" / "Good afternoon" / "Good evening" for the Phnom Penh hour. */
export function greeting(iso: string): string {
  const h = parts(iso).h;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
