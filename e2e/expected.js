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
