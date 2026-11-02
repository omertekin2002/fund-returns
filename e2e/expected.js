// The numbers the page should show, worked out from the committed data with
// the same modules site/app.js uses, so the specs keep passing when the daily
// update changes the counts.
import { existsSync, readFileSync } from "node:fs";
import { classifyFunds, membershipChanges } from "../site/changes.js";
import { dataCoverage } from "../site/coverage.js";
import { RULES } from "../site/filter.js";
import { RISK_FREE_UMBRELLA } from "../site/sharpe.js";
import { sparkline } from "../site/sparkline.js";

export const data = JSON.parse(readFileSync(new URL("../site/data/funds.json", import.meta.url), "utf8"));

export const funds = classifyFunds(data.funds);

// The committed previous update (data/previous.json), or null before the
// first daily update has kept one.
const previousUrl = new URL("../site/data/previous.json", import.meta.url);
export const committedPrevious = existsSync(previousUrl) ? JSON.parse(readFileSync(previousUrl, "utf8")) : null;

// Whether each fund has a 4-week price line (at least two valid prices), by code.
export const hasTrend = new Map(funds.map((f) => [f.code, sparkline(f.prices, data.priceDates.length) !== null]));

// The price window and the counts of funds without a 1M return, a Sharpe
// ratio or a risk level, over every fund.
export const coverage = dataCoverage(data, funds);

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

// A previous.json for the change specs: the committed data a day earlier,
// with known changes. Two passing funds failed the 1M rule then (so they
// entered), two excluded funds had a passing fund's returns and prices then
// (so they left), a passing fund no longer in the data (so it left and is
// gone), and another passing fund was not in the data yet (so it entered by
// appearing). Money market funds are left alone so the risk-free return is the
// same. The expected changes are worked out with changes.js, as the page does.
export function previousData() {
  const enteredCodes = passing.slice(0, 2).map((f) => f.code);
  const leftCodes = excluded
    .filter((f) => f.umbrella !== RISK_FREE_UMBRELLA)
    .slice(0, 2)
    .map((f) => f.code);
  const donor = data.funds.find((f) => f.code === passing.find((p) => p.umbrella !== RISK_FREE_UMBRELLA).code);
  const goneFund = { ...donor, code: "ZZGONE", name: "GONE FUND" };
  const newCode = passing.find(
    (f) => f.umbrella !== RISK_FREE_UMBRELLA && f.code !== donor.code && !enteredCodes.includes(f.code),
  ).code;
  const previousFunds = data.funds
    .filter((raw) => raw.code !== newCode)
    .map((raw) => {
      if (enteredCodes.includes(raw.code)) return { ...raw, returns: { ...raw.returns, "1m": 0 } };
      if (leftCodes.includes(raw.code)) return { ...raw, returns: donor.returns, prices: donor.prices };
      return raw;
    });
  const previous = {
    ...data,
    fetchedAt: new Date(new Date(data.fetchedAt).getTime() - 24 * 60 * 60 * 1000).toISOString(),
    funds: [...previousFunds, goneFund],
  };
  const changes = membershipChanges(funds, classifyFunds(previous.funds));
  return { previous, changes, enteredCodes, leftCodes, goneCode: goneFund.code, newCode };
}
