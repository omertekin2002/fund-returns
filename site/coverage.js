// What the daily edition covers: the price dates in the data file and how many
// funds lack a 1M return, a Sharpe ratio or a risk level. TEFAS gives no date
// for the period returns, so only the price dates are named.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const countFormat = new Intl.NumberFormat("en-US");
// Price dates are calendar dates, so they are read and formatted in UTC.
const fullFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" });
const dayMonthFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

const isMissing = (value) => value === null || value === undefined;

// A "YYYY-MM-DD" string that names a real calendar date.
function isDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// The data file's price window, { first, last, count }: its first and last
// price date and how many there are. Null when priceDates is missing, empty or
// not a list of "YYYY-MM-DD" dates.
export function priceWindow(priceDates) {
  if (!Array.isArray(priceDates) || priceDates.length === 0 || !priceDates.every(isDate)) return null;
  return { first: priceDates[0], last: priceDates[priceDates.length - 1], count: priceDates.length };
}

// How many of the funds (classified with classifyFunds, so they carry the
// page's own Sharpe ratios) have no 1M return, no Sharpe ratio and no risk
// level, out of total.
export function coverageCounts(funds) {
  return {
    total: funds.length,
    noMonthReturn: funds.filter((f) => isMissing(f.returns?.["1m"])).length,
    noSharpe: funds.filter((f) => isMissing(f.sharpe)).length,
    noRisk: funds.filter((f) => isMissing(f.risk)).length,
  };
}

// The price window and the coverage counts of a parsed data file, given its
// classified funds.
export function dataCoverage(data, funds) {
  return { window: priceWindow(data?.priceDates), counts: coverageCounts(funds) };
}

// The banner line, e.g. "Prices 2 Oct – 30 Oct 2026 (20 days)", or "Price
// dates unknown" without a window.
export function priceWindowText(window) {
  if (!window) return "Price dates unknown";
  const first = new Date(`${window.first}T00:00:00Z`);
  const last = new Date(`${window.last}T00:00:00Z`);
  let range;
  if (window.first === window.last) range = fullFormat.format(last);
  else if (window.first.slice(0, 4) === window.last.slice(0, 4)) {
    range = `${dayMonthFormat.format(first)} – ${fullFormat.format(last)}`;
  } else range = `${fullFormat.format(first)} – ${fullFormat.format(last)}`;
  const days = `${countFormat.format(window.count)} ${window.count === 1 ? "day" : "days"}`;
  return `Prices ${range} (${days})`;
}

// "a, b and c"
function joinClauses(clauses) {
  if (clauses.length === 1) return clauses[0];
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

// The rail's coverage sentence, e.g. "Of 1,071 funds, 9 have no 1M return
// (rule 1 excludes them), 8 have no Sharpe ratio (rule 6 allows that) and 117
// have no risk level." A clause whose count is 0 is left out.
export function coverageText({ total, noMonthReturn, noSharpe, noRisk }) {
  if (total === 0) return "The data has no funds.";
  const has = (n) => `${countFormat.format(n)} ${n === 1 ? "has" : "have"}`;
  const clauses = [];
  if (noMonthReturn > 0) {
    clauses.push(`${has(noMonthReturn)} no 1M return (rule 1 excludes ${noMonthReturn === 1 ? "it" : "them"})`);
  }
  if (noSharpe > 0) clauses.push(`${has(noSharpe)} no Sharpe ratio (rule 6 allows that)`);
  if (noRisk > 0) clauses.push(`${has(noRisk)} no risk level`);
  if (clauses.length === 0) {
    return total === 1
      ? "The one fund has a 1M return, a Sharpe ratio and a risk level."
      : `All ${countFormat.format(total)} funds have a 1M return, a Sharpe ratio and a risk level.`;
  }
  return `Of ${countFormat.format(total)} ${total === 1 ? "fund" : "funds"}, ${joinClauses(clauses)}.`;
}
