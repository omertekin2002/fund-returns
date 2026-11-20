// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COLUMNS, columnsFor, PHONE_ORDER, PHONE_QUERY } from "../site/columns.js";
import { BOM, csvColumns, toCsv } from "../site/csv.js";

const labels = (columns) => columns.map((c) => c.label);

const DESKTOP = [
  ...["Code", "Fund", "Type", "Risk", "Size"],
  ...["1M", "3M", "6M", "1Y", "YTD", "3Y", "5Y", "Sharpe", "4 weeks"],
];
const PHONE = [
  ...["Code", "1M", "3M", "6M", "1Y", "Sharpe"],
  ...["Fund", "Type", "Risk", "Size", "YTD", "3Y", "5Y", "4 weeks"],
];

test("the desktop order is unchanged, with Reason last outside the Passing view", () => {
  assert.deepEqual(labels(columnsFor("passing")), DESKTOP);
  assert.deepEqual(labels(columnsFor("passing", { phone: false })), DESKTOP);
  for (const view of ["excluded", "all"]) {
    assert.deepEqual(labels(columnsFor(view)), [...DESKTOP, "Reason"], view);
  }
});

test("phones lead with the code, then the rule numbers, with Reason right after the code", () => {
  assert.deepEqual(labels(columnsFor("passing", { phone: true })), PHONE);
  for (const view of ["excluded", "all"]) {
    assert.deepEqual(labels(columnsFor(view, { phone: true })), ["Code", "Reason", ...PHONE.slice(1)], view);
  }
});

test("each view has the same columns in both orders", () => {
  assert.deepEqual([...PHONE_ORDER].sort(), COLUMNS.map((c) => c.key).sort());
  for (const view of ["passing", "excluded", "all"]) {
    const desktop = columnsFor(view);
    const phone = columnsFor(view, { phone: true });
    assert.equal(phone.length, desktop.length, view);
    assert.deepEqual(new Set(phone), new Set(desktop), view);
  }
});

test("the phone order applies at the phone breakpoint in style.css", async () => {
  const css = await readFile(new URL("../site/style.css", import.meta.url), "utf8");
  assert.ok(css.includes(`@media ${PHONE_QUERY} {`), PHONE_QUERY);
});

test("the CSV keeps the desktop order, byte for byte", () => {
  const fund = {
    code: "AAL",
    name: "ATA PORTFÖY PARA PİYASASI (TL) FONU",
    umbrella: "Para Piyasası Şemsiye Fonu",
    risk: 1,
    size: 1163456789.12,
    returns: { "1m": 3.0078, "3m": 8.3436, "6m": 17.4597, "1y": 41.859, ytd: 32.2183, "3y": 247.3831, "5y": 412.4501 },
    sharpe: 1.25,
    trend: null,
    reason: { rule: "returns", detail: "3M 8.34% < 9%" },
  };
  assert.equal(
    toCsv([fund], csvColumns("excluded")),
    `${BOM}Code,Fund,Type,Risk,Size (TL),1M,3M,6M,1Y,YTD,3Y,5Y,Sharpe,Reason\r\n` +
      "AAL,ATA PORTFÖY PARA PİYASASI (TL) FONU,Para Piyasası Şemsiye Fonu,1,1163456789.12," +
      "3.0078,8.3436,17.4597,41.859,32.2183,247.3831,412.4501,1.25,3M 8.34% < 9%\r\n",
  );
  assert.equal(
    toCsv([fund], csvColumns("passing")).split("\r\n")[0],
    `${BOM}Code,Fund,Type,Risk,Size (TL),1M,3M,6M,1Y,YTD,3Y,5Y,Sharpe`,
  );
});
