// Variants of a data file (site/data/funds.json) for the tests, so that they
// check the code rather than the day's market: the daily update can bring a
// day on which few or no funds pass the rules. Used by the unit tests and by
// the page tests (e2e/expected.js). Not a test file itself: `node --test`
// only runs files named *.test.mjs here.
import { classifyFunds } from "../site/changes.js";
import { RISK_FREE_UMBRELLA } from "../site/sharpe.js";

// How many funds withPassingFunds makes pass by default: enough for the
// change specs' previous update (two funds that entered, a donor and a new
// fund outside the money market umbrella).
export const FORCED_PASSING = 4;

// Returns above every rule's minimum, each longer horizon above the shorter.
const PASSING_RETURNS = { "1m": 5, "3m": 15, "6m": 35, "1y": 70, "3y": 250, "5y": 600 };

// A copy of the fund that passes every rule. Its 1M return and the longer
// returns it has are set to PASSING_RETURNS (missing ones stay missing; YTD
// is not part of the rules). On each day it has a price, the price rises
// about 0.5% a day with a small wobble, far above the money market funds'
// return, so its Sharpe ratio is well above 1.0. Days without a price stay
// without one, so its Sharpe period and 4-week line cover the same days.
export function passingFund(fund) {
  const returns = { ...fund.returns };
  for (const [key, value] of Object.entries(PASSING_RETURNS)) {
    if (key === "1m" || returns[key] != null) returns[key] = value;
  }
  const prices = fund.prices?.map((price, day) =>
    typeof price === "number" && price > 0
      ? Math.round(10 * 1.005 ** day * (1 + 0.002 * Math.sin(day)) * 1e6) / 1e6
      : price,
  );
  return { ...fund, returns, prices };
}

// The data with `count` more funds passing every rule, and the codes of
// those funds. They are the first excluded funds by code outside the money
// market umbrella (so the risk-free return is unchanged) with a risk level, a
// name with "PORTFÖY" in it and a Sharpe ratio over the full window, so the
// specs that look for such passing funds find them whatever the day's data.
export function withPassingFunds(data, count = FORCED_PASSING) {
  const codes = classifyFunds(data.funds)
    .filter(
      (f) =>
        f.reason &&
        f.umbrella !== RISK_FREE_UMBRELLA &&
        f.risk != null &&
        /PORTFÖY/.test(f.name) &&
        f.sharpe !== null &&
        !f.sharpeShort,
    )
    .map((f) => f.code)
    .sort((a, b) => a.localeCompare(b, "tr"))
    .slice(0, count);
  if (codes.length < count) {
    throw new Error(`The data has ${codes.length} funds that can be made to pass, not ${count}`);
  }
  const forced = new Set(codes);
  const result = { ...data, funds: data.funds.map((f) => (forced.has(f.code) ? passingFund(f) : f)) };
  const failing = classifyFunds(result.funds).filter((f) => forced.has(f.code) && f.reason);
  if (failing.length > 0) {
    throw new Error(`Funds made to pass still fail: ${failing.map((f) => `${f.code} (${f.reason.rule})`).join(", ")}`);
  }
  return { data: result, codes };
}

// The data with a size (total value in TL, the "size" field fetch_funds.py
// writes) on every fund but every ninth, which has none. The sizes run from
// thousands to billions of TL, so the Size column shows every unit. Applied
// over any sizes the data already has, so the specs don't depend on the day's
// file, which may predate the Size column.
export function withSizes(data) {
  return {
    ...data,
    funds: data.funds.map((f, i) => ({
      ...f,
      size: i % 9 === 0 ? null : Math.round(10 ** (2 + (i % 9)) * (1 + ((i * 37) % 100) / 100) * 100) / 100,
    })),
  };
}

// The data as it was before the Size column: no fund has a "size" field.
export function withoutSizes(data) {
  return { ...data, funds: data.funds.map(({ size, ...f }) => f) };
}

// The data on a day when no fund passes: every fund's 1M return is 0, below
// rule 1's minimum.
export function withoutPassingFunds(data) {
  return { ...data, funds: data.funds.map((f) => ({ ...f, returns: { ...f.returns, "1m": 0 } })) };
}

// The data on a day when exactly one fund passes, outside the money market
// umbrella.
export function withOnePassingFund(data) {
  return withPassingFunds(withoutPassingFunds(data), 1);
}
