// Screening rules for the fund list. Returns are cumulative percentages
// (e.g. 3.5 means +3.5%) keyed by horizon: 1m, 3m, 6m, 1y, ytd, 3y, 5y.

export const HORIZONS = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "ytd", label: "YTD" },
  { key: "3y", label: "3Y" },
  { key: "5y", label: "5Y" },
];

// Minimum returns. A fund with no 1M return is excluded; for the other
// horizons a missing return is allowed.
export const MINIMUM_RETURNS = [
  { key: "1m", min: 3, required: true },
  { key: "3m", min: 9, required: false },
  { key: "6m", min: 19, required: false },
  { key: "1y", min: 42.5, required: false },
];

// Fixed-length horizons from shortest to longest. A longer horizon must never
// have a lower return than a shorter one. YTD is left out because its length
// changes through the year.
export const ORDERED_HORIZONS = ["1m", "3m", "6m", "1y", "3y", "5y"];

export const RULES = [
  { id: "min-1m", title: "1-month return", text: "Out if it is missing or below 3%." },
  { id: "min-3m", title: "3-month return", text: "Out if it is below 9%. A missing value is allowed." },
  { id: "min-6m", title: "6-month return", text: "Out if it is below 19%. A missing value is allowed." },
  { id: "min-1y", title: "1-year return", text: "Out if it is below 42.5%. A missing value is allowed." },
  {
    id: "order",
    title: "Longer beats shorter",
    text: "Out if any longer period (1M, 3M, 6M, 1Y, 3Y, 5Y) returned less than a shorter one. YTD is not compared.",
  },
];

const label = (key) => HORIZONS.find((h) => h.key === key).label;
const fmt = (value) => `${value.toFixed(2)}%`;
const isMissing = (value) => value === null || value === undefined;

// Returns null if the fund passes every rule, otherwise the first rule it
// breaks as { rule, detail }.
export function exclusionReason(fund) {
  const returns = fund.returns;

  for (const { key, min, required } of MINIMUM_RETURNS) {
    const value = returns[key];
    if (isMissing(value)) {
      if (required) return { rule: `min-${key}`, detail: `No ${label(key)} return` };
      continue;
    }
    if (value < min) {
      return { rule: `min-${key}`, detail: `${label(key)} ${fmt(value)} < ${min}%` };
    }
  }

  // Comparing every pair (not just neighbours) catches cases where a
  // horizon in between is missing, e.g. 1M 5% vs 6M 4% with no 3M.
  const available = ORDERED_HORIZONS.filter((key) => !isMissing(returns[key]));
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const shorter = available[i];
      const longer = available[j];
      if (returns[longer] < returns[shorter]) {
        return {
          rule: "order",
          detail: `${label(longer)} ${fmt(returns[longer])} < ${label(shorter)} ${fmt(returns[shorter])}`,
        };
      }
    }
  }

  return null;
}
