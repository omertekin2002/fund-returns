// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_RETURNS,
  RISK_FREE_UMBRELLA,
  dailyReturns,
  moneyMarketReturns,
  rateReturns,
  riskFreeMeasures,
  riskFreeReturns,
  sharpePeriod,
  sharpeRatio,
} from "../site/sharpe.js";

// Prices that start at 1 and move by the given daily returns.
const pricesFrom = (returns) => returns.reduce((prices, r) => [...prices, prices.at(-1) * (1 + r)], [1]);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("daily returns skip days without a price", () => {
  const returns = dailyReturns([100, 102, null, 104, 0, 105]);
  close(returns[0], 0.02);
  assert.deepEqual(returns.slice(1), [null, null, null, null]);
  assert.deepEqual(dailyReturns(undefined), []);
});

const mm = (prices) => ({ umbrella: RISK_FREE_UMBRELLA, prices });

test("the money market return is the median money market fund each day", () => {
  const funds = [
    mm([1, 1.01, 1.02]),
    mm([1, 1.03, null]),
    mm([1, 1.02, 1.0404]),
    // Other fund types are ignored.
    { umbrella: "Hisse Senedi Şemsiye Fonu", prices: [1, 2, 4] },
  ];
  const returns = moneyMarketReturns(funds);
  close(returns[0], 0.02); // median of 1%, 3%, 2%
  close(returns[1], (1.02 / 1.01 - 1 + 0.02) / 2); // two funds priced: mean of the middle pair
  assert.deepEqual(moneyMarketReturns([]), []);
  // Without rates in the data file it is the only measure of the risk-free return.
  assert.deepEqual(riskFreeReturns(funds), returns);
  assert.deepEqual(riskFreeReturns([]), []);
});

test("money market funds with a negative day or a jump are left out of the median", () => {
  const steady = [mm([1, 1.001, 1.002, 1.003]), mm([1, 1.002, 1.004, 1.006]), mm([1, 1.003, 1.006, 1.009])];
  const expected = moneyMarketReturns(steady);
  // A write-down on one day, and a return of more than twice the day's median.
  const writeDown = mm([1, 1.004, 0.9, 0.904]);
  const jump = mm([1, 1.004, 1.008, 1.1]);
  assert.deepEqual(moneyMarketReturns([...steady, writeDown, jump]), expected);
  // The highest return of the day is still steady within twice the median:
  // the median of 0.1%, 0.2%, 0.3% and 0.4% is 0.25%.
  const highest = mm([1, 1.004, null, null]);
  close(moneyMarketReturns([...steady, highest])[0], 0.0025);
  // A day without a price is not a reason to leave a fund out.
  close(moneyMarketReturns([...steady, mm([null, 1, 1.002, 1.004])])[1], (1.004 / 1.002 - 1 + 0.002) / 2);
  // With no steady fund there is no money market return.
  assert.deepEqual(moneyMarketReturns([writeDown]), []);
});

test("a rate accrues over the calendar days to the next price date", () => {
  // Thursday, Friday, Monday, then Tuesday a week later (a holiday week).
  const dates = ["2026-10-22", "2026-10-23", "2026-10-26", "2026-11-03"];
  const returns = rateReturns([36.5, 36.5, 73, 50], dates);
  assert.equal(returns.length, 3);
  close(returns[0], 0.001); // 36.5% a year is 0.1% a day
  close(returns[1], 0.003); // the weekend
  close(returns[2], 0.016); // 8 days at 73%
  // The newest date's rate isn't used: there is no later price yet.
  assert.deepEqual(rateReturns([36.5, 36.5, 73, null], dates), returns);
});

test("a missing rate or an unusable date gives no return for that day", () => {
  const dates = ["2026-10-22", "2026-10-23", "2026-10-26"];
  for (const rate of [null, undefined, "36.5", Number.NaN, Infinity]) {
    const returns = rateReturns([rate, 36.5, 36.5], dates);
    assert.equal(returns[0], null, String(rate));
    close(returns[1], 0.003);
  }
  // Dates out of order, repeated or invalid.
  assert.deepEqual(rateReturns([36.5, 36.5, 36.5], ["2026-10-23", "2026-10-22", "2026-10-22"]), [null, null]);
  assert.deepEqual(rateReturns([36.5, 36.5], ["2026-10-22", "soon"]), [null]);
  assert.deepEqual(rateReturns([36.5, 36.5], [20261022, 20261023]), [null]);
  // No rates or no dates: no returns.
  assert.deepEqual(rateReturns(undefined, dates), []);
  assert.deepEqual(rateReturns([36.5, 36.5, 36.5], undefined), []);
  assert.deepEqual(rateReturns("36.5", dates), []);
});

