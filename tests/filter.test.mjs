// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { exclusionReason } from "../site/filter.js";

const fund = (returns) => ({
  code: "TST",
  returns: { "1m": null, "3m": null, "6m": null, "1y": null, ytd: null, "3y": null, "5y": null, ...returns },
});

const rule = (returns) => exclusionReason(fund(returns))?.rule ?? null;

test("passes when every rule is met", () => {
  assert.equal(rule({ "1m": 3, "3m": 9, "6m": 19, "1y": 42.5, "3y": 200, "5y": 400 }), null);
});

test("1M return is required and must be at least 3%", () => {
  assert.equal(rule({}), "min-1m");
  assert.equal(rule({ "1m": 2.99 }), "min-1m");
  assert.equal(rule({ "1m": 3 }), null);
});

test("3M, 6M and 1Y minimums apply only when the return exists", () => {
  assert.equal(rule({ "1m": 3, "3m": 8.99 }), "min-3m");
  assert.equal(rule({ "1m": 3, "3m": 9, "6m": 18.99 }), "min-6m");
  assert.equal(rule({ "1m": 3, "3m": 9, "6m": 19, "1y": 42.49 }), "min-1y");
  assert.equal(rule({ "1m": 3, "6m": 19 }), null);
  assert.equal(rule({ "1m": 3, "1y": 50 }), null);
});

test("a longer horizon may not return less than a shorter one", () => {
  assert.equal(rule({ "1m": 10, "3m": 9.5 }), "order");
  assert.equal(rule({ "1m": 3, "3m": 10, "6m": 20, "1y": 50, "3y": 45 }), "order");
  assert.equal(rule({ "1m": 3, "3m": 10, "6m": 20, "1y": 50, "3y": 200, "5y": 150 }), "order");
  // Equal returns are not "lower".
  assert.equal(rule({ "1m": 10, "3m": 10, "6m": 20 }), null);
});

test("the order rule compares across missing horizons", () => {
  // 6M is below 1M even though 3M (in between) is missing.
  assert.equal(rule({ "1m": 25, "6m": 24 }), "order");
  // 5Y below 1Y with 3Y missing.
  assert.equal(rule({ "1m": 3, "1y": 60, "5y": 55 }), "order");
});

test("YTD is ignored by the order rule", () => {
  assert.equal(rule({ "1m": 3, "3m": 10, ytd: 1 }), null);
});

test("reports a readable detail", () => {
  assert.deepEqual(exclusionReason(fund({ "1m": 3, "1y": 60, "3y": 50 })), {
    rule: "order",
    detail: "3Y 50.00% < 1Y 60.00%",
  });
});

test("a Sharpe ratio below 1.0 excludes the fund; a missing one is allowed", () => {
  const passing = { "1m": 3, "3m": 9, "6m": 19, "1y": 42.5 };
  const withSharpe = (sharpe) => exclusionReason({ ...fund(passing), sharpe })?.rule ?? null;
  assert.equal(withSharpe(0.99), "min-sharpe");
  assert.equal(withSharpe(-3), "min-sharpe");
  assert.equal(withSharpe(1), null);
  assert.equal(withSharpe(null), null);
  assert.equal(withSharpe(undefined), null);
  assert.deepEqual(exclusionReason({ ...fund(passing), sharpe: 0.456 }), {
    rule: "min-sharpe",
    detail: "Sharpe 0.46 < 1.0",
  });
});

test("return rules are reported before the Sharpe rule", () => {
  assert.equal(exclusionReason({ ...fund({ "1m": 2 }), sharpe: 0.5 }).rule, "min-1m");
});
