// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMNS } from "../site/columns.js";
import { DEFAULT_STATE, parseState, serializeState } from "../site/urlstate.js";

const DEFAULTS = { view: "passing", query: "", sortKey: "1m", sortDir: "desc" };

test("an empty query string gives the default state", () => {
  assert.deepEqual(parseState(""), DEFAULTS);
  assert.deepEqual(parseState("?"), DEFAULTS);
  assert.deepEqual({ ...DEFAULT_STATE }, DEFAULTS);
});

test("the default state serializes to no query string", () => {
  assert.equal(serializeState(DEFAULTS), "");
});

test("reads every parameter", () => {
  assert.deepEqual(parseState("?view=excluded&sort=sharpe&dir=asc&q=ak"), {
    view: "excluded",
    query: "ak",
    sortKey: "sharpe",
    sortDir: "asc",
  });
});

test("leaves out values at their default", () => {
  assert.equal(serializeState({ ...DEFAULTS, view: "all" }), "?view=all");
  assert.equal(serializeState({ ...DEFAULTS, sortKey: "code", sortDir: "asc" }), "?sort=code&dir=asc");
  assert.equal(serializeState({ ...DEFAULTS, sortDir: "asc" }), "?dir=asc");
  assert.equal(serializeState({ ...DEFAULTS, query: "x" }), "?q=x");
  assert.equal(
    serializeState({ view: "excluded", query: "ak", sortKey: "sharpe", sortDir: "asc" }),
    "?view=excluded&sort=sharpe&dir=asc&q=ak",
  );
});

test("round-trips every view and every column's sort key", () => {
  for (const view of ["passing", "excluded", "all"]) {
    for (const { key } of COLUMNS) {
      if (view === "passing" && key === "reason") continue;
      for (const sortDir of ["asc", "desc"]) {
        const state = { view, query: "", sortKey: key, sortDir };
        assert.deepEqual(parseState(serializeState(state)), state);
      }
    }
  }
});

test("round-trips Turkish characters and spaces in the search", () => {
  for (const query of ["İş Portföy", "ılık şeker", "ağaç  ", " Ğ ü ö ç ", "a&b=c+d%20?#"]) {
    const state = { ...DEFAULTS, query };
    const search = serializeState(state);
    assert.ok(search.startsWith("?q="), search);
    // Encoded, so the value can't run into the hash or another parameter.
    assert.doesNotMatch(search.slice("?q=".length), /[\s#&İışğ]/u);
    assert.deepEqual(parseState(search), state);
  }
});

test("reads a search encoded with %20 as well as +", () => {
  assert.equal(parseState("?q=%C4%B0%C5%9F%20Portf%C3%B6y").query, "İş Portföy");
  assert.equal(parseState("?q=%C4%B0%C5%9F+Portf%C3%B6y").query, "İş Portföy");
});

test("each invalid parameter falls back to its own default", () => {
  assert.deepEqual(parseState("?view=nope&sort=nope&dir=nope"), DEFAULTS);
  assert.deepEqual(parseState("?view=excluded&sort=nope&dir=asc"), { ...DEFAULTS, view: "excluded", sortDir: "asc" });
  assert.deepEqual(parseState("?view=nope&sort=code"), { ...DEFAULTS, sortKey: "code" });
  assert.deepEqual(parseState("?view=ALL&sort=Code&dir=ASC"), DEFAULTS);
  assert.deepEqual(parseState("?view=&sort=&dir=&q="), DEFAULTS);
  assert.deepEqual(parseState("?unknown=1&q=x"), { ...DEFAULTS, query: "x" });
});

test("ignores keys that only exist on plain objects", () => {
  assert.deepEqual(parseState("?view=toString&sort=constructor&dir=__proto__"), DEFAULTS);
});

test("sorting by reason is only allowed for the excluded and all views", () => {
  assert.deepEqual(parseState("?sort=reason&dir=asc"), DEFAULTS);
  assert.deepEqual(parseState("?view=passing&sort=reason&dir=asc"), DEFAULTS);
  assert.deepEqual(parseState("?view=excluded&sort=reason&dir=asc"), {
    ...DEFAULTS,
    view: "excluded",
    sortKey: "reason",
    sortDir: "asc",
  });
  assert.equal(parseState("?view=all&sort=reason").sortKey, "reason");
});

test("the first of repeated parameters wins", () => {
  assert.deepEqual(parseState("?view=all&view=excluded"), { ...DEFAULTS, view: "all" });
});
