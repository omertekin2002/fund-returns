// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cappedText, ROW_LIMIT, showAllText, visibleRows } from "../site/rowlimit.js";

const fundList = (n) => Array.from({ length: n }, (_, i) => ({ code: `F${String(i).padStart(4, "0")}` }));

test("the limit is 100 rows", () => {
  assert.equal(ROW_LIMIT, 100);
});

test("the Passing view is never capped", () => {
  const funds = fundList(1075);
  const { shown, hidden } = visibleRows("passing", funds, false);
  assert.equal(shown, funds);
  assert.equal(hidden, 0);
});

test("a list of 100 or fewer is never capped", () => {
  for (const view of ["excluded", "all"]) {
    for (const n of [0, 1, 99, 100]) {
      const funds = fundList(n);
      const { shown, hidden } = visibleRows(view, funds, false);
      assert.equal(shown, funds, `${view} with ${n}`);
      assert.equal(hidden, 0, `${view} with ${n}`);
    }
  }
});

test("the Excluded and All views show the first 100 of a longer list, in its order", () => {
  for (const view of ["excluded", "all"]) {
    for (const n of [101, 1075]) {
      const funds = fundList(n);
      const { shown, hidden } = visibleRows(view, funds, false);
      assert.deepEqual(shown, funds.slice(0, 100), `${view} with ${n}`);
      assert.equal(hidden, n - 100, `${view} with ${n}`);
    }
  }
  // The input list is left as it is.
  const funds = fundList(150);
  visibleRows("all", funds, false);
  assert.equal(funds.length, 150);
});

test("once the reader asks for every row, every row is shown", () => {
  for (const view of ["passing", "excluded", "all"]) {
    const funds = fundList(1075);
    const { shown, hidden } = visibleRows(view, funds, true);
    assert.equal(shown, funds);
    assert.equal(hidden, 0);
  }
});

test("the cap line and the button name the full count, formatted like the view counts", () => {
  assert.equal(cappedText(100, 1075), "Showing the first 100 of 1,075 funds.");
  assert.equal(cappedText(100, 101), "Showing the first 100 of 101 funds.");
  assert.equal(showAllText(1075), "Show all 1,075 funds");
  assert.equal(showAllText(101), "Show all 101 funds");
});
