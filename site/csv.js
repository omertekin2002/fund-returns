// The funds in the table's current view as a CSV file (RFC 4180, comma
// separated, CRLF line ends), for the Download CSV button. No DOM access, so
// node --test can check it.
import { columnsFor } from "./columns.js";
import { istanbulDate } from "./freshness.js";

// Excel reads a CSV file without a byte order mark as the system code page,
// which garbles Turkish letters (İ, ş, ğ…).
export const BOM = "﻿";

// The columns written for a view: the ones the table shows, minus the 4-week
// price line, which is a picture rather than data.
export function csvColumns(view) {
  return columnsFor(view).filter((c) => c.type !== "sparkline");
}

// Text starting with one of these is run as a formula by spreadsheet apps
// (CSV injection), so it gets a leading "'".
const FORMULA_START = /^[=+\-@\t\r]/;

// Numbers as plain decimals with "." and no grouping; "" when missing.
function numberCell(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const text = String(value);
  // Very small ratios would come out as e.g. "1e-7".
  return /e/i.test(text) ? value.toFixed(20).replace(/\.?0+$/, "") : text;
}

function textCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

// Quotes a field that holds a comma, a quote or a line break, doubling quotes.
function quote(field) {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

// The CSV text for funds (in table order) and columns (from columns.js): a
// BOM, a header row of column labels, then one row per fund. Returns, risk and
// Sharpe are the raw numbers (returns in percent, without "%").
export function toCsv(funds, columns) {
  const row = (cells) => `${cells.map(quote).join(",")}\r\n`;
  const lines = funds.map((fund) =>
    row(columns.map((col) => (col.type === "text" ? textCell(col.value(fund)) : numberCell(col.value(fund))))),
  );
  return BOM + row(columns.map((col) => col.label)) + lines.join("");
}

// "tefas-funds-<view>-<YYYY-MM-DD>.csv", dated with the Istanbul day the data
// was fetched; without a date when fetchedAt is missing or invalid.
export function csvFileName(view, fetchedAt) {
  const day = typeof fetchedAt === "string" ? istanbulDate(new Date(fetchedAt)) : null;
  return day ? `tefas-funds-${view}-${day}.csv` : `tefas-funds-${view}.csv`;
}
