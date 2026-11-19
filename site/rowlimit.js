// How many of the table's rows the Excluded and All views build at first.
// Laying out about a thousand rows takes over a second on a mid-range phone,
// so those views show the first ROW_LIMIT rows of the sorted, filtered list,
// with a button that shows the rest. The Passing view is never capped. The
// search, filters, sort, view counts and CSV still cover every matching fund;
// only the rows on screen are capped. Used by app.js, which sets the text with
// textContent.

export const ROW_LIMIT = 100;

// The views whose rows are capped.
const CAPPED_VIEWS = new Set(["excluded", "all"]);

const countFormat = new Intl.NumberFormat("en-US");

// The rows to build for the view, from `funds` (every fund the view, filters
// and search select, in table order), and whether the reader has asked for
// every row: { shown, hidden }, where `shown` is the funds to render and
// `hidden` how many are left out (0 when nothing is).
export function visibleRows(view, funds, showAll) {
  if (showAll || !CAPPED_VIEWS.has(view) || funds.length <= ROW_LIMIT) return { shown: funds, hidden: 0 };
  return { shown: funds.slice(0, ROW_LIMIT), hidden: funds.length - ROW_LIMIT };
}

// The line under a capped table, e.g. "Showing the first 100 of 1,075 funds."
export const cappedText = (shown, total) =>
  `Showing the first ${countFormat.format(shown)} of ${countFormat.format(total)} funds.`;

// The button that shows every row, e.g. "Show all 1,075 funds".
export const showAllText = (total) => `Show all ${countFormat.format(total)} funds`;
