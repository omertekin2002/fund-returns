// Screening rules for the fund list. Returns are cumulative percentages
// (e.g. 3.5 means +3.5%) keyed by horizon: 1m, 3m, 6m, 1y, ytd, 3y, 5y.
// "sharpe" is the fund's 4-week Sharpe ratio from sharpe.js, or null.
import { MIN_RETURNS } from "./sharpe.js";

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

// Minimum 4-week Sharpe ratio. A fund without one (fewer than 10 daily
// returns in the window) is allowed.
export const MIN_SHARPE = 1;

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
  { id: "min-sharpe", title: "Sharpe ratio", text: "Out if the 4-week Sharpe ratio is below 1.0. A missing value is allowed." },
];

const label = (key) => HORIZONS.find((h) => h.key === key).label;
const fmt = (value) => `${value.toFixed(2)}%`;
const isMissing = (value) => value === null || value === undefined;

// How a fund fares on each rule, one entry per rule in RULES order, all six
// worked out even after the first failure:
//   rule:        the rule id;
//   outcome:     "pass", "fail", or "missing-allowed" (the value is absent and
//                the rule allows that);
//   measured:    the fund's value(s), e.g. "3M 12.40%" or "No 1Y return";
//   requirement: the rule's threshold in words;
//   detail:      on "fail", the text the Reason column shows; otherwise null.
export function ruleEvidence(fund) {
  const returns = fund.returns;
  const entry = (rule, outcome, measured, requirement, detail = null) => ({
    rule,
    outcome,
    measured,
    requirement,
    detail,
  });

  const minimums = MINIMUM_RETURNS.map(({ key, min, required }) => {
    const rule = `min-${key}`;
    const requirement = `${label(key)} at least ${min}%${required ? ", required" : "; missing is allowed"}`;
    const value = returns[key];
    if (isMissing(value)) {
      const measured = `No ${label(key)} return`;
      return required
        ? entry(rule, "fail", measured, requirement, measured)
        : entry(rule, "missing-allowed", measured, requirement);
    }
    const measured = `${label(key)} ${fmt(value)}`;
    return value < min
      ? entry(rule, "fail", measured, requirement, `${measured} < ${min}%`)
      : entry(rule, "pass", measured, requirement);
  });

  return [...minimums, orderEvidence(returns, entry), sharpeEvidence(fund.sharpe, entry)];
}

function orderEvidence(returns, entry) {
  const requirement =
    `No longer period below a shorter one (${ORDERED_HORIZONS.map(label).join(" ≤ ")}); ` +
    "missing periods are skipped";
  const available = ORDERED_HORIZONS.filter((key) => !isMissing(returns[key]));
  // Fewer than two returns leave nothing to compare.
  if (available.length < 2) {
    const measured =
      available.length === 0
        ? "No returns to compare"
        : `Only ${label(available[0])} ${fmt(returns[available[0]])}, nothing to compare`;
    return entry("order", "missing-allowed", measured, requirement);
  }
  const listed = available.map((key) => `${label(key)} ${fmt(returns[key])}`).join(" · ");

  // Comparing every pair (not just neighbours) catches cases where a
  // horizon in between is missing, e.g. 1M 5% vs 6M 4% with no 3M.
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const shorter = available[i];
      const longer = available[j];
      if (returns[longer] < returns[shorter]) {
        const detail = `${label(longer)} ${fmt(returns[longer])} < ${label(shorter)} ${fmt(returns[shorter])}`;
        return entry("order", "fail", `${listed}; ${detail}`, requirement, detail);
      }
    }
  }
  return entry("order", "pass", listed, requirement);
}

function sharpeEvidence(sharpe, entry) {
  const requirement = `Sharpe at least ${MIN_SHARPE.toFixed(1)}; missing is allowed`;
  if (isMissing(sharpe)) {
    return entry(
      "min-sharpe",
      "missing-allowed",
      `No Sharpe ratio (fewer than ${MIN_RETURNS} daily returns, or no variation)`,
      requirement,
    );
  }
  const measured = `Sharpe ${sharpe.toFixed(2)}`;
  return sharpe < MIN_SHARPE
    ? entry("min-sharpe", "fail", measured, requirement, `${measured} < ${MIN_SHARPE.toFixed(1)}`)
    : entry("min-sharpe", "pass", measured, requirement);
}

// Returns null if the fund passes every rule, otherwise the first rule it
// breaks as { rule, detail }: the first failing entry of ruleEvidence.
export function exclusionReason(fund) {
  const failed = ruleEvidence(fund).find((e) => e.outcome === "fail");
  return failed ? { rule: failed.rule, detail: failed.detail } : null;
}
