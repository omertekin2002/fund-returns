// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMNS } from "../site/columns.js";
import { fundSize, formatSize } from "../site/size.js";

test("billions keep two decimals", () => {
  assert.equal(formatSize(1_163_456_789), "1.16 bn TL");
  assert.equal(formatSize(1e9), "1.00 bn TL");
  assert.equal(formatSize(52_345_000_000), "52.35 bn TL");
  assert.equal(formatSize(1_234_567_000_000), "1,234.57 bn TL");
});

test("millions keep one decimal", () => {
  assert.equal(formatSize(245_300_000), "245.3 mn TL");
  assert.equal(formatSize(1e6), "1.0 mn TL");
  assert.equal(formatSize(5_040_000), "5.0 mn TL");
  assert.equal(formatSize(999_940_000), "999.9 mn TL");
});

test("thousands have no decimals, and smaller values are whole TL", () => {
  assert.equal(formatSize(850_000), "850 K TL");
  assert.equal(formatSize(1000), "1 K TL");
  assert.equal(formatSize(999_499), "999 K TL");
  assert.equal(formatSize(999.4), "999 TL");
  assert.equal(formatSize(512.3), "512 TL");
});

test("a value that would round to 1,000 of its unit is written in the next unit", () => {
  assert.equal(formatSize(999.6), "1 K TL");
  assert.equal(formatSize(999_500), "1.0 mn TL");
  assert.equal(formatSize(999_960_000), "1.00 bn TL");
});

test("just below and at each boundary", () => {
  assert.equal(formatSize(999_999_999), "1.00 bn TL");
  assert.equal(formatSize(1_000_000_001), "1.00 bn TL");
  assert.equal(formatSize(999_999), "1.0 mn TL");
  assert.equal(formatSize(1_000_001), "1.0 mn TL");
  assert.equal(formatSize(999.99), "1 K TL");
  assert.equal(formatSize(1000.01), "1 K TL");
});

test("missing or invalid values show a dash", () => {
  for (const value of [null, undefined, 0, -5, Number.NaN, Infinity, "1000", true, {}]) {
    assert.equal(formatSize(value), "—", String(value));
  }
});

test("fundSize reads a positive number and gives null for anything else", () => {
  assert.equal(fundSize({ size: 1.5e9 }), 1.5e9);
  // Data from before the Size column has no size field.
  assert.equal(fundSize({ code: "AAL" }), null);
  for (const size of [null, 0, -1, Number.NaN, Infinity, "1000", true]) {
    assert.equal(fundSize({ size }), null, String(size));
  }
});

test("the Size column follows Risk, is sortable and reads the fund's size", () => {
  const keys = COLUMNS.map((c) => c.key);
  assert.equal(keys.indexOf("size"), keys.indexOf("risk") + 1);
  const col = COLUMNS.find((c) => c.key === "size");
  assert.equal(col.label, "Size");
  assert.equal(col.csvLabel, "Size (TL)");
  assert.notEqual(col.sortable, false);
  assert.match(col.title, /total value in TL/);
  assert.equal(col.value({ size: 42 }), 42);
  assert.equal(col.value({}), null);
});
