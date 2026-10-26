// Whether the data file is stale: a whole Istanbul weekday (Monday to Friday)
// has gone by without a fetch. The update runs every weekday, sometimes hours
// late, so data from the last weekday before today still counts as fresh
// (e.g. Friday's data on Saturday, Sunday and Monday). Public holidays need no
// calendar: the workflow still runs and writes a new fetchedAt on those days.

const TIME_ZONE = "Europe/Istanbul";
const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The Istanbul calendar date of an instant, as "YYYY-MM-DD"; null if invalid.
export function istanbulDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(dateFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// The most recent weekday strictly before a "YYYY-MM-DD" date: the last day
// whose update should be in by now.
export function previousWeekday(day) {
  let time = Date.parse(`${day}T00:00:00Z`);
  do {
    time -= DAY_MS;
  } while ([0, 6].includes(new Date(time).getUTCDay()));
  return new Date(time).toISOString().slice(0, 10);
}

// True when fetchedAt (an ISO timestamp) is older than the last weekday
// before today in Istanbul. A missing or unparseable fetchedAt is stale.
export function isStale(fetchedAt, now = new Date()) {
  const fetched = typeof fetchedAt === "string" ? istanbulDate(new Date(fetchedAt)) : null;
  if (!fetched) return true;
  const today = istanbulDate(now);
  if (!today) return true;
  return fetched < previousWeekday(today);
}
