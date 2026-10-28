// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { changesSummary, classifyFunds, membershipChanges } from "../site/changes.js";
import { RISK_FREE_UMBRELLA } from "../site/sharpe.js";

const PASSING_RETURNS = { "1m": 5, "3m": 15, "6m": 30, "1y": 60, ytd: 40, "3y": 200, "5y": null };
const FAILING_RETURNS = { ...PASSING_RETURNS, "1m": 1 };

const fund = (code, returns = PASSING_RETURNS, extra = {}) => ({
  code,
  umbrella: "Hisse Senedi Şemsiye Fonu",
  returns,
  prices: [],
  ...extra,
});

// Prices that start at 1 and grow by the given daily returns.
const pricesFrom = (returns) => returns.reduce((prices, r) => [...prices, prices.at(-1) * (1 + r)], [1]);

test("classifyFunds adds the Sharpe ratio and the exclusion reason", () => {
  const [passing, failing] = classifyFunds([fund("AAA"), fund("BBB", FAILING_RETURNS)]);
  assert.equal(passing.code, "AAA");
  assert.equal(passing.sharpe, null); // no prices
  assert.equal(passing.reason, null);
  assert.deepEqual(failing.reason, { rule: "min-1m", detail: "1M 1.00% < 3%" });
});

test("classifyFunds keeps the other fields and doesn't change its input", () => {
  const input = [fund("AAA", PASSING_RETURNS, { name: "ÖRNEK FON", risk: 6 })];
  const copy = structuredClone(input);
  const [result] = classifyFunds(input);
  assert.equal(result.name, "ÖRNEK FON");
  assert.equal(result.risk, 6);
  assert.deepEqual(input, copy);
});

test("classifyFunds works out Sharpe against the money market funds in the same list", () => {
  // Steady money market funds earn 0.1% a day; a fund that loses a little
  // every day against them is out on the Sharpe rule.
  const days = 15;
  const steady = pricesFrom(Array(days).fill(0.001));
  const losing = pricesFrom(Array.from({ length: days }, (_, i) => (i % 2 ? -0.001 : 0.0005)));
  const funds = classifyFunds([
    fund("MM1", PASSING_RETURNS, { umbrella: RISK_FREE_UMBRELLA, prices: steady }),
    fund("MM2", PASSING_RETURNS, { umbrella: RISK_FREE_UMBRELLA, prices: steady }),
    fund("LOS", PASSING_RETURNS, { prices: losing }),
  ]);
  const los = funds.find((f) => f.code === "LOS");
  assert.ok(los.sharpe < 0);
  assert.equal(los.reason.rule, "min-sharpe");
});

const changes = (current, previous) => membershipChanges(classifyFunds(current), classifyFunds(previous));

test("a fund that passes now but didn't before entered", () => {
  assert.deepEqual(changes([fund("AAA")], [fund("AAA", FAILING_RETURNS)]), {
    entered: ["AAA"],
    left: [],
    gone: [],
  });
});

test("a fund that passed before but doesn't now left", () => {
  assert.deepEqual(changes([fund("AAA", FAILING_RETURNS)], [fund("AAA")]), {
    entered: [],
    left: ["AAA"],
    gone: [],
  });
});

test("funds that pass or fail both times are unchanged", () => {
  const funds = [fund("AAA"), fund("BBB", FAILING_RETURNS)];
  assert.deepEqual(changes(funds, funds), { entered: [], left: [], gone: [] });
});

test("a passing fund new to the data entered; a failing one didn't", () => {
  assert.deepEqual(changes([fund("AAA"), fund("NEW"), fund("BAD", FAILING_RETURNS)], [fund("AAA")]), {
    entered: ["NEW"],
    left: [],
    gone: [],
  });
});

test("a passing fund gone from the data left, and is listed as gone", () => {
  assert.deepEqual(changes([fund("AAA")], [fund("AAA"), fund("OLD"), fund("BAD", FAILING_RETURNS)]), {
    entered: [],
    left: ["OLD"],
    gone: ["OLD"],
  });
});

test("the lists are sorted by code", () => {
  const result = changes(
    [fund("ZZZ"), fund("AAA"), fund("MMM", FAILING_RETURNS)],
    [fund("MMM"), fund("YYY"), fund("BBB")],
  );
  assert.deepEqual(result, { entered: ["AAA", "ZZZ"], left: ["BBB", "MMM", "YYY"], gone: ["BBB", "YYY"] });
});

test("the summary counts the funds that entered and left, dated in Istanbul time", () => {
  // 22:30 UTC on 26 Oct is already 27 Oct in Istanbul.
  const at = "2026-10-26T22:30:00Z";
  assert.equal(
    changesSummary({ entered: ["A", "B", "C"], left: ["D", "E"], gone: [] }, at),
    "Since 27 Oct 2026: 3 funds entered, 2 left the passing list.",
  );
  assert.equal(
    changesSummary({ entered: ["A"], left: [], gone: [] }, at),
    "Since 27 Oct 2026: 1 fund entered the passing list.",
  );
  assert.equal(
    changesSummary({ entered: [], left: ["D"], gone: [] }, at),
    "Since 27 Oct 2026: 1 fund left the passing list.",
  );
  assert.equal(
    changesSummary({ entered: [], left: [], gone: [] }, at),
    "Since 27 Oct 2026: no fund entered or left the passing list.",
  );
});

test("the summary lists the funds gone from the data by code", () => {
  assert.equal(
    changesSummary({ entered: ["A"], left: ["D", "OLD1", "OLD2"], gone: ["OLD1", "OLD2"] }, "2026-10-27T07:15:00Z"),
    "Since 27 Oct 2026: 1 fund entered, 3 left the passing list. No longer in the data: OLD1, OLD2.",
  );
});

test("the summary works without a valid previous update time", () => {
  for (const at of [undefined, null, "not a date", 5]) {
    assert.equal(
      changesSummary({ entered: [], left: ["D"], gone: [] }, at),
      "Since the previous update: 1 fund left the passing list.",
    );
  }
});
