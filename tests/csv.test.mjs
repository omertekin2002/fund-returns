// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOM, csvColumns, csvFileName, toCsv } from "../site/csv.js";

const fund = (overrides = {}) => ({
  code: "AAL",
  name: "ATA PORTFÖY PARA PİYASASI (TL) FONU",
  umbrella: "Para Piyasası Şemsiye Fonu",
  risk: 1,
  returns: { "1m": 3.0078, "3m": 8.3436, "6m": 17.4597, "1y": 41.859, ytd: 32.2183, "3y": 247.3831, "5y": 412.4501 },
  sharpe: 1.2345678901234567,
  trend: { points: ["0,0 1,1"], label: "Price over 4 weeks: up 1.00%" },
  reason: null,
  ...overrides,
});

// The CSV text without the BOM, split into rows of fields (no quoted fields).
const rows = (csv) =>
  csv
    .slice(BOM.length)
    .split("\r\n")
    .slice(0, -1)
    .map((line) => line.split(","));

const PASSING_HEADER = ["Code", "Fund", "Type", "Risk", "1M", "3M", "6M", "1Y", "YTD", "3Y", "5Y", "Sharpe"];

test("the Passing view has the table's columns without the 4-week line and the Reason", () => {
  assert.deepEqual(
    csvColumns("passing").map((c) => c.label),
    PASSING_HEADER,
  );
});

test("the Excluded and All views add the Reason column", () => {
  for (const view of ["excluded", "all"]) {
    assert.deepEqual(
      csvColumns(view).map((c) => c.label),
      [...PASSING_HEADER, "Reason"],
      view,
    );
  }
});

test("writes a BOM, the header row, then one row per fund in the given order", () => {
  const funds = [fund({ code: "BBB" }), fund({ code: "AAA" }), fund({ code: "CCC" })];
  const csv = toCsv(funds, csvColumns("passing"));
  assert.ok(csv.startsWith(BOM));
  assert.equal(BOM, "﻿");
  const [header, ...body] = rows(csv);
  assert.deepEqual(header, PASSING_HEADER);
  assert.deepEqual(
    body.map((r) => r[0]),
    ["BBB", "AAA", "CCC"],
  );
});

test("lines end in CRLF, including the last one", () => {
  const csv = toCsv([fund()], csvColumns("passing"));
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(csv.split("\r\n").length, 3);
  assert.ok(!/[^\r]\n/.test(csv));
});

test("an empty list gives just the header row", () => {
  assert.equal(toCsv([], csvColumns("passing")), `${BOM}${PASSING_HEADER.join(",")}\r\n`);
});

test("numbers are raw: returns in percent without %, Sharpe at full precision, risk as an integer", () => {
  const [, row] = rows(toCsv([fund({ returns: { ...fund().returns, "5y": 1234.5 } })], csvColumns("passing")));
  assert.deepEqual(row.slice(3), [
    "1",
    "3.0078",
    "8.3436",
    "17.4597",
    "41.859",
    "32.2183",
    "247.3831",
    "1234.5",
    "1.2345678901234567",
  ]);
});

test("missing values are empty cells", () => {
  const missing = fund({
    risk: null,
    returns: { "1m": 3.5, "3m": null, "6m": undefined, "1y": 50 },
    sharpe: null,
  });
  const [, row] = rows(toCsv([missing], csvColumns("passing")));
  assert.deepEqual(row.slice(3), ["", "3.5", "", "", "50", "", "", "", ""]);
});

test("negative numbers stay numbers, without a quote prefix", () => {
  const [, row] = rows(toCsv([fund({ returns: { "1m": -2.5 }, sharpe: -0.75 })], csvColumns("passing")));
  assert.equal(row[4], "-2.5");
  assert.equal(row[11], "-0.75");
});

test("very small numbers are written as decimals, not in exponent form", () => {
  const [, small, negative] = rows(toCsv([fund({ sharpe: 1e-7 }), fund({ sharpe: -2.5e-8 })], csvColumns("passing")));
  assert.equal(small[11], "0.0000001");
  assert.equal(negative[11], "-0.000000025");
});

test("non-finite numbers are empty cells", () => {
  const [, row] = rows(toCsv([fund({ sharpe: Number.NaN, risk: Infinity })], csvColumns("passing")));
  assert.equal(row[3], "");
  assert.equal(row[11], "");
});

