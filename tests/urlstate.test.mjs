// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMNS } from "../site/columns.js";
import { CHANGES, DEFAULT_STATE, RISK_LEVELS, canSortBy, parseState, serializeState } from "../site/urlstate.js";

const DEFAULTS = { view: "passing", query: "", sortKey: "1m", sortDir: "desc", type: "", risk: "", changed: "" };

test("an empty query string gives the default state", () => {
  assert.deepEqual(parseState(""), DEFAULTS);
  assert.deepEqual(parseState("?"), DEFAULTS);
  assert.deepEqual({ ...DEFAULT_STATE }, DEFAULTS);
});

test("the default state serializes to no query string", () => {
  assert.equal(serializeState(DEFAULTS), "");
});

test("reads every parameter", () => {
  assert.deepEqual(
    parseState("?view=excluded&sort=sharpe&dir=asc&q=ak&type=Karma+%C5%9Eemsiye+Fonu&risk=3&changed=left"),
    {
      view: "excluded",
      query: "ak",
      sortKey: "sharpe",
      sortDir: "asc",
      type: "Karma Şemsiye Fonu",
      risk: "3",
      changed: "left",
    },
  );
});

test("leaves out values at their default", () => {
  assert.equal(serializeState({ ...DEFAULTS, view: "all" }), "?view=all");
  assert.equal(serializeState({ ...DEFAULTS, sortKey: "code", sortDir: "asc" }), "?sort=code&dir=asc");
  assert.equal(serializeState({ ...DEFAULTS, sortDir: "asc" }), "?dir=asc");
  assert.equal(serializeState({ ...DEFAULTS, query: "x" }), "?q=x");
  assert.equal(serializeState({ ...DEFAULTS, type: "Karma Şemsiye Fonu" }), "?type=Karma+%C5%9Eemsiye+Fonu");
  assert.equal(serializeState({ ...DEFAULTS, risk: "6" }), "?risk=6");
  assert.equal(
    serializeState({ view: "excluded", query: "ak", sortKey: "sharpe", sortDir: "asc", type: "", risk: "" }),
    "?view=excluded&sort=sharpe&dir=asc&q=ak",
  );
  assert.equal(
    serializeState({ view: "all", query: "ak", sortKey: "code", sortDir: "asc", type: "Karma Şemsiye Fonu", risk: "2" }),
    "?view=all&sort=code&dir=asc&q=ak&type=Karma+%C5%9Eemsiye+Fonu&risk=2",
  );
});

