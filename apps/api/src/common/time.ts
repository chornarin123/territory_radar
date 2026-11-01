export const TIMEZONE = 'Asia/Phnom_Penh';

const DAY_MS = 86_400_000;

/** Calendar date (YYYY-MM-DD) in Cambodia for the given instant. */
export function localDate(at: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(at);
}

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** First instant of the calendar month containing `at`, in UTC. */
export function startOfMonthUtc(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}
