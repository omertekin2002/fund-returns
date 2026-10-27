// The fund table's columns, in display order. Each column's key is also the
// name used for it in the page URL's sort parameter (see urlstate.js).
import { HORIZONS } from "./filter.js";

export const COLUMNS = [
  { key: "code", label: "Code", type: "text", value: (f) => f.code },
  { key: "name", label: "Fund", type: "text", value: (f) => f.name },
  { key: "umbrella", label: "Type", type: "text", value: (f) => f.umbrella },
  { key: "risk", label: "Risk", type: "number", value: (f) => f.risk },
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
    title: "Sharpe ratio over the last 4 weeks of daily prices, annualised, against the median money market fund",
  },
  { key: "reason", label: "Reason", type: "text", value: (f) => f.reason?.detail ?? "" },
];
