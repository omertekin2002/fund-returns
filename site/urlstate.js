// The table's view, sort, search and type and risk filters as kept in the page
// URL, e.g. "?view=excluded&sort=sharpe&dir=asc&q=altın&type=Hisse+Senedi+Şemsiye+Fonu&risk=6".
// Values at their default are left out, so the default page has no query string.
import { COLUMNS } from "./columns.js";

export const VIEWS = ["passing", "excluded", "all"];

export const DEFAULT_STATE = Object.freeze({
  view: "passing",
  query: "",
  sortKey: "1m",
  sortDir: "desc",
  type: "",
  risk: "",
});

// TEFAS risk levels; the risk filter matches exactly one of them.
export const RISK_LEVELS = ["1", "2", "3", "4", "5", "6", "7"];

const SORT_KEYS = COLUMNS.map((c) => c.key);
const SORT_DIRS = ["asc", "desc"];

// The Reason column is only shown for excluded funds, so the Passing view
// can't be sorted by it.
export const canSortBy = (view, sortKey) => sortKey !== "reason" || view !== "passing";

// Reads { view, query, sortKey, sortDir, type, risk } from a location.search
// string. Each missing or invalid parameter falls back to its default on its
// own; a sort by reason in the Passing view falls back to the default sort.
// The type is any string here: app.js drops it if no fund has that umbrella.
export function parseState(search) {
  const params = new URLSearchParams(search);
  const pick = (name, valid, fallback) => {
    const value = params.get(name);
    return valid.includes(value) ? value : fallback;
  };
  const view = pick("view", VIEWS, DEFAULT_STATE.view);
  let sortKey = pick("sort", SORT_KEYS, DEFAULT_STATE.sortKey);
  let sortDir = pick("dir", SORT_DIRS, DEFAULT_STATE.sortDir);
  if (!canSortBy(view, sortKey)) {
    sortKey = DEFAULT_STATE.sortKey;
    sortDir = DEFAULT_STATE.sortDir;
  }
  return {
    view,
    query: params.get("q") ?? DEFAULT_STATE.query,
    sortKey,
    sortDir,
    type: params.get("type") ?? DEFAULT_STATE.type,
    risk: pick("risk", RISK_LEVELS, DEFAULT_STATE.risk),
  };
}

// The query string for a state ("?view=…&sort=…&dir=…&q=…&type=…&risk=…"), or
// "" when every value is at its default.
export function serializeState({ view, query, sortKey, sortDir, type, risk }) {
  const params = new URLSearchParams();
  if (view !== DEFAULT_STATE.view) params.set("view", view);
  if (sortKey !== DEFAULT_STATE.sortKey) params.set("sort", sortKey);
  if (sortDir !== DEFAULT_STATE.sortDir) params.set("dir", sortDir);
  if (query !== DEFAULT_STATE.query) params.set("q", query);
  if (type !== DEFAULT_STATE.type) params.set("type", type);
  if (risk !== DEFAULT_STATE.risk) params.set("risk", risk);
  const text = params.toString();
  return text ? `?${text}` : "";
}
