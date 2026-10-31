// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyFunds } from "../site/changes.js";
import { coverageCounts, coverageText, dataCoverage, priceWindow, priceWindowText } from "../site/coverage.js";

const DATES = ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-30"];

test("the price window is the first and last price date and their number", () => {
  const window = priceWindow(DATES);
  assert.deepEqual(window, { first: "2026-10-02", last: "2026-10-30", count: 4 });
  assert.equal(priceWindowText(window), "Prices 2 Oct – 30 Oct 2026 (4 days)");
});

test("a single price date is named once", () => {
  const window = priceWindow(["2026-10-30"]);
  assert.deepEqual(window, { first: "2026-10-30", last: "2026-10-30", count: 1 });
  assert.equal(priceWindowText(window), "Prices 30 Oct 2026 (1 day)");
});

test("a window across a new year names both years", () => {
  assert.equal(
    priceWindowText(priceWindow(["2025-12-15", "2026-01-09"])),
    "Prices 15 Dec 2025 – 9 Jan 2026 (2 days)",
  );
});

test("missing, empty, non-array or malformed price dates have no window", () => {
  for (const priceDates of [
    undefined,
    null,
    [],
    "2026-10-02",
    { 0: "2026-10-02", length: 1 },
    ["2026-10-02", null],
    ["2026-10-02", 20261030],
    ["2026-10-02", "30.10.2026"],
    ["2026-10-02", "2026-10-30T00:00:00Z"],
    ["2026-10-02", "2026-02-30"],
    ["2026-13-01"],
  ]) {
    assert.equal(priceWindow(priceDates), null, JSON.stringify(priceDates));
  }
  assert.equal(priceWindowText(null), "Price dates unknown");
  assert.equal(dataCoverage({ funds: [] }, []).window, null);
  assert.equal(dataCoverage(null, []).window, null);
});

const fund = (code, overrides = {}) => ({
  code,
  name: code,
  umbrella: "Hisse Senedi Şemsiye Fonu",
  risk: 5,
  returns: { "1m": 4 },
  sharpe: 1.5,
  ...overrides,
});

test("counts the funds without a 1M return, a Sharpe ratio or a risk level", () => {
  const funds = [
    fund("AAA"),
    fund("BBB", { returns: { "3m": 10 } }),
    fund("CCC", { returns: { "1m": null }, risk: null }),
    fund("DDD", { sharpe: null }),
    fund("EEE", { risk: undefined }),
    fund("FFF", { returns: { "1m": 0 }, sharpe: 0 }),
  ];
  assert.deepEqual(coverageCounts(funds), { total: 6, noMonthReturn: 2, noSharpe: 1, noRisk: 2 });
});

test("the Sharpe ratio is counted from the classified funds", () => {
  // Raw funds carry prices, not ratios; classifyFunds works them out.
  const prices = (step) => Array.from({ length: 20 }, (_, i) => 1 + i * step + (i % 3) * 0.001);
  const raw = [
    { code: "MM1", umbrella: "Para Piyasası Şemsiye Fonu", risk: 1, returns: { "1m": 3 }, prices: prices(0.001) },
    { code: "EQ1", umbrella: "Hisse Senedi Şemsiye Fonu", risk: 6, returns: { "1m": 5 }, prices: prices(0.01) },
    { code: "NEW", umbrella: "Hisse Senedi Şemsiye Fonu", risk: 6, returns: { "1m": 5 }, prices: [null, 1, 1.1] },
  ];
  const classified = classifyFunds(raw);
  assert.equal(classified.find((f) => f.code === "NEW").sharpe, null);
  assert.notEqual(classified.find((f) => f.code === "EQ1").sharpe, null);
  assert.equal(coverageCounts(classified).noSharpe, classified.filter((f) => f.sharpe === null).length);
  assert.equal(coverageCounts(raw).noSharpe, 3);
});

test("the coverage sentence names every non-zero count", () => {
  assert.equal(
    coverageText({ total: 1071, noMonthReturn: 9, noSharpe: 8, noRisk: 117 }),
    "Of 1,071 funds, 9 have no 1M return (rule 1 excludes them), 8 have no Sharpe ratio " +
      "(rule 6 allows that) and 117 have no risk level.",
  );
  assert.equal(
    coverageText({ total: 50, noMonthReturn: 1, noSharpe: 1, noRisk: 1 }),
    "Of 50 funds, 1 has no 1M return (rule 1 excludes it), 1 has no Sharpe ratio " +
      "(rule 6 allows that) and 1 has no risk level.",
  );
});

test("the coverage sentence leaves out zero counts", () => {
  assert.equal(
    coverageText({ total: 1071, noMonthReturn: 0, noSharpe: 8, noRisk: 117 }),
    "Of 1,071 funds, 8 have no Sharpe ratio (rule 6 allows that) and 117 have no risk level.",
  );
  assert.equal(
    coverageText({ total: 1071, noMonthReturn: 9, noSharpe: 0, noRisk: 0 }),
    "Of 1,071 funds, 9 have no 1M return (rule 1 excludes them).",
  );
});

test("with every count at zero, the sentence says every fund has all three", () => {
  assert.equal(
    coverageText({ total: 1071, noMonthReturn: 0, noSharpe: 0, noRisk: 0 }),
    "All 1,071 funds have a 1M return, a Sharpe ratio and a risk level.",
  );
  assert.equal(
    coverageText({ total: 1, noMonthReturn: 0, noSharpe: 0, noRisk: 0 }),
    "The one fund has a 1M return, a Sharpe ratio and a risk level.",
  );
  assert.equal(coverageText(coverageCounts([])), "The data has no funds.");
});

test("no text names a date for the period returns", () => {
  const texts = [
    priceWindowText(priceWindow(DATES)),
    priceWindowText(null),
    coverageText({ total: 3, noMonthReturn: 1, noSharpe: 1, noRisk: 1 }),
  ];
  for (const text of texts) assert.doesNotMatch(text, /\bas of\b|returns? (on|at|from|to)\b/i);
});

test("the committed data has a price window and matching counts", () => {
  const data = JSON.parse(readFileSync(new URL("../site/data/funds.json", import.meta.url), "utf8"));
  const funds = classifyFunds(data.funds);
  const { window, counts } = dataCoverage(data, funds);
  assert.deepEqual(window, {
    first: data.priceDates[0],
    last: data.priceDates.at(-1),
    count: data.priceDates.length,
  });
  assert.equal(counts.total, data.funds.length);
  assert.equal(counts.noMonthReturn, data.funds.filter((f) => f.returns["1m"] == null).length);
  assert.equal(counts.noRisk, data.funds.filter((f) => f.risk == null).length);
  assert.equal(counts.noSharpe, funds.filter((f) => f.sharpe == null).length);
});
