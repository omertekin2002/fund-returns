// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changesSummary,
  changesSummaryParts,
  classifyFunds,
  evidenceChanges,
  membershipChanges,
  previousDate,
} from "../site/changes.js";
import { RULES, ruleEvidence } from "../site/filter.js";
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

test("the summary counts the funds gone from the data apart, and lists them by code", () => {
  const at = "2026-10-27T07:15:00Z";
  // The "left" count is the funds that still have a row, which its link shows.
  assert.equal(
    changesSummary({ entered: ["A"], left: ["D", "OLD1", "OLD2"], gone: ["OLD1", "OLD2"] }, at),
    "Since 27 Oct 2026: 1 fund entered, 1 left the passing list. " +
      "2 more funds left the passing list and are no longer in the data: OLD1, OLD2.",
  );
  assert.equal(
    changesSummary({ entered: ["A"], left: ["OLD"], gone: ["OLD"] }, at),
    "Since 27 Oct 2026: 1 fund entered the passing list. " +
      "1 more fund left the passing list and is no longer in the data: OLD.",
  );
  assert.equal(
    changesSummary({ entered: [], left: ["OLD"], gone: ["OLD"] }, at),
    "Since 27 Oct 2026: 1 fund left the passing list and is no longer in the data: OLD.",
  );
  assert.equal(
    changesSummary({ entered: [], left: ["OLD1", "OLD2"], gone: ["OLD1", "OLD2"] }, at),
    "Since 27 Oct 2026: 2 funds left the passing list and are no longer in the data: OLD1, OLD2.",
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

test("the summary's parts mark the non-zero counts as links to those funds", () => {
  const at = "2026-10-27T07:15:00Z";
  const text = (parts) => parts.map((p) => (typeof p === "string" ? p : p.text)).join("");
  const links = (parts) => parts.filter((p) => typeof p !== "string");
  for (const [changes, expected] of [
    [
      { entered: ["A", "B", "C"], left: ["D", "E"], gone: [] },
      [
        { text: "3 funds entered", changed: "entered" },
        { text: "2 left", changed: "left" },
      ],
    ],
    [{ entered: ["A"], left: [], gone: [] }, [{ text: "1 fund entered", changed: "entered" }]],
    // Funds gone from the data have no row, so the link doesn't count them.
    [{ entered: [], left: ["D", "OLD"], gone: ["OLD"] }, [{ text: "1 fund left", changed: "left" }]],
    [{ entered: [], left: ["OLD"], gone: ["OLD"] }, []],
    [{ entered: [], left: [], gone: [] }, []],
  ]) {
    const parts = changesSummaryParts(changes, at);
    assert.deepEqual(links(parts), expected);
    // Joined, the parts are the summary, so the page's text is unchanged.
    assert.equal(text(parts), changesSummary(changes, at));
  }
  // The codes of funds gone from the data stay plain text.
  const parts = changesSummaryParts({ entered: [], left: ["D", "OLD"], gone: ["OLD"] }, at);
  assert.equal(parts.at(-1), " 1 more fund left the passing list and is no longer in the data: OLD.");
});

test("previousDate is the previous update's day in Istanbul time, or null", () => {
  assert.equal(previousDate("2026-10-26T22:30:00Z"), "27 Oct 2026");
  assert.equal(previousDate("2026-10-29T07:15:00Z"), "29 Oct 2026");
  for (const at of [undefined, null, "", "not a date", 5]) assert.equal(previousDate(at), null);
});

// evidenceChanges for one fund classified in a current and a previous list,
// with the rule ids whose outcome changed.
const compare = (current, previous) => {
  const [now] = classifyFunds([current]);
  const [before] = previous ? classifyFunds([previous]) : [];
  const result = evidenceChanges(now, before);
  return { ...result, changedRules: result.rules.filter((r) => r.changed).map((r) => r.rule), now, before };
};

test("evidenceChanges pairs today's and the previous result on every rule, in RULES order", () => {
  const { inPrevious, rules, now, before } = compare(fund("AAA", FAILING_RETURNS), fund("AAA"));
  assert.equal(inPrevious, true);
  assert.deepEqual(rules.map((r) => r.rule), RULES.map((r) => r.id));
  assert.deepEqual(rules.map((r) => r.current), ruleEvidence(now));
  assert.deepEqual(rules.map((r) => r.previous), ruleEvidence(before));
});

test("a fund that left because its 1M return fell below 3% has only rule 1 changed", () => {
  const before = { ...PASSING_RETURNS, "1m": 3.4 };
  const now = { ...PASSING_RETURNS, "1m": 2.9 };
  const { rules, changedRules } = compare(fund("AAA", now), fund("AAA", before));
  assert.deepEqual(changedRules, ["min-1m"]);
  const [rule1] = rules;
  assert.equal(rule1.previous.measured, "1M 3.40%");
  assert.equal(rule1.previous.outcome, "pass");
  assert.equal(rule1.current.measured, "1M 2.90%");
  assert.equal(rule1.current.outcome, "fail");
});

test("a fund that entered because its Sharpe ratio rose above 1.0 has only rule 6 changed", () => {
  // Steady money market funds earn 0.1% a day. The fund lost against them
  // before, and beats them now.
  const days = 15;
  const steady = pricesFrom(Array(days).fill(0.001));
  const losing = pricesFrom(Array.from({ length: days }, (_, i) => (i % 2 ? -0.001 : 0.0005)));
  const winning = pricesFrom(Array.from({ length: days }, (_, i) => (i % 2 ? 0.004 : 0.003)));
  const list = (prices) => [
    fund("MM1", PASSING_RETURNS, { umbrella: RISK_FREE_UMBRELLA, prices: steady }),
    fund("MM2", PASSING_RETURNS, { umbrella: RISK_FREE_UMBRELLA, prices: steady }),
    fund("SHP", PASSING_RETURNS, { prices }),
  ];
  // Each list is classified with its own risk-free return, as the page does.
  const now = classifyFunds(list(winning)).find((f) => f.code === "SHP");
  const before = classifyFunds(list(losing)).find((f) => f.code === "SHP");
  assert.equal(now.reason, null);
  assert.equal(before.reason.rule, "min-sharpe");
  const { rules } = evidenceChanges(now, before);
  assert.deepEqual(rules.filter((r) => r.changed).map((r) => r.rule), ["min-sharpe"]);
  const sharpe = rules.at(-1);
  assert.equal(sharpe.previous.outcome, "fail");
  assert.equal(sharpe.previous.measured, `Sharpe ${before.sharpe.toFixed(2)}`);
  assert.equal(sharpe.current.outcome, "pass");
});

test("every rule whose outcome flipped is marked changed, and only those", () => {
  // Before: 1M and 3M too low and 3M below 1M; now everything passes. 6M goes
  // from missing (allowed) to a passing value, which is a change of outcome too.
  const before = { ...PASSING_RETURNS, "1m": 2, "3m": 1, "6m": null };
  const { rules, changedRules } = compare(fund("AAA"), fund("AAA", before));
  assert.deepEqual(changedRules, ["min-1m", "min-3m", "min-6m", "order"]);
  assert.deepEqual(
    rules.map((r) => [r.previous.outcome, r.current.outcome]),
    [
      ["fail", "pass"],
      ["fail", "pass"],
      ["missing-allowed", "pass"],
      ["pass", "pass"],
      ["fail", "pass"],
      ["missing-allowed", "missing-allowed"],
    ],
  );
});

test("a fund new to the data has no previous results and no changed rules", () => {
  const { inPrevious, rules, now } = compare(fund("NEW"), undefined);
  assert.equal(inPrevious, false);
  assert.equal(rules.length, RULES.length);
  assert.ok(rules.every((r) => r.previous === null && r.changed === false));
  assert.deepEqual(rules.map((r) => r.current), ruleEvidence(now));
  assert.equal(evidenceChanges(now, null).inPrevious, false);
});

test("values that moved without changing an outcome are not marked changed", () => {
  const before = { ...PASSING_RETURNS, "1m": 4, "3m": 12, "1y": 50 };
  const { rules, changedRules } = compare(fund("AAA"), fund("AAA", before));
  assert.deepEqual(changedRules, []);
  // The measured values still differ, so the page can show them.
  assert.equal(rules[0].previous.measured, "1M 4.00%");
  assert.equal(rules[0].current.measured, "1M 5.00%");
});

test("evidenceChanges doesn't change its input", () => {
  const [now] = classifyFunds([fund("AAA", FAILING_RETURNS)]);
  const [before] = classifyFunds([fund("AAA")]);
  const copies = [structuredClone(now), structuredClone(before)];
  evidenceChanges(now, before);
  assert.deepEqual([now, before], copies);
});