test("the risk-free return is the highest of TLREF, the policy rate and the money market funds each day", () => {
  // Money market funds earn 0.1% a day (0.3% over the weekend).
  const funds = [mm([1, 1.001, 1.004004, 1.005008004]), mm([1, 1.001, 1.004004, 1.005008004])];
  const data = {
    priceDates: ["2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"],
    riskFreeRates: {
      tlref: [73, 18.25, null, 40], // 0.2%, then 0.15% over the weekend, then none
      policy: [18.25, 73, 18.25, 36], // 0.05%, then 0.6% over the weekend, then 0.05%
    },
  };
  const measures = riskFreeMeasures(funds, data);
  assert.deepEqual(Object.keys(measures), ["tlref", "policy", "moneyMarket"]);
  const riskFree = riskFreeReturns(funds, data);
  assert.equal(riskFree.length, 3);
  close(riskFree[0], 0.002); // TLREF
  close(riskFree[1], 0.006); // the policy rate
  close(riskFree[2], 0.001); // the money market funds
  for (const [day, name] of ["tlref", "policy", "moneyMarket"].entries()) {
    assert.equal(riskFree[day], measures[name][day]);
  }
});

test("a measure missing from the data is left out of the highest", () => {
  const funds = [mm([1, 1.001, 1.002001])];
  const priceDates = ["2026-10-22", "2026-10-23", "2026-10-24"];
  const lowRates = [3.65, 3.65, 3.65]; // 0.01% a day
  const highRates = [73, 73, 73]; // 0.2% a day
  const riskFree = (riskFreeRates, list = funds) => riskFreeReturns(list, { priceDates, riskFreeRates });
  // No rates in the file (an earlier data file), or rates that aren't lists.
  for (const rates of [undefined, null, {}, { tlref: "40", policy: 37 }]) {
    riskFree(rates).forEach((r) => close(r, 0.001));
  }
  // Only one of the two rates.
  riskFree({ tlref: highRates }).forEach((r) => close(r, 0.002));
  riskFree({ policy: lowRates }).forEach((r) => close(r, 0.001));
  // No steady money market fund: the rates alone.
  riskFree({ tlref: lowRates, policy: highRates }, []).forEach((r) => close(r, 0.002));
  // Nothing at all for a day: no risk-free return.
  assert.deepEqual(riskFree({ tlref: [null, 73, 73] }, []).map((r) => r === null), [true, false]);
});

test("Sharpe ratio is the annualised mean excess return over its deviation", () => {
  const riskFree = Array(22).fill(0.001);
  // Excess returns alternate 0.2% and 0%: mean 0.1%, sample deviation
  // 0.1% × √(22/21), so the ratio is √(21/22) × √252.
  const prices = pricesFrom(riskFree.map((rf, day) => rf + (day % 2 ? 0 : 0.002)));
  close(sharpeRatio(prices, riskFree), Math.sqrt((21 / 22) * 252));
});

test("a fund that trails the risk-free rate has a negative ratio", () => {
  const riskFree = Array(24).fill(0.001);
  const prices = pricesFrom(riskFree.map((rf, day) => rf - 0.001 + (day % 3) * 0.0001));
  assert.ok(sharpeRatio(prices, riskFree) < 0);
});

test("days without a fund price or a risk-free return are left out", () => {
  // One return more than the minimum, so losing two of them leaves too few.
  assert.equal(MIN_RETURNS, 21);
  const riskFree = [...Array(22).fill(0.001), null];
  const returns = [...riskFree.slice(0, -1).map((rf, day) => rf + (day % 2 ? 0 : 0.002)), 0.5];
  const prices = pricesFrom(returns);
  // The 50% jump falls on a day with no risk-free return.
  close(sharpeRatio(prices, riskFree), Math.sqrt((21 / 22) * 252));
  // A missing price removes the returns into and out of that day.
  prices[3] = null;
  assert.equal(sharpeRatio(prices, riskFree), null);
});

test("no ratio with too few returns or no variation", () => {
  const riskFree = Array(MIN_RETURNS - 1).fill(0.001);
  assert.equal(sharpeRatio(pricesFrom(riskFree.map((rf, day) => rf * day)), riskFree), null);
  const prices = pricesFrom(Array(MIN_RETURNS).fill(0.001));
  assert.equal(sharpeRatio(prices, dailyReturns(prices)), null);
  assert.equal(sharpeRatio(undefined, riskFree), null);
});

test("sharpePeriod counts the returns behind a ratio against the window's", () => {
  const riskFree = Array(124).fill(0.001);
  const full = pricesFrom(riskFree);
  assert.deepEqual(sharpePeriod(full, riskFree), { returns: 124, of: 124, months: 6, short: false });
  // A fund launched three months into the window has no earlier prices.
  const late = full.map((price, day) => (day < 61 ? null : price));
  assert.deepEqual(sharpePeriod(late, riskFree), { returns: 63, of: 124, months: 3, short: true });
  // Days without a risk-free return aren't offered by the window.
  const gaps = [...Array(100).fill(0.001), ...Array(24).fill(null)];
  assert.deepEqual(sharpePeriod(full, gaps), { returns: 100, of: 100, months: 5, short: false });
});

test("a few missing days don't make a period short, and it is at least one month", () => {
  const riskFree = Array(124).fill(0.001);
  const prices = pricesFrom(riskFree);
  // 112 of 124 returns is just above 90%; 111 is below.
  const from = (first) => prices.map((price, day) => (day < first ? null : price));
  assert.equal(sharpePeriod(from(12), riskFree).short, false);
  assert.equal(sharpePeriod(from(13), riskFree).short, true);
  assert.equal(sharpePeriod(from(120), riskFree).months, 1);
  assert.deepEqual(sharpePeriod(undefined, riskFree), { returns: 0, of: 124, months: 1, short: true });
});
