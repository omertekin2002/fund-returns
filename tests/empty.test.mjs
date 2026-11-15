// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyFunds } from "../site/changes.js";
import { activeNarrowings, emptyMessage, inView } from "../site/empty.js";
import { withoutPassingFunds } from "./fund-fixtures.mjs";

const passingFund = { code: "PAS", reason: null };
const excludedFund = { code: "EXC", reason: { rule: "1m" } };
const both = [passingFund, excludedFund];

// The page's state with nothing narrowing it.
const STATE = { view: "passing", type: "", risk: "", changed: "", changesLoaded: true, query: "" };
const message = (state, funds = both) => emptyMessage({ ...STATE, ...state }, funds);

test("a view is the passing, the excluded or every fund", () => {
  assert.deepEqual(
    ["passing", "excluded", "all"].map((view) => both.filter((f) => inView(view, f)).map((f) => f.code)),
    [["PAS"], ["EXC"], ["PAS", "EXC"]],
  );
});

test("a Passing view with no passing fund says so, without a reset, whatever the filters", () => {
  const expected = { text: "No fund passes all six rules in the latest data.", reset: false };
  assert.deepEqual(message({}, [excludedFund]), expected);
  assert.deepEqual(
    message({ type: "Hisse Senedi Şemsiye Fonu", risk: "6", changed: "entered", query: "ata" }, [excludedFund]),
    expected,
  );
  assert.doesNotMatch(expected.text, /No funds match/);
});

test("an Excluded view with no excluded fund says so, without a reset", () => {
  assert.deepEqual(message({ view: "excluded", query: "ata" }, [passingFund]), {
    text: "No fund breaks any of the six rules in the latest data.",
    reset: false,
  });
});

test("any view of data without funds says the data has none, without a reset", () => {
  for (const view of ["passing", "excluded", "all"]) {
    assert.deepEqual(message({ view, risk: "3" }, []), { text: "The latest data has no funds.", reset: false });
  }
});

test("on the committed data with no fund passing, the Passing view says no fund passes", () => {
  const data = JSON.parse(readFileSync(new URL("../site/data/funds.json", import.meta.url), "utf8"));
  const funds = classifyFunds(withoutPassingFunds(data).funds);
  assert.equal(message({}, funds).text, "No fund passes all six rules in the latest data.");
  assert.equal(message({ view: "excluded", query: "zzzz" }, funds).reset, true);
});

test("names each single narrowing, with a reset", () => {
  for (const [state, text] of [
    [{ type: "Hisse Senedi Şemsiye Fonu" }, 'No funds match the type "Hisse Senedi Şemsiye Fonu".'],
    [{ risk: "6" }, "No funds match risk 6."],
    [{ changed: "entered" }, 'No funds match the change filter "Entered the passing list".'],
    [{ changed: "left" }, 'No funds match the change filter "Left the passing list".'],
    [{ query: "ata" }, 'No funds match the search "ata".'],
  ]) {
    for (const view of ["passing", "excluded", "all"]) {
      assert.deepEqual(message({ view, ...state }), { text, reset: true }, `${view} ${JSON.stringify(state)}`);
    }
  }
});

test("names several narrowings in the order of the controls", () => {
  assert.deepEqual(message({ type: "Hisse Senedi Şemsiye Fonu", risk: "6", query: "ata" }), {
    text: 'No funds match the type "Hisse Senedi Şemsiye Fonu", risk 6 and the search "ata".',
    reset: true,
  });
  assert.deepEqual(message({ query: "ata", risk: "2" }), {
    text: 'No funds match risk 2 and the search "ata".',
    reset: true,
  });
  assert.equal(
    message({ view: "all", query: "x", changed: "left", risk: "7", type: "Karma Şemsiye Fonu" }).text,
    'No funds match the type "Karma Şemsiye Fonu", risk 7, the change filter "Left the passing list" and the search "x".',
  );
});

test("leaves out a change filter that is not applied until the changes have loaded", () => {
  assert.deepEqual(activeNarrowings({ ...STATE, changed: "entered", changesLoaded: false }), []);
  assert.equal(
    message({ changed: "left", changesLoaded: false, query: "ata" }).text,
    'No funds match the search "ata".',
  );
  // An unknown change is never applied.
  assert.deepEqual(activeNarrowings({ ...STATE, changed: "moved" }), []);
});

test("keeps Turkish text in the search as typed, without the spaces around it", () => {
  assert.equal(message({ query: "  İŞ Portföy Çok ığdır " }).text, 'No funds match the search "İŞ Portföy Çok ığdır".');
});

test("a search of only spaces narrows nothing", () => {
  assert.deepEqual(activeNarrowings({ ...STATE, query: "   " }), []);
  assert.deepEqual(message({ query: "   ", risk: "1" }), { text: "No funds match risk 1.", reset: true });
});

test("with nothing narrowing a view that lists funds, falls back to the plain text", () => {
  assert.deepEqual(message({}), { text: "No funds match.", reset: false });
});