test("the Reason column has the exclusion detail, empty for passing funds", () => {
  const excluded = fund({ code: "XYZ", reason: { rule: "min-1m", detail: "1M 2.10% < 3%" } });
  const [, first, second] = rows(toCsv([excluded, fund()], csvColumns("all")));
  assert.equal(first[12], "1M 2.10% < 3%");
  assert.equal(second[12], "");
});

test("fields with commas, quotes or line breaks are quoted, with quotes doubled", () => {
  const columns = csvColumns("passing").slice(0, 2);
  const cases = [
    ["A, B FONU", '"A, B FONU"'],
    ['THE "BEST" FUND', '"THE ""BEST"" FUND"'],
    ["LINE\nBREAK", '"LINE\nBREAK"'],
    ["CARRIAGE\rRETURN", '"CARRIAGE\rRETURN"'],
    ["PLAIN FUND", "PLAIN FUND"],
  ];
  for (const [name, expected] of cases) {
    const csv = toCsv([fund({ name })], columns);
    assert.equal(csv, `${BOM}Code,Fund\r\nAAL,${expected}\r\n`, JSON.stringify(name));
  }
});

test("text cells that start like a formula get a leading quote", () => {
  const columns = csvColumns("passing").slice(0, 2);
  for (const start of ["=", "+", "-", "@", "\t"]) {
    const csv = toCsv([fund({ name: `${start}SUM(A1)` })], columns);
    assert.equal(csv, `${BOM}Code,Fund\r\nAAL,'${start}SUM(A1)\r\n`, JSON.stringify(start));
  }
  // A carriage return is both prefixed and quoted.
  assert.equal(toCsv([fund({ name: "\rX" })], columns), `${BOM}Code,Fund\r\nAAL,"'\rX"\r\n`);
  // Prefixed and quoted, in that order, so the quote stays inside the field.
  assert.equal(toCsv([fund({ name: '=HYPERLINK("x","y")' })], columns), `${BOM}Code,Fund\r\nAAL,"'=HYPERLINK(""x"",""y"")"\r\n`);
  // Code, type and reason cells too; text that only contains those characters is left alone.
  const risky = fund({ code: "=A", umbrella: "@B", reason: { rule: "order", detail: "-C" }, name: "A=B" });
  const [, row] = rows(toCsv([risky], csvColumns("all")));
  assert.deepEqual([row[0], row[1], row[2], row[12]], ["'=A", "A=B", "'@B", "'-C"]);
});

test("keeps Turkish characters", () => {
  const csv = toCsv([fund({ name: "İŞ PORTFÖY ĞÜÇ ıöş" })], csvColumns("passing").slice(0, 2));
  assert.equal(csv, `${BOM}Code,Fund\r\nAAL,İŞ PORTFÖY ĞÜÇ ıöş\r\n`);
  // Encoded as UTF-8 with the BOM bytes first, as a Blob of this string is.
  const bytes = new TextEncoder().encode(csv);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(new TextDecoder().decode(bytes).includes("İŞ PORTFÖY ĞÜÇ ıöş"));
});

test("the file name has the view and the data's Istanbul date", () => {
  assert.equal(csvFileName("passing", "2026-10-29T07:15:37Z"), "tefas-funds-passing-2026-10-29.csv");
  assert.equal(csvFileName("excluded", "2026-10-29T07:15:37Z"), "tefas-funds-excluded-2026-10-29.csv");
  assert.equal(csvFileName("all", "2026-10-29T07:15:37Z"), "tefas-funds-all-2026-10-29.csv");
});

test("the file name's date is the Istanbul date across midnight UTC", () => {
  // 22:30 UTC on the 28th is 01:30 on the 29th in Istanbul (UTC+3).
  assert.equal(csvFileName("all", "2026-10-28T22:30:00Z"), "tefas-funds-all-2026-10-29.csv");
  // 20:59 UTC is still 23:59 the same day in Istanbul.
  assert.equal(csvFileName("all", "2026-10-28T20:59:00Z"), "tefas-funds-all-2026-10-28.csv");
});

test("the file name has no date when fetchedAt is missing or invalid", () => {
  for (const value of [undefined, null, "", "not a date", 42, {}, "2026-13-45T00:00:00Z"]) {
    assert.equal(csvFileName("passing", value), "tefas-funds-passing.csv", JSON.stringify(value));
  }
});
