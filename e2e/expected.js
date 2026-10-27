// The numbers the page should show, worked out from the committed data with
// the same modules site/app.js uses, so the specs keep passing when the daily
// update changes the counts.
import { readFileSync } from "node:fs";
import { RULES, exclusionReason } from "../site/filter.js";
import { riskFreeReturns, sharpeRatio } from "../site/sharpe.js";

export const data = JSON.parse(readFileSync(new URL("../site/data/funds.json", import.meta.url), "utf8"));

const riskFree = riskFreeReturns(data.funds);

export const funds = data.funds.map((raw) => {
  const fund = { ...raw, sharpe: sharpeRatio(raw.prices, riskFree) };
  return { ...fund, reason: exclusionReason(fund) };
});

export const passing = funds.filter((f) => !f.reason);
export const excluded = funds.filter((f) => f.reason);

// Excluded funds per rule, in the order of the rule cards.
export const ruleCounts = RULES.map((rule) => excluded.filter((f) => f.reason.rule === rule.id).length);

// Counts as the page formats them, e.g. "1,071".
export const formatCount = (n) => new Intl.NumberFormat("en-US").format(n);

// Lower-case with Turkish rules, as the page's search does.
export const normalize = (text) => text.toLocaleLowerCase("tr-TR");

// The fund types in the data, in the order of the type filter's options.
export const umbrellas = [...new Set(funds.map((f) => f.umbrella).filter(Boolean))].sort((a, b) =>
  a.localeCompare(b, "tr"),
);

// The funds the type and risk filters leave ("" means no filter), as
// { all, passing, excluded }.
export function filtered({ type = "", risk = "" } = {}) {
  const all = funds.filter((f) => (!type || f.umbrella === type) && (!risk || f.risk === Number(risk)));
  return { all, passing: all.filter((f) => !f.reason), excluded: all.filter((f) => f.reason) };
}
