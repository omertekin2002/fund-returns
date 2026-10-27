// The table's view, sort and search as kept in the page URL, e.g.
// "?view=excluded&sort=sharpe&dir=asc&q=altın". Values at their default are
// left out, so the default page has no query string.
import { COLUMNS } from "./columns.js";

export const VIEWS = ["passing", "excluded", "all"];

export const DEFAULT_STATE = Object.freeze({ view: "passing", query: "", sortKey: "1m", sortDir: "desc" });

const SORT_KEYS = COLUMNS.map((c) => c.key);
const SORT_DIRS = ["asc", "desc"];

// The Reason column is only shown for excluded funds, so the Passing view
// can't be sorted by it.
export const canSortBy = (view, sortKey) => sortKey !== "reason" || view !== "passing";

// Reads { view, query, sortKey, sortDir } from a location.search string.
// Each missing or invalid parameter falls back to its default on its own; a
// sort by reason in the Passing view falls back to the default sort.
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
  return { view, query: params.get("q") ?? DEFAULT_STATE.query, sortKey, sortDir };
}

// The query string for a state ("?view=…&sort=…&dir=…&q=…"), or "" when
// every value is at its default.
export function serializeState({ view, query, sortKey, sortDir }) {
  const params = new URLSearchParams();
  if (view !== DEFAULT_STATE.view) params.set("view", view);
  if (sortKey !== DEFAULT_STATE.sortKey) params.set("sort", sortKey);
  if (sortDir !== DEFAULT_STATE.sortDir) params.set("dir", sortDir);
  if (query !== DEFAULT_STATE.query) params.set("q", query);
  const text = params.toString();
  return text ? `?${text}` : "";
}
