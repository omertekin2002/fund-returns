// The data variants in fund-fixtures.mjs, and the data-dependent logic the
// page runs (changes, coverage, CSV) on a day when no fund or one fund passes.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { changesSummary, classifyFunds, membershipChanges } from "../site/changes.js";
import { coverageCounts, dataCoverage } from "../site/coverage.js";
import { csvColumns, toCsv } from "../site/csv.js";
import { RISK_FREE_UMBRELLA, riskFreeReturns } from "../site/sharpe.js";
import { FORCED_PASSING, withOnePassingFund, withoutPassingFunds, withPassingFunds } from "./fund-fixtures.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../site/data/${name}`, import.meta.url), "utf8"));
const committed = read("funds.json");
const previousUrl = new URL("../site/data/previous.json", import.meta.url);
const committedPrevious = existsSync(previousUrl) ? read("previous.json") : null;

const passingCodes = (funds) =>
  funds
    .filter((f) => !f.reason)
    .map((f) => f.code)
    .sort();

test("withPassingFunds makes more funds pass outside the money market umbrella, and changes no other fund", () => {
  const before = classifyFunds(committed.funds);
  const { data, codes } = withPassingFunds(committed);
  const after = classifyFunds(data.funds);
  assert.equal(codes.length, FORCED_PASSING);
  assert.deepEqual(passingCodes(after), [...passingCodes(before), ...codes].sort());
  for (const f of after.filter((f) => codes.includes(f.code))) {
    assert.notEqual(f.umbrella, RISK_FREE_UMBRELLA, f.code);
    assert.notEqual(f.risk, null, f.code);
    assert.ok(f.sharpe >= 1, f.code);
    assert.equal(f.sharpeShort, null, f.code);
  }
  data.funds.forEach((f, i) => {
    if (!codes.includes(f.code)) assert.equal(f, committed.funds[i]);
  });
  assert.deepEqual(riskFreeReturns(data.funds), riskFreeReturns(committed.funds));
  // The committed data is left as it was.
  assert.deepEqual(passingCodes(classifyFunds(committed.funds)), passingCodes(before));
});

test("withPassingFunds says so when the data has too few funds to make pass", () => {
  assert.throws(() => withPassingFunds({ ...committed, funds: committed.funds.slice(0, 1) }), /can be made to pass/);
});

test("withoutPassingFunds and withOnePassingFund leave no fund and exactly one passing", () => {
  assert.deepEqual(passingCodes(classifyFunds(withoutPassingFunds(committed).funds)), []);
  const { data, codes } = withOnePassingFund(committed);
  assert.equal(codes.length, 1);
  assert.deepEqual(passingCodes(classifyFunds(data.funds)), codes);
});

for (const [name, data, count] of [
  ["no fund passes", withoutPassingFunds(committed), 0],
  ["one fund passes", withOnePassingFund(committed).data, 1],
]) {
  const funds = classifyFunds(data.funds);
  const passing = funds.filter((f) => !f.reason);

  test(`on a day when ${name}: the changes since the committed previous update`, (t) => {
    if (!committedPrevious) {
      t.skip("no data/previous.json committed yet");
      return;
    }
    const previous = classifyFunds(committedPrevious.funds);
    const changes = membershipChanges(funds, previous);
    const passedBefore = passingCodes(previous);
    assert.deepEqual(
      [...changes.entered].sort(),
      passing.map((f) => f.code).filter((code) => !passedBefore.includes(code)),
    );
    assert.deepEqual(
      [...changes.left].sort(),
      passedBefore.filter((code) => !passing.some((f) => f.code === code)),
    );
    const summary = changesSummary(changes, committedPrevious.fetchedAt);
    assert.match(summary, /^Since /);
    assert.doesNotMatch(summary, /undefined|NaN/);
  });

  test(`on a day when ${name}: coverage counts every fund`, () => {
    const { window, counts } = dataCoverage(data, funds);
    assert.equal(window.count, data.priceDates.length);
    assert.deepEqual(counts, coverageCounts(funds));
    assert.equal(counts.total, data.funds.length);
    assert.equal(counts.noMonthReturn, 0);
  });

  test(`on a day when ${name}: the Passing view's CSV has a header and one row per passing fund`, () => {
    const lines = toCsv(passing, csvColumns("passing")).split("\r\n");
    assert.equal(lines.at(-1), "");
    assert.equal(lines.length, passing.length + 2);
    assert.match(lines[0], /^﻿Code,Fund,/);
  });
}
