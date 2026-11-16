// What the table says when it has no rows: either that the view itself lists
// no fund in the data (e.g. the Passing view on a day no fund passes all six
// rules), or which filters and search narrow a view that does list funds to
// nothing, with a control that clears them. Used by app.js, which sets the
// text with textContent.

// The change filter's options, as the select words them.
const CHANGE_TEXT = {
  entered: "Entered the passing list",
  left: "Left the passing list",
};

// What each view says when it lists no fund at all, whatever the filters and
// search. Clearing them can't help, so there is no reset control.
const EMPTY_VIEW_TEXT = {
  passing: "No fund passes all six rules in the latest data.",
  excluded: "No fund breaks any of the six rules in the latest data.",
  all: "The latest data has no funds.",
};

// "a", "a and b", "a, b and c".
function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// Whether the fund is in the view, ignoring the filters and search.
export const inView = (view, fund) => view === "all" || (view === "passing") === !fund.reason;

// The filters and search that narrow the table, in the order the controls
// appear: type, risk, change, search. A change filter kept from the URL before
// the changes have loaded is not applied, so it is not listed. A search of
// only spaces matches every fund, so it is not listed either.
export function activeNarrowings({ type, risk, changed, changesLoaded, query }) {
  const parts = [];
  if (type) parts.push(`the type "${type}"`);
  if (risk) parts.push(`risk ${risk}`);
  if (changesLoaded && CHANGE_TEXT[changed]) parts.push(`the change filter "${CHANGE_TEXT[changed]}"`);
  const search = (query ?? "").trim();
  if (search) parts.push(`the search "${search}"`);
  return parts;
}

// What the empty table should say for the state ({ view, type, risk, changed,
// changesLoaded, query }) and every fund in the data (each with its `reason`,
// null for a passing fund): { text, reset }, where `reset` says whether to
// offer the control that clears the filters and search.
export function emptyMessage(state, funds) {
  if (!funds.some((f) => inView(state.view, f))) {
    const text = funds.length === 0 ? EMPTY_VIEW_TEXT.all : EMPTY_VIEW_TEXT[state.view] ?? EMPTY_VIEW_TEXT.all;
    return { text, reset: false };
  }
  const parts = activeNarrowings(state);
  // Not reached from the page: with nothing narrowing it, a view that lists
  // funds shows them.
  if (parts.length === 0) return { text: "No funds match.", reset: false };
  return { text: `No funds match ${joinList(parts)}.`, reset: true };
}
