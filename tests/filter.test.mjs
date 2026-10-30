// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyFunds } from "../site/changes.js";
import { exclusionReason, RULES, ruleEvidence } from "../site/filter.js";

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

// ruleEvidence: one entry per rule, all six worked out.

const evidence = (returns, sharpe = null) => ruleEvidence({ ...fund(returns), sharpe });
const entryFor = (returns, ruleId, sharpe = null) => evidence(returns, sharpe).find((e) => e.rule === ruleId);
const outcomes = (returns, sharpe = null) => evidence(returns, sharpe).map((e) => e.outcome);

test("evidence has six entries in RULES order, with a requirement for each", () => {
  const entries = evidence({});
  assert.deepEqual(
    entries.map((e) => e.rule),
    RULES.map((r) => r.id),
  );
  for (const e of entries) assert.ok(e.requirement.length > 0, e.rule);
  assert.equal(entries[0].requirement, "1M at least 3%, required");
  assert.equal(entries[1].requirement, "3M at least 9%; missing is allowed");
  assert.equal(entries[3].requirement, "1Y at least 42.5%; missing is allowed");
  assert.equal(
    entries[4].requirement,
    "No longer period below a shorter one (1M ≤ 3M ≤ 6M ≤ 1Y ≤ 3Y ≤ 5Y); missing periods are skipped",
  );
  assert.equal(entries[5].requirement, "Sharpe at least 1.0; missing is allowed");
});

test("evidence: the 1M return is required", () => {
  assert.deepEqual(entryFor({}, "min-1m"), {
    rule: "min-1m",
    outcome: "fail",
    measured: "No 1M return",
    requirement: "1M at least 3%, required",
    detail: "No 1M return",
  });
  assert.equal(entryFor({ "1m": 2.99 }, "min-1m").outcome, "fail");
  assert.equal(entryFor({ "1m": 2.99 }, "min-1m").detail, "1M 2.99% < 3%");
  assert.equal(entryFor({ "1m": 3 }, "min-1m").outcome, "pass");
  assert.equal(entryFor({ "1m": 3 }, "min-1m").measured, "1M 3.00%");
  assert.equal(entryFor({ "1m": 3 }, "min-1m").detail, null);
});

test("evidence: 3M, 6M and 1Y minimums pass, fail or are missing-allowed", () => {
  const cases = [
    ["3m", "3M", 9, 8.99],
    ["6m", "6M", 19, 18.99],
    ["1y", "1Y", 42.5, 42.49],
  ];
  for (const [key, name, min, below] of cases) {
    const rule = `min-${key}`;
    const pass = entryFor({ "1m": 3, [key]: min }, rule);
    assert.equal(pass.outcome, "pass", rule);
    assert.equal(pass.measured, `${name} ${min.toFixed(2)}%`, rule);
    const fail = entryFor({ "1m": 3, [key]: below }, rule);
    assert.equal(fail.outcome, "fail", rule);
    assert.equal(fail.measured, `${name} ${below.toFixed(2)}%`, rule);
    assert.equal(fail.detail, `${name} ${below.toFixed(2)}% < ${min}%`, rule);
    const missing = entryFor({ "1m": 3 }, rule);
    assert.equal(missing.outcome, "missing-allowed", rule);
    assert.equal(missing.measured, `No ${name} return`, rule);
    assert.equal(missing.detail, null, rule);
  }
});

test("evidence: the order rule lists the horizons and the first broken pair", () => {
  const pass = entryFor({ "1m": 4.1, "3m": 12.4, "1y": 60.02 }, "order");
  assert.equal(pass.outcome, "pass");
  assert.equal(pass.measured, "1M 4.10% · 3M 12.40% · 1Y 60.02%");

  const fail = entryFor({ "1m": 3, "1y": 60, "3y": 50 }, "order");
  assert.equal(fail.outcome, "fail");
  assert.equal(fail.detail, "3Y 50.00% < 1Y 60.00%");
  assert.equal(fail.measured, "1M 3.00% · 1Y 60.00% · 3Y 50.00%; 3Y 50.00% < 1Y 60.00%");

  // A missing middle horizon is skipped: 6M is still compared with 1M.
  assert.equal(entryFor({ "1m": 5, "6m": 6 }, "order").outcome, "pass");
  assert.equal(entryFor({ "1m": 5, "6m": 6 }, "order").measured, "1M 5.00% · 6M 6.00%");
  assert.equal(entryFor({ "1m": 25, "6m": 24 }, "order").detail, "6M 24.00% < 1M 25.00%");

  // YTD is not compared.
  assert.equal(entryFor({ "1m": 3, "3m": 10, ytd: 1 }, "order").measured, "1M 3.00% · 3M 10.00%");

  // Fewer than two returns leave nothing to compare.
  assert.equal(entryFor({}, "order").outcome, "missing-allowed");
  assert.equal(entryFor({}, "order").measured, "No returns to compare");
  assert.equal(entryFor({ "1y": 50 }, "order").outcome, "missing-allowed");
  assert.equal(entryFor({ "1y": 50 }, "order").measured, "Only 1Y 50.00%, nothing to compare");
});

test("evidence: the Sharpe rule passes, fails or is missing-allowed", () => {
  assert.equal(entryFor({}, "min-sharpe", 1.849).outcome, "pass");
  assert.equal(entryFor({}, "min-sharpe", 1.849).measured, "Sharpe 1.85");
  assert.equal(entryFor({}, "min-sharpe", 1).outcome, "pass");
  assert.equal(entryFor({}, "min-sharpe", 0.456).outcome, "fail");
  assert.equal(entryFor({}, "min-sharpe", 0.456).detail, "Sharpe 0.46 < 1.0");
  for (const sharpe of [null, undefined]) {
    const missing = entryFor({}, "min-sharpe", sharpe);
    assert.equal(missing.outcome, "missing-allowed");
    assert.equal(missing.measured, "No Sharpe ratio (fewer than 10 daily returns, or no variation)");
  }
});

test("evidence: every rule is worked out after the first failure", () => {
  assert.deepEqual(outcomes({ "1m": 2, "3m": 1, "6m": 30, "1y": 20 }, 0.5), [
    "fail",
    "fail",
    "pass",
    "fail",
    "fail",
    "fail",
  ]);
  assert.deepEqual(outcomes({ "1m": 3, "3m": 9, "6m": 19, "1y": 42.5, "3y": 200, "5y": 400 }, 1.5), [
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
  ]);
});

test("over the committed data, the reason is the first failing evidence entry", () => {
  const data = JSON.parse(readFileSync(new URL("../site/data/funds.json", import.meta.url), "utf8"));
  const funds = classifyFunds(data.funds);
  assert.ok(funds.length > 0);
  for (const f of funds) {
    const entries = ruleEvidence(f);
    assert.equal(entries.length, RULES.length, f.code);
    const firstFail = entries.find((e) => e.outcome === "fail");
    assert.deepEqual(f.reason, firstFail ? { rule: firstFail.rule, detail: firstFail.detail } : null, f.code);
    const passes = entries.every((e) => e.outcome !== "fail");
    assert.equal(f.reason === null, passes, f.code);
  }
  // The data has passing and excluded funds, and funds without a Sharpe ratio.
  assert.ok(funds.some((f) => !f.reason));
  assert.ok(funds.some((f) => f.reason));
});
