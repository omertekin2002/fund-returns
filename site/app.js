import { changesSummary, classifyFunds, membershipChanges } from "./changes.js";
import { COLUMNS, columnsFor } from "./columns.js";
import { csvColumns, csvFileName, toCsv } from "./csv.js";
import { RULES, ruleEvidence } from "./filter.js";
import { isStale } from "./freshness.js";
import { HEIGHT, polylinePoints, sparkline, sparklineLabel, WIDTH } from "./sparkline.js";
import { canSortBy, DEFAULT_STATE, parseState, serializeState } from "./urlstate.js";

// View, sort, search and filters start from the page URL, so links can be shared.
const state = {
  funds: [],
  // The data file's fetch time (ISO), which dates the CSV file name.
  fetchedAt: null,
  // Codes of the funds that entered or left the passing list since the
  // previous update; empty until data/previous.json has loaded.
  entered: new Set(),
  left: new Set(),
  // Codes of the funds whose rule evidence row is open. Kept while the page
  // is open (not in the URL), so open rows stay open after a sort or search.
  openEvidence: new Set(),
  ...parseState(location.search),
};

const els = {
  status: document.getElementById("status"),
  sticker: document.getElementById("pass-sticker"),
  updated: document.getElementById("updated"),
  stale: document.getElementById("stale"),
  changes: document.getElementById("changes"),
  rules: document.getElementById("rules"),
  headerRow: document.getElementById("header-row"),
  body: document.querySelector("#funds tbody"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search"),
  download: document.getElementById("download-csv"),
  typeFilter: document.getElementById("type-filter"),
  riskFilter: document.getElementById("risk-filter"),
  viewButtons: document.querySelectorAll("[data-view]"),
};

const SVG_NS = "http://www.w3.org/2000/svg";

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
  return columnsFor(state.view);
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
      if (col.sortable === false) {
        // A plain label: no sort button and no aria-sort.
        const label = document.createElement("span");
        label.textContent = col.label;
        if (col.title) label.title = col.title;
        th.append(label);
        return th;
      }
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

function badge(text, title) {
  const span = document.createElement("span");
  span.className = `badge badge-${text.toLowerCase()}`;
  span.textContent = text;
  span.title = title;
  return span;
}

// The fund's 4-week price line as an inline SVG, from the points worked out
// when the data loaded.
function sparklineSvg(trend) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("width", String(WIDTH));
  svg.setAttribute("height", String(HEIGHT));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", trend.label);
  for (const points of trend.points) {
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", points);
    svg.append(line);
  }
  return svg;
}

const OUTCOME_TEXT = { pass: "Pass", fail: "Fail", "missing-allowed": "Missing, allowed" };

// The id of a fund's evidence row, for the toggle's aria-controls.
const evidenceId = (code) => `evidence-${code.replace(/[^\w-]/g, "_")}`;

// The row under a fund's row that shows how the fund fares on each of the six
// rules, spanning the table's `span` columns.
function evidenceRow(fund, span) {
  const tr = document.createElement("tr");
  tr.className = "evidence-row";
  tr.id = evidenceId(fund.code);
  const td = document.createElement("td");
  td.colSpan = span;
  const list = document.createElement("ol");
  list.className = "evidence";
  list.setAttribute("aria-label", `How ${fund.code} fares on each rule`);
  const entries = ruleEvidence(fund);
  // The first failure is the one the Reason column shows.
  const reason = entries.find((e) => e.outcome === "fail");
  list.append(
    ...entries.map((entry) => {
      const index = RULES.findIndex((r) => r.id === entry.rule);
      const li = document.createElement("li");
      li.className = `evidence-item evidence-${entry.outcome}`;
      li.dataset.rule = entry.rule;
      li.dataset.outcome = entry.outcome;
      const head = document.createElement("div");
      head.className = "evidence-title";
      const title = document.createElement("span");
      title.textContent = `Rule ${index + 1} · ${RULES[index].title}`;
      const outcome = document.createElement("strong");
      outcome.className = "evidence-outcome";
      outcome.textContent = OUTCOME_TEXT[entry.outcome];
      const verdict = document.createElement("span");
      verdict.className = "evidence-verdict";
      if (entry === reason) verdict.append(badge("REASON", "The rule shown in the Reason column"), " ");
      verdict.append(outcome);
      head.append(title, " ", verdict);
      const body = document.createElement("div");
      // Failures are tinted with the colour of the rule's card above the table.
      body.className = entry.outcome === "fail" ? `evidence-body rule-${entry.rule}` : "evidence-body";
      const measured = document.createElement("p");
      measured.className = "evidence-measured";
      measured.textContent = entry.measured;
      const requirement = document.createElement("p");
      requirement.className = "evidence-requirement";
      requirement.textContent = `Needs: ${entry.requirement}`;
      body.append(measured, requirement);
      li.append(head, body);
      return li;
    }),
  );
  td.append(list);
  tr.append(td);
  return tr;
}