test("round-trips every view and every sortable column's sort key", () => {
  for (const view of ["passing", "excluded", "all"]) {
    for (const { key, sortable } of COLUMNS) {
      if (sortable === false) continue;
      if (view === "passing" && key === "reason") continue;
      for (const sortDir of ["asc", "desc"]) {
        const state = { ...DEFAULTS, view, sortKey: key, sortDir };
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

test("the 4-week price line can't be sorted by in any view", () => {
  const trend = COLUMNS.find((c) => c.key === "trend");
  assert.equal(trend.sortable, false);
  assert.deepEqual(
    COLUMNS.filter((c) => c.sortable === false).map((c) => c.key),
    ["trend"],
  );
  for (const view of ["passing", "excluded", "all"]) {
    assert.equal(canSortBy(view, "trend"), false, view);
    // Falls back to the default sort, direction included.
    assert.deepEqual(parseState(`?view=${view}&sort=trend&dir=asc`), { ...DEFAULTS, view }, view);
  }
  assert.deepEqual(parseState("?sort=trend"), DEFAULTS);
  assert.deepEqual(parseState("?sort=trend&q=ak&risk=3"), { ...DEFAULTS, query: "ak", risk: "3" });
});

test("the first of repeated parameters wins", () => {
  assert.deepEqual(parseState("?view=all&view=excluded"), { ...DEFAULTS, view: "all" });
  assert.deepEqual(parseState("?risk=2&risk=5&type=a&type=b"), { ...DEFAULTS, type: "a", risk: "2" });
});

test("round-trips every risk level", () => {
  assert.deepEqual(RISK_LEVELS, ["1", "2", "3", "4", "5", "6", "7"]);
  for (const risk of RISK_LEVELS) {
    const state = { ...DEFAULTS, risk };
    assert.equal(serializeState(state), `?risk=${risk}`);
    assert.deepEqual(parseState(serializeState(state)), state);
  }
});

test("an invalid risk level falls back to no risk filter", () => {
  for (const risk of ["0", "8", "-1", "1.0", "01", " 1", "6.5", "1e0", "one", "null", "", "toString"]) {
    assert.deepEqual(parseState(`?risk=${encodeURIComponent(risk)}`), DEFAULTS, risk);
  }
  assert.deepEqual(parseState("?risk=9&view=all&q=x"), { ...DEFAULTS, view: "all", query: "x" });
  assert.deepEqual(parseState("?risk=0&type=Karma+%C5%9Eemsiye+Fonu"), { ...DEFAULTS, type: "Karma Şemsiye Fonu" });
});

test("round-trips Turkish umbrella names", () => {
  const types = [
    "Hisse Senedi Şemsiye Fonu",
    "Kıymetli Madenler Şemsiye Fonu",
    "Borçlanma Araçları Şemsiye Fonu",
    "Değişken Şemsiye Fonu",
    "a&b=c+d%20?#",
  ];
  for (const type of types) {
    const state = { ...DEFAULTS, type };
    const search = serializeState(state);
    assert.ok(search.startsWith("?type="), search);
    assert.doesNotMatch(search.slice("?type=".length), /[\s#&ŞışğçöüÇÖÜĞİ]/u);
    assert.deepEqual(parseState(search), state);
  }
  assert.equal(parseState("?type=Hisse%20Senedi%20%C5%9Eemsiye%20Fonu").type, "Hisse Senedi Şemsiye Fonu");
  assert.equal(parseState("?type=Hisse+Senedi+%C5%9Eemsiye+Fonu").type, "Hisse Senedi Şemsiye Fonu");
});

test("passes any type through, leaving unknown ones to the page", () => {
  assert.equal(parseState("?type=nope").type, "nope");
  assert.equal(parseState("?type=").type, "");
});

test("the filters combine with the view, sort and search", () => {
  const state = {
    view: "excluded",
    query: "İş Portföy",
    sortKey: "sharpe",
    sortDir: "asc",
    type: "Hisse Senedi Şemsiye Fonu",
    risk: "6",
    changed: "left",
  };
  assert.deepEqual(parseState(serializeState(state)), state);
  assert.deepEqual(parseState("?type=Hisse+Senedi+%C5%9Eemsiye+Fonu&risk=6&view=all"), {
    ...DEFAULTS,
    view: "all",
    type: "Hisse Senedi Şemsiye Fonu",
    risk: "6",
  });
});

test("round-trips each change filter, left out when there is none", () => {
  assert.deepEqual(CHANGES, ["entered", "left"]);
  for (const changed of CHANGES) {
    const state = { ...DEFAULTS, changed };
    assert.equal(serializeState(state), `?changed=${changed}`);
    assert.deepEqual(parseState(serializeState(state)), state);
  }
  assert.equal(serializeState({ ...DEFAULTS, changed: "" }), "");
  // States written before the change filter existed have no `changed` at all.
  const { changed, ...withoutChanged } = DEFAULTS;
  assert.equal(serializeState({ ...withoutChanged, view: "all" }), "?view=all");
});

test("an invalid change filter falls back to none", () => {
  for (const changed of ["", "ENTERED", "Left", "new", "both", " left", "entered ", "1", "toString", "__proto__"]) {
    assert.deepEqual(parseState(`?changed=${encodeURIComponent(changed)}`), DEFAULTS, changed);
  }
  assert.deepEqual(parseState("?changed=nope&view=excluded&risk=6"), { ...DEFAULTS, view: "excluded", risk: "6" });
  assert.deepEqual(parseState("?changed=left&changed=entered"), { ...DEFAULTS, changed: "left" });
});

test("the change filter combines with the view, sort, search and the other filters", () => {
  assert.equal(
    serializeState({
      ...DEFAULTS,
      view: "excluded",
      query: "ak",
      type: "Karma Şemsiye Fonu",
      risk: "2",
      changed: "left",
    }),
    "?view=excluded&q=ak&type=Karma+%C5%9Eemsiye+Fonu&risk=2&changed=left",
  );
  assert.deepEqual(parseState("?changed=entered&sort=code&dir=asc&q=x"), {
    ...DEFAULTS,
    changed: "entered",
    sortKey: "code",
    sortDir: "asc",
    query: "x",
  });
  // A sort that falls back leaves the change filter alone.
  assert.deepEqual(parseState("?sort=reason&changed=entered"), { ...DEFAULTS, changed: "entered" });
});
