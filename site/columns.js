// The fund table's columns, in display order. Each column's key is also the
// name used for it in the page URL's sort parameter (see urlstate.js).
// Columns with `sortable: false` have a plain header and can't be sorted by.
// A `csvLabel` names the column in the CSV header instead of its label.
import { HORIZONS } from "./filter.js";
import { fundSize } from "./size.js";

export const COLUMNS = [
  { key: "code", label: "Code", type: "text", value: (f) => f.code },
  { key: "name", label: "Fund", type: "text", value: (f) => f.name },
  { key: "umbrella", label: "Type", type: "text", value: (f) => f.umbrella },
  { key: "risk", label: "Risk", type: "number", value: (f) => f.risk },
  {
    key: "size",
    label: "Size",
    csvLabel: "Size (TL)",
    type: "size",
    value: fundSize,
    title: "The fund's total value in TL on its latest price date",
  },
  ...HORIZONS.map((h) => ({
    key: h.key,
    label: h.label,
    type: "return",
    value: (f) => f.returns[h.key],
  })),
  {
    key: "sharpe",
    label: "Sharpe",
    type: "ratio",
    value: (f) => f.sharpe,
    title: "Sharpe ratio over the last 6 months of daily prices, annualised, against the median money market fund",
  },
  {
    key: "trend",
    label: "4 weeks",
    type: "sparkline",
    sortable: false,
    // The line worked out by sparkline.js when the data loads (null without one).
    value: (f) => f.trend,
    title: "Daily prices over the last 4 weeks, each line scaled to its own fund's range; gaps are days without a price",
  },
  { key: "reason", label: "Reason", type: "text", value: (f) => f.reason?.detail ?? "" },
];

// The table's order on a phone (PHONE_QUERY): the Code, then the numbers the
// rules use (and why a fund was excluded), so they show on the first screen
// without scrolling sideways; then the rest in their usual order.
export const PHONE_ORDER = [
  "code",
  "reason",
  "1m",
  "3m",
  "6m",
  "1y",
  "sharpe",
  "name",
  "umbrella",
  "risk",
  "size",
  "ytd",
  "3y",
  "5y",
  "trend",
];

// The screens that get PHONE_ORDER: the phone breakpoint in style.css.
export const PHONE_QUERY = "(max-width: 480px)";

const PHONE_COLUMNS = PHONE_ORDER.map((key) => COLUMNS.find((c) => c.key === key));

// The columns shown in a view, in COLUMNS order, or in PHONE_ORDER with
// `phone`. The Reason column only lists why a fund was excluded, so the
// Passing view leaves it out. The order is for display only: the CSV calls
// this without `phone`, so its columns keep the same order at every width.
export function columnsFor(view, { phone = false } = {}) {
  const columns = phone ? PHONE_COLUMNS : COLUMNS;
  return view === "passing" ? columns.filter((c) => c.key !== "reason") : columns;
}
