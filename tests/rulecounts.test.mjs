// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyFunds } from "../site/changes.js";
import { RULES } from "../site/filter.js";
import { ruleCounts, ruleCountsNote, ruleCountText } from "../site/rulecounts.js";
import { withOnePassingFund, withoutPassingFunds, withPassingFunds } from "./fund-fixtures.mjs";

const committed = JSON.parse(readFileSync(new URL("../site/data/funds.json", import.meta.url), "utf8"));

test("a card's count reads as a first failure, with the singular for one", () => {
  assert.equal(ruleCountText(0), "No funds out here first.");
  assert.equal(ruleCountText(1), "1 fund out here first.");
  assert.equal(ruleCountText(2), "2 funds out here first.");
  assert.equal(ruleCountText(1071), "1,071 funds out here first.");
});

test("the note gives the excluded total the cards add up to", () => {
  assert.equal(
    ruleCountsNote(965),
    "Each excluded fund is counted once, under the first rule it breaks, so the cards add up to the 965 excluded funds.",
  );
  assert.equal(
    ruleCountsNote(1071),
    "Each excluded fund is counted once, under the first rule it breaks, so the cards add up to the 1,071 excluded funds.",
  );
  assert.equal(
    ruleCountsNote(1),
    "Each excluded fund is counted once, under the first rule it breaks, so the cards add up to the 1 excluded fund.",
  );
  assert.equal(
    ruleCountsNote(0),
    "Each excluded fund is counted once, under the first rule it breaks. No fund is excluded in the latest data.",
  );
});

test("each excluded fund is counted once, under its first failing rule", () => {
  const funds = [
    { code: "A", reason: { rule: "min-1m" } },
    { code: "B", reason: { rule: "min-1m" } },
    { code: "C", reason: { rule: "sharpe" } },
    { code: "D", reason: null },
  ];
  assert.deepEqual(ruleCounts(funds), { "min-1m": 2, sharpe: 1 });
  assert.deepEqual(ruleCounts([]), {});
});

for (const [name, data] of [
  ["the committed data", committed],
  ["data with passing funds", withPassingFunds(committed).data],
  ["data in which no fund passes", withoutPassingFunds(committed)],
  ["data in which one fund passes", withOnePassingFund(committed).data],
]) {
  test(`on ${name}, the counts add up to the excluded funds`, () => {
    const funds = classifyFunds(data.funds);
    const excluded = funds.filter((f) => f.reason);
    const counts = ruleCounts(funds);
    const ids = new Set(RULES.map((rule) => rule.id));
    for (const id of Object.keys(counts)) assert.ok(ids.has(id), `unknown rule ${id}`);
    const total = RULES.reduce((sum, rule) => sum + (counts[rule.id] ?? 0), 0);
    assert.equal(total, excluded.length);
  });
}
