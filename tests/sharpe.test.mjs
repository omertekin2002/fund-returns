// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_RETURNS,
  RISK_FREE_UMBRELLA,
  dailyReturns,
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

// A money market fund earning the given daily returns.
const mm = (code, returns) => ({ code, umbrella: RISK_FREE_UMBRELLA, prices: pricesFrom(returns) });
const steady = (r, days = 30) => Array(days).fill(r);

test("the risk-free return is the daily mean of the money market funds with the higher geometric mean return", () => {
  const riskFree = riskFreeReturns([
    mm("LOW", steady(0.001)),
    mm("TOP", steady(0.003)),
    mm("MID", steady(0.002)),
    mm("BOT", steady(0.0005)),
    // Other fund types are ignored, however well they do.
    { code: "EQU", umbrella: "Hisse Senedi Şemsiye Fonu", prices: pricesFrom(steady(0.05)) },
  ]);
  assert.equal(riskFree.length, 30);
  // 2 of 4 kept: TOP and MID.
  for (const r of riskFree) close(r, 0.0025);
  assert.deepEqual(riskFreeReturns([]), []);
  assert.deepEqual(riskFreeReturns([{ code: "EQU", umbrella: "Hisse Senedi Şemsiye Fonu", prices: [1, 2] }]), []);
});

test("with an odd number of money market funds the larger half is kept", () => {
  // 2 of 3 kept: the mean of 3% and 2%.
  const three = riskFreeReturns([mm("A", steady(0.01)), mm("B", steady(0.03)), mm("C", steady(0.02))]);
  close(three[0], 0.025);
  // 1 of 1.
  close(riskFreeReturns([mm("A", steady(0.01))])[0], 0.01);
  // 3 of 5: 5%, 4% and 3%.
  const five = riskFreeReturns([0.01, 0.02, 0.03, 0.04, 0.05].map((r, i) => mm(`F${i}`, steady(r))));
  close(five[0], 0.04);
});

test("a kept fund without a return that day is left out of that day's mean, and no kept return gives null", () => {
  const top = mm("TOP", steady(0.003));
  const gap = mm("GAP", steady(0.002));
  // GAP has no price on day 5, so no return on days 4 and 5; nor has TOP.
  gap.prices[5] = null;
  top.prices[5] = null;
  // TOP also misses day 10's price, so only GAP is left on days 9 and 10.
  top.prices[10] = null;
  const riskFree = riskFreeReturns([top, gap, mm("LOW", steady(0.001)), mm("BOT", steady(0.0005))]);
  close(riskFree[0], 0.0025);
  assert.equal(riskFree[4], null);
  assert.equal(riskFree[5], null);
  close(riskFree[9], 0.002);
  close(riskFree[10], 0.002);
  close(riskFree[11], 0.0025);
});

test("funds with fewer than MIN_RETURNS returns are ranked only when no fund has that many", () => {
  assert.equal(MIN_RETURNS, 21);
  // NEW earns the most but has only 20 returns, so the two others are ranked
  // and the better of them kept.
  const late = (fund, first) => ({ ...fund, prices: fund.prices.map((price, day) => (day < first ? null : price)) });
  const funds = [late(mm("NEW", steady(0.01)), 10), mm("OLD", steady(0.002)), mm("LOW", steady(0.001))];
  for (const r of riskFreeReturns(funds)) close(r, 0.002);
  // With 21 returns NEW is ranked, and 2 of 3 are kept.
  const ranked = riskFreeReturns([late(mm("NEW", steady(0.01)), 9), ...funds.slice(1)]);
  close(ranked[0], 0.002);
  close(ranked[9], 0.006);
  // When none has MIN_RETURNS returns, every fund with a return is ranked.
  const short = [mm("A", steady(0.001, 5)), mm("B", steady(0.003, 5)), mm("C", steady(0.002, 5))];
  short.push({ code: "D", umbrella: RISK_FREE_UMBRELLA, prices: [null, null, null, null, null, null] });
  // D has no return, so 2 of the 3 others are kept: B and C.
  for (const r of riskFreeReturns(short)) close(r, 0.0025);
});

test("a price that spikes and reverts doesn't rank above a steady, higher-yielding fund", () => {
  // SPK earns 0.1% a day but jumps 50% and falls back once: its arithmetic
  // mean daily return is far above STD's 0.2%, its geometric mean below it.
  const spike = steady(0.001);
  spike[10] = 0.5;
  spike[11] = 1 / 1.5 - 1;
  // 1 of 2 kept: STD, where ranking by the arithmetic mean would keep SPK.
  for (const r of riskFreeReturns([mm("SPK", spike), mm("STD", steady(0.002))])) close(r, 0.002);
});

test("ties are broken by fund code, whatever the input order", () => {
  // Both funds double and then grow by half (or the other way round), then
  // stay flat: the same geometric mean daily return, on different days.
  const flat = Array(25).fill(3);
  const aaa = { code: "AAA", umbrella: RISK_FREE_UMBRELLA, prices: [1, 1.5, ...flat] };
  const zzz = { code: "ZZZ", umbrella: RISK_FREE_UMBRELLA, prices: [1, 2, ...flat] };
  // 1 of 2 kept: AAA, which gained 50% on the first day.
  for (const funds of [[aaa, zzz], [zzz, aaa]]) {
    const riskFree = riskFreeReturns(funds);
    assert.equal(riskFree[0], 0.5);
    assert.equal(riskFree[1], 1);
    assert.equal(riskFree[2], 0);
  }
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
