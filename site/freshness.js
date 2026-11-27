// Whether the data file is stale: a whole Istanbul weekday (Monday to Friday)
// has gone by without a fetch. The update runs every weekday, sometimes hours
// late, so data from the last weekday before today still counts as fresh
// (e.g. Friday's data on Saturday, Sunday and Monday). Public holidays need no
// calendar: the workflow still runs and writes a new fetchedAt on those days.
//
// Whether the prices lag the update (pricesBehind): fetchedAt is the retrieval
// time, not the price date, so an update can be fresh while its last TEFAS
// price is days old.

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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A "YYYY-MM-DD" string that names a real calendar date.
function isDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// The Istanbul day of an ISO fetchedAt, as "YYYY-MM-DD"; null if unreadable.
function fetchDay(fetchedAt) {
  return typeof fetchedAt === "string" ? istanbulDate(new Date(fetchedAt)) : null;
}

// True when the last price date ("YYYY-MM-DD") is behind the update: earlier
// than the last weekday before the Istanbul day of fetchedAt. Prices from that
// weekday are normal (a holiday, or a run just after midnight), so only two or
// more weekdays of lag count. An unreadable fetchedAt or a missing or invalid
// last price date is not behind: the stale warning and "Price dates unknown"
// already cover those.
export function pricesBehind(fetchedAt, lastPriceDate) {
  const fetched = fetchDay(fetchedAt);
  if (!fetched || !isDate(lastPriceDate)) return false;
  return lastPriceDate < previousWeekday(fetched);
}

// Both days are calendar dates, so they are formatted in UTC.
const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" });
const formatDay = (day) => dayFormat.format(new Date(`${day}T00:00:00Z`));

// The warning for prices behind the update, e.g. "TEFAS prices end on 20 Nov
// 2026, before this update on 27 Nov 2026: the Sharpe ratios and 4-week price
// lines stop at that day.", or null when pricesBehind is false. Only those
// come from the prices: TEFAS gives no date for the period returns, so the
// warning doesn't date them.
export function pricesBehindText(fetchedAt, lastPriceDate) {
  if (!pricesBehind(fetchedAt, lastPriceDate)) return null;
  return (
    `TEFAS prices end on ${formatDay(lastPriceDate)}, before this update on ${formatDay(fetchDay(fetchedAt))}: ` +
    "the Sharpe ratios and 4-week price lines stop at that day."
  );
}
