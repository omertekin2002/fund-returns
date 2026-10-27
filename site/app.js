import { COLUMNS } from "./columns.js";
import { RULES, exclusionReason } from "./filter.js";
import { isStale } from "./freshness.js";
import { riskFreeReturns, sharpeRatio } from "./sharpe.js";
import { canSortBy, DEFAULT_STATE, parseState, serializeState } from "./urlstate.js";

// View, sort, search and filters start from the page URL, so links can be shared.
const state = {
  funds: [],
  ...parseState(location.search),
};

const els = {
  status: document.getElementById("status"),
  sticker: document.getElementById("pass-sticker"),
  updated: document.getElementById("updated"),
  stale: document.getElementById("stale"),
  rules: document.getElementById("rules"),
  headerRow: document.getElementById("header-row"),
  body: document.querySelector("#funds tbody"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search"),
  typeFilter: document.getElementById("type-filter"),
  riskFilter: document.getElementById("risk-filter"),
  viewButtons: document.querySelectorAll("[data-view]"),
};

const countFormat = new Intl.NumberFormat("en-US");
const numberFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatReturn(value) {
  if (value === null || value === undefined) return "—";
  return `${numberFormat.format(value)}%`;
}

function formatRatio(value) {
  if (value === null || value === undefined) return "—";
  return numberFormat.format(value);
}

// Null when the time is missing or unparseable.
function formatFetchedAt(iso) {
  const date = new Date(iso);
  if (typeof iso !== "string" || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

// Lower-case with Turkish rules so "İ"/"I" match "i"/"ı" typed in search.
const normalize = (text) => text.toLocaleLowerCase("tr-TR");

function visibleColumns() {
  return state.view === "passing" ? COLUMNS.filter((c) => c.key !== "reason") : COLUMNS;
}

function renderRules() {
  const counts = {};
  for (const fund of state.funds) {
    if (fund.reason) counts[fund.reason.rule] = (counts[fund.reason.rule] ?? 0) + 1;
  }
  els.rules.replaceChildren(
    ...RULES.map((rule, index) => {
      const li = document.createElement("li");
      li.className = "ribbon";
      const title = document.createElement("div");
      title.className = "ribbon-title";
      title.textContent = `Rule ${index + 1} · ${rule.title}`;
      const body = document.createElement("div");
      body.className = `ribbon-body rule-${rule.id}`;
      const count = document.createElement("strong");
      count.textContent = `${countFormat.format(counts[rule.id] ?? 0)} funds out.`;
      body.append(`${rule.text} `, count);
      li.append(title, body);
      return li;
    }),
  );
}

function renderHeader() {
  els.headerRow.replaceChildren(
    ...visibleColumns().map((col) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.className = `col-${col.type} col-${col.key}`;
      const sorted = state.sortKey === col.key;
      th.setAttribute("aria-sort", sorted ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = col.label;
      if (col.title) button.title = col.title;
      if (sorted) button.dataset.dir = state.sortDir;
      button.addEventListener("click", () => {
        if (state.sortKey === col.key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = col.key;
          state.sortDir = col.type === "text" ? "asc" : "desc";
        }
        render();
      });
      th.append(button);
      return th;
    }),
  );
}

function compare(a, b, col) {
  const va = col.value(a);
  const vb = col.value(b);
  const missingA = va === null || va === undefined || va === "";
  const missingB = vb === null || vb === undefined || vb === "";
  // Missing values always sort last, whatever the direction.
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
  const result = col.type === "text" ? va.localeCompare(vb, "tr") : va - vb;
  return state.sortDir === "asc" ? result : -result;
}

// Funds of the chosen type and risk level. A risk filter never matches funds
// with no risk level.
function filteredFunds() {
  return state.funds
    .filter((f) => !state.type || f.umbrella === state.type)
    .filter((f) => !state.risk || f.risk === Number(state.risk));
}

function selectedFunds() {
  const query = normalize(state.query.trim());
  const col = COLUMNS.find((c) => c.key === state.sortKey);
  return filteredFunds()
    .filter((f) => state.view === "all" || (state.view === "passing") === !f.reason)
    .filter((f) => !query || f.searchText.includes(query))
    .sort((a, b) => compare(a, b, col) || a.code.localeCompare(b.code));
}

function renderBody() {
  const columns = visibleColumns();
  const rows = selectedFunds().map((fund) => {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      td.className = `col-${col.type} col-${col.key}`;
      const value = col.value(fund);
      if (col.key === "code") {
        const link = document.createElement("a");
        link.href = `https://www.tefas.gov.tr/tr/fon-detayli-analiz/${encodeURIComponent(fund.code)}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = fund.code;
        td.append(link);
      } else if (col.type === "return") {
        td.textContent = formatReturn(value);
      } else if (col.type === "ratio") {
        td.textContent = formatRatio(value);
      } else if (col.key === "reason" && fund.reason) {
        // Tinted with the colour of the rule's card above the table.
        td.classList.add(`rule-${fund.reason.rule}`);
        td.textContent = value;
      } else {
        td.textContent = value ?? "—";
      }
      tr.append(td);
    }
    return tr;
  });
  els.body.replaceChildren(...rows);
  els.empty.hidden = rows.length > 0;
}

// The view counts follow the type and risk filters but not the search.
function renderCounts() {
  const funds = filteredFunds();
  const passing = funds.filter((f) => !f.reason).length;
  const counts = { passing, excluded: funds.length - passing, all: funds.length };
  for (const el of document.querySelectorAll("[data-count]")) {
    el.textContent = countFormat.format(counts[el.dataset.count]);
  }
  for (const button of els.viewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  }
}

// Keeps the view, sort, search and filters in the URL without adding history
// entries.
function updateUrl() {
  const url = `${location.pathname}${serializeState(state)}${location.hash}`;
  history.replaceState(history.state, "", url);
}

function render() {
  renderCounts();
  renderHeader();
  renderBody();
  updateUrl();
}

async function init() {
  els.search.value = state.query;
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderBody();
    updateUrl();
  });
  for (const button of els.viewButtons) {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      if (!canSortBy(state.view, state.sortKey)) {
        state.sortKey = DEFAULT_STATE.sortKey;
        state.sortDir = DEFAULT_STATE.sortDir;
      }
      render();
    });
  }
  els.riskFilter.value = state.risk;
  for (const [key, select] of [
    ["type", els.typeFilter],
    ["risk", els.riskFilter],
  ]) {
    select.addEventListener("change", () => {
      state[key] = select.value;
      render();
    });
  }

  try {
    const response = await fetch("data/funds.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const riskFree = riskFreeReturns(data.funds);
    state.funds = data.funds.map((raw) => {
      const fund = { ...raw, sharpe: sharpeRatio(raw.prices, riskFree) };
      return {
        ...fund,
        reason: exclusionReason(fund),
        searchText: normalize(`${fund.code} ${fund.name} ${fund.umbrella}`),
      };
    });
    // The type options are the umbrellas in the data; a type from the URL that
    // matches none of them is dropped.
    const umbrellas = [...new Set(state.funds.map((f) => f.umbrella).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "tr"),
    );
    els.typeFilter.append(
      ...umbrellas.map((umbrella) => {
        const option = document.createElement("option");
        option.value = umbrella;
        option.textContent = umbrella;
        return option;
      }),
    );
    if (!umbrellas.includes(state.type)) state.type = "";
    els.typeFilter.value = state.type;
    const passing = state.funds.filter((f) => !f.reason).length;
    els.sticker.textContent = `${countFormat.format(passing)} funds pass`;
    const fetchedAt = formatFetchedAt(data.fetchedAt);
    const stale = isStale(data.fetchedAt);
    els.updated.textContent = fetchedAt ? `Updated ${fetchedAt}` : "Update time unknown";
    els.updated.title = "Istanbul time";
    els.status.textContent =
      `Every weekday morning around 10:15 Istanbul time, all ${countFormat.format(state.funds.length)} ` +
      "funds traded on TEFAS are checked against six rules. " +
      `${countFormat.format(passing)} pass all six and are listed above.` +
      (stale ? " The latest daily update is missing, so these figures may be out of date." : "");
    if (stale) {
      els.stale.textContent = fetchedAt
        ? `Data may be out of date: last updated ${fetchedAt} Istanbul time. The daily update has not run since.`
        : "Data may be out of date: the time of the last update is unknown.";
      els.stale.hidden = false;
    }
  } catch (error) {
    els.sticker.textContent = "No data";
    els.status.textContent = `Could not load fund data: ${error.message}`;
    return;
  }

  renderRules();
  render();
}

init();