// The button that opens and closes a fund's evidence row.
function evidenceToggle(fund) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "evidence-toggle";
  button.textContent = "Rules";
  button.setAttribute("aria-label", `Rules for ${fund.code}`);
  button.setAttribute("aria-controls", evidenceId(fund.code));
  button.setAttribute("aria-expanded", String(state.openEvidence.has(fund.code)));
  // Adds or removes just this row, so the rest of the table and the focus stay put.
  button.addEventListener("click", () => {
    const row = button.closest("tr");
    if (state.openEvidence.has(fund.code)) {
      state.openEvidence.delete(fund.code);
      document.getElementById(evidenceId(fund.code))?.remove();
      button.setAttribute("aria-expanded", "false");
    } else {
      state.openEvidence.add(fund.code);
      row.after(evidenceRow(fund, row.cells.length));
      button.setAttribute("aria-expanded", "true");
    }
  });
  return button;
}

function renderBody() {
  const columns = visibleColumns();
  const funds = selectedFunds();
  const rows = funds.flatMap((fund) => {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      td.className = `col-${col.type} col-${col.key}`;
      const value = col.value(fund);
      if (col.key === "code") {
        td.append(evidenceToggle(fund), " ");
        const link = document.createElement("a");
        link.href = `https://www.tefas.gov.tr/tr/fon-detayli-analiz/${encodeURIComponent(fund.code)}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = fund.code;
        td.append(link);
        // Funds that entered are passing and funds that left are excluded, so
        // each badge only shows in the views that list that fund.
        if (state.entered.has(fund.code)) {
          td.append(" ", badge("NEW", "Entered the passing list since the previous update"));
        }
        if (state.left.has(fund.code)) {
          td.append(" ", badge("LEFT", "Left the passing list since the previous update"));
        }
      } else if (col.type === "return") {
        td.textContent = formatReturn(value);
      } else if (col.type === "ratio") {
        td.textContent = formatRatio(value);
      } else if (col.type === "sparkline") {
        if (value) td.append(sparklineSvg(value));
        else td.textContent = "—";
      } else if (col.key === "reason" && fund.reason) {
        // Tinted with the colour of the rule's card above the table.
        td.classList.add(`rule-${fund.reason.rule}`);
        td.textContent = value;
      } else {
        td.textContent = value ?? "—";
      }
      tr.append(td);
    }
    return state.openEvidence.has(fund.code) ? [tr, evidenceRow(fund, columns.length)] : [tr];
  });
  els.body.replaceChildren(...rows);
  els.empty.hidden = funds.length > 0;
  // Nothing to download while no fund matches.
  els.download.disabled = funds.length === 0;
}

// Downloads the rows the table shows, in its order, as a CSV file.
function downloadCsv() {
  const funds = selectedFunds();
  if (funds.length === 0) return;
  const blob = new Blob([toCsv(funds, csvColumns(state.view))], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = csvFileName(state.view, state.fetchedAt);
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked a moment later, once the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

// The fund's price line ready to draw ({ points, label }), or null with fewer
// than two prices.
function trendOf(prices, days) {
  const line = sparkline(prices, days);
  if (!line) return null;
  return { points: line.segments.map(polylinePoints), label: sparklineLabel(line.change) };
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
  els.download.addEventListener("click", downloadCsv);
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
    const days = Array.isArray(data.priceDates) ? data.priceDates.length : 0;
    state.fetchedAt = data.fetchedAt;
    state.funds = classifyFunds(data.funds).map((fund) => ({
      ...fund,
      searchText: normalize(`${fund.code} ${fund.name} ${fund.umbrella}`),
      // Worked out once here, not on every render, so the All view stays fast.
      trend: trendOf(fund.prices, days),
    }));
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
  loadChanges();
}

// Loads the previous update's data after the table is on screen, and marks
// the funds that entered or left the passing list since then. Without
// data/previous.json (before the first daily update keeps one) or with a
// broken one, the page shows nothing about changes.
async function loadChanges() {
  let changes;
  let previousFetchedAt;
  try {
    const response = await fetch("data/previous.json", { cache: "no-cache" });
    if (!response.ok) return;
    const previous = await response.json();
    if (!Array.isArray(previous?.funds)) return;
    changes = membershipChanges(state.funds, classifyFunds(previous.funds));
    previousFetchedAt = previous.fetchedAt;
  } catch {
    return;
  }
  state.entered = new Set(changes.entered);
  state.left = new Set(changes.left);
  els.changes.textContent = changesSummary(changes, previousFetchedAt);
  els.changes.hidden = false;
  renderBody();
}

init();
