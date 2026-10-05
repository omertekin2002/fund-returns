import { HORIZONS, RULES, exclusionReason } from "./filter.js";

const COLUMNS = [
  { key: "code", label: "Code", type: "text", value: (f) => f.code },
  { key: "name", label: "Fund", type: "text", value: (f) => f.name },
  { key: "umbrella", label: "Type", type: "text", value: (f) => f.umbrella },
  { key: "risk", label: "Risk", type: "number", value: (f) => f.risk },
  ...HORIZONS.map((h) => ({
    key: h.key,
    label: h.label,
    type: "return",
    value: (f) => f.returns[h.key],
  })),
  { key: "reason", label: "Reason", type: "text", value: (f) => f.reason?.detail ?? "" },
];

const state = {
  funds: [],
  view: "passing",
  query: "",
  sortKey: "1m",
  sortDir: "desc",
};

const els = {
  status: document.getElementById("status"),
  sticker: document.getElementById("pass-sticker"),
  updated: document.getElementById("updated"),
  rules: document.getElementById("rules"),
  headerRow: document.getElementById("header-row"),
  body: document.querySelector("#funds tbody"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search"),
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

function formatFetchedAt(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
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

function selectedFunds() {
  const query = normalize(state.query.trim());
  const col = COLUMNS.find((c) => c.key === state.sortKey);
  return state.funds
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

function renderCounts() {
  const passing = state.funds.filter((f) => !f.reason).length;
  const counts = { passing, excluded: state.funds.length - passing, all: state.funds.length };
  for (const el of document.querySelectorAll("[data-count]")) {
    el.textContent = countFormat.format(counts[el.dataset.count]);
  }
  for (const button of els.viewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  }
}

function render() {
  renderCounts();
  renderHeader();
  renderBody();
}

async function init() {
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderBody();
  });
  for (const button of els.viewButtons) {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      if (state.view === "passing" && state.sortKey === "reason") {
        state.sortKey = "1m";
        state.sortDir = "desc";
      }
      render();
    });
  }

  try {
    const response = await fetch("data/funds.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.funds = data.funds.map((fund) => ({
      ...fund,
      reason: exclusionReason(fund),
      searchText: normalize(`${fund.code} ${fund.name} ${fund.umbrella}`),
    }));
    const passing = state.funds.filter((f) => !f.reason).length;
    els.sticker.textContent = `${countFormat.format(passing)} funds pass`;
    els.updated.textContent = `Updated ${formatFetchedAt(data.fetchedAt)}`;
    els.updated.title = "Istanbul time";
    els.status.textContent =
      `Every weekday morning around 11:00 Istanbul time, all ${countFormat.format(state.funds.length)} ` +
      "funds traded on TEFAS are checked against five rules. " +
      `${countFormat.format(passing)} pass all five and are listed above.`;
  } catch (error) {
    els.sticker.textContent = "No data";
    els.status.textContent = `Could not load fund data: ${error.message}`;
    return;
  }

  renderRules();
  render();
}

init();
