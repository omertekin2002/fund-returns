// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_RETURNS, RISK_FREE_UMBRELLA, dailyReturns, riskFreeReturns, sharpeRatio } from "../site/sharpe.js";

// Prices that start at 1 and move by the given daily returns.
const pricesFrom = (returns) => returns.reduce((prices, r) => [...prices, prices.at(-1) * (1 + r)], [1]);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("daily returns skip days without a price", () => {
  const returns = dailyReturns([100, 102, null, 104, 0, 105]);
  close(returns[0], 0.02);
  assert.deepEqual(returns.slice(1), [null, null, null, null]);
  assert.deepEqual(dailyReturns(undefined), []);
});

test("the risk-free return is the median money market fund each day", () => {
  const mm = (prices) => ({ umbrella: RISK_FREE_UMBRELLA, prices });
  const riskFree = riskFreeReturns([
    mm([1, 1.01, 1.02]),
    mm([1, 1.03, null]),
    mm([1, 1.02, 1.0404]),
    // Other fund types are ignored.
    { umbrella: "Hisse Senedi Şemsiye Fonu", prices: [1, 2, 4] },
  ]);
  close(riskFree[0], 0.02); // median of 1%, 3%, 2%
  close(riskFree[1], (1.02 / 1.01 - 1 + 0.02) / 2); // two funds priced: mean of the middle pair
  assert.deepEqual(riskFreeReturns([]), []);
});

test("Sharpe ratio is the annualised mean excess return over its deviation", () => {
  const riskFree = Array(10).fill(0.001);
  // Excess returns alternate 0.2% and 0%: mean 0.1%, sample deviation
  // 0.1% × √(10/9), so the ratio is √(9/10) × √252.
  const prices = pricesFrom(riskFree.map((rf, day) => rf + (day % 2 ? 0 : 0.002)));
  close(sharpeRatio(prices, riskFree), Math.sqrt(0.9 * 252));
});

test("a fund that trails the risk-free rate has a negative ratio", () => {
  const riskFree = Array(12).fill(0.001);
  const prices = pricesFrom(riskFree.map((rf, day) => rf - 0.001 + (day % 3) * 0.0001));
  assert.ok(sharpeRatio(prices, riskFree) < 0);
});

test("days without a fund price or a risk-free return are left out", () => {
  const riskFree = [...Array(MIN_RETURNS).fill(0.001), null];
  const returns = [...riskFree.slice(0, -1).map((rf, day) => rf + (day % 2 ? 0 : 0.002)), 0.5];
  const prices = pricesFrom(returns);
  // The 50% jump falls on a day with no risk-free return.
  close(sharpeRatio(prices, riskFree), Math.sqrt(0.9 * 252));
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
