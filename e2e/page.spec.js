// Run with: npm run test:e2e
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { RULES, ruleEvidence } from "../site/filter.js";
import { changesSummary, classifyFunds, membershipChanges } from "../site/changes.js";
import { istanbulDate } from "../site/freshness.js";
import { RISK_FREE_UMBRELLA } from "../site/sharpe.js";
import {
  committedPrevious,
  data,
  excluded,
  filtered,
  formatCount,
  funds,
  hasTrend,
  normalize,
  passing,
  previousData,
  ruleCounts,
  umbrellas,
} from "./expected.js";

const rows = (page) => page.locator("#funds tbody tr");
const header = (page, key) => page.locator(`#header-row th.col-${key}`);

// Opens the page (with an optional query string) and waits until the data has
// been rendered.
async function open(page, search = "") {
  await page.goto(`./${search}`);
  await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(passing.length)} funds pass`);
}

test("loads the data without errors", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await open(page);
  await expect(page.locator("#status")).toContainText(`all ${formatCount(funds.length)} funds traded on TEFAS`);
  await expect(page.locator("#status")).not.toContainText("Could not load fund data");
  await expect(page.locator("#rules li")).toHaveCount(RULES.length);
  expect(errors).toEqual([]);
});

test("shows the passing, excluded and total counts", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-count="passing"]')).toHaveText(formatCount(passing.length));
  await expect(page.locator('[data-count="excluded"]')).toHaveText(formatCount(excluded.length));
  await expect(page.locator('[data-count="all"]')).toHaveText(formatCount(funds.length));
});

test("lists passing funds without a reason, and excluded funds with one", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(passing.length);
  await expect(header(page, "reason")).toHaveCount(0);

  await page.locator('[data-view="excluded"]').click();
  await expect(page.locator('[data-view="excluded"]')).toHaveAttribute("aria-pressed", "true");
  await expect(header(page, "reason")).toHaveText("Reason");
  await expect(rows(page)).toHaveCount(excluded.length);
  await expect(page.locator("#funds tbody td.col-reason:empty")).toHaveCount(0);

  await page.locator('[data-view="all"]').click();
  await expect(rows(page)).toHaveCount(funds.length);
});

test("shows six rule cards whose counts add up to the excluded funds", async ({ page }) => {
  await open(page);
  expect(RULES).toHaveLength(6);
  const counts = page.locator("#rules li strong");
  await expect(counts).toHaveText(ruleCounts.map((n) => `${formatCount(n)} funds out.`));
  const shown = (await counts.allTextContents()).map((text) => Number(text.replace(/[^\d]/g, "")));
  expect(shown.reduce((sum, n) => sum + n, 0)).toBe(excluded.length);
});

test("search narrows the table, and says when nothing matches", async ({ page }) => {
  await open(page);
  await page.locator('[data-view="all"]').click();

  const code = funds[0].code;
  const query = normalize(code);
  const matching = funds.filter((f) => normalize(`${f.code} ${f.name} ${f.umbrella}`).includes(query));
  await page.locator("#search").fill(code);
  await expect(rows(page)).toHaveCount(matching.length);
  await expect(rows(page).locator("td.col-code", { hasText: code })).not.toHaveCount(0);
  for (const text of await rows(page).allTextContents()) {
    expect(normalize(text)).toContain(query);
  }
  await expect(page.locator("#empty")).toBeHidden();

  await page.locator("#search").fill("no fund is called this");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#empty")).toHaveText("No funds match.");
});

test("clicking a column header sorts by it, and clicking again reverses", async ({ page }) => {
  await open(page);
  await page.locator('[data-view="all"]').click();
  await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");

  const codes = funds.map((f) => f.code).sort((a, b) => a.localeCompare(b, "tr"));
  // The link, not the whole cell: a NEW or LEFT badge may follow the code.
  const codeCells = page.locator("#funds tbody td.col-code a");

  await header(page, "code").getByRole("button").click();
  await expect(header(page, "code")).toHaveAttribute("aria-sort", "ascending");
  await expect(header(page, "1m")).toHaveAttribute("aria-sort", "none");
  await expect(codeCells).toHaveText(codes);

  await header(page, "code").getByRole("button").click();
  await expect(header(page, "code")).toHaveAttribute("aria-sort", "descending");
  await expect(codeCells).toHaveText([...codes].reverse());

  // Numeric columns sort high to low first, with missing values last.
  await header(page, "3m").getByRole("button").click();
  await expect(header(page, "3m")).toHaveAttribute("aria-sort", "descending");
  const values = (await page.locator("#funds tbody td.col-3m").allTextContents()).map((text) =>
    text === "—" ? null : Number(text.replace(/[%,]/g, "")),
  );
  const present = values.filter((v) => v !== null);
  expect(present).toEqual([...present].sort((a, b) => b - a));
  expect(values.slice(present.length).every((v) => v === null)).toBe(true);
});

test.describe("URL state", () => {
  const search = (page) => new URL(page.url()).search;
  const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
  const collectErrors = (page) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
  };

  test("opens the view, sort and search given in the URL", async ({ page }) => {
    // Turkish characters and a space, matched with Turkish lower-casing.
    const term = "Ata Portföy";
    const matching = excluded.filter((f) => normalize(`${f.code} ${f.name} ${f.umbrella}`).includes(normalize(term)));
    expect(matching.length).toBeGreaterThan(0);

    await open(page, `?view=excluded&sort=sharpe&dir=asc&q=${encodeURIComponent(term)}`);
    await expect(page.locator('[data-view="excluded"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#search")).toHaveValue(term);
    await expect(header(page, "sharpe")).toHaveAttribute("aria-sort", "ascending");
    await expect(header(page, "1m")).toHaveAttribute("aria-sort", "none");
    await expect(rows(page)).toHaveCount(matching.length);

    const values = (await page.locator("#funds tbody td.col-sharpe").allTextContents()).map((text) =>
      text === "—" ? null : Number(text.replace(/,/g, "")),
    );
    const present = values.filter((v) => v !== null);
    expect(present).toEqual([...present].sort((a, b) => a - b));
    expect(values.slice(present.length).every((v) => v === null)).toBe(true);
    await expect.poll(() => params(page)).toEqual({ view: "excluded", sort: "sharpe", dir: "asc", q: term });
  });

  test("view, sort and search changes update the URL without adding history", async ({ page }) => {
    await open(page);
    await expect.poll(() => search(page)).toBe("");
    const historyLength = await page.evaluate(() => history.length);

    await page.locator('[data-view="excluded"]').click();
    await expect.poll(() => params(page)).toEqual({ view: "excluded" });

    await header(page, "sharpe").getByRole("button").click();
    await expect.poll(() => params(page)).toEqual({ view: "excluded", sort: "sharpe" });
    await header(page, "sharpe").getByRole("button").click();
    await expect.poll(() => params(page)).toEqual({ view: "excluded", sort: "sharpe", dir: "asc" });

    await page.locator("#search").fill("İş ğı");
    await expect.poll(() => params(page)).toEqual({ view: "excluded", sort: "sharpe", dir: "asc", q: "İş ğı" });

    // Back to every default: no query string at all.
    await page.locator("#search").fill("");
    await page.locator('[data-view="passing"]').click();
    await header(page, "1m").getByRole("button").click();
    await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");
    await expect.poll(() => search(page)).toBe("");
    expect(page.url()).not.toContain("?");

    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });

  test("a reload keeps the state", async ({ page }) => {
    await open(page);
    await page.locator('[data-view="all"]').click();
    await header(page, "code").getByRole("button").click();
    await page.locator("#search").fill("ak");
    await page.reload();
    await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(passing.length)} funds pass`);
    await expect(page.locator('[data-view="all"]')).toHaveAttribute("aria-pressed", "true");
    await expect(header(page, "code")).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("#search")).toHaveValue("ak");
  });

  test("keeps the path and the hash", async ({ page }) => {
    await open(page, "?view=all#funds-title");
    await page.locator('[data-view="excluded"]').click();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("?view=excluded");
    expect(url.hash).toBe("#funds-title");
  });

  test("an invalid URL shows the default page without errors", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "?view=nope&sort=nope&dir=nope");
    await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "true");
    await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator("#search")).toHaveValue("");
    await expect(rows(page)).toHaveCount(passing.length);
    await expect.poll(() => search(page)).toBe("");
    expect(errors).toEqual([]);
  });

  test("a sort by reason in the Passing view falls back to the default sort", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "?view=passing&sort=reason&dir=asc");
    await expect(header(page, "reason")).toHaveCount(0);
    await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");
    await expect.poll(() => search(page)).toBe("");
    expect(errors).toEqual([]);
  });
});

test.describe("type and risk filters", () => {
  const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
  const typeFilter = (page) => page.locator("#type-filter");
  const riskFilter = (page) => page.locator("#risk-filter");
  // Equity funds at risk 6: the issue's example, and a large group in the data.
  const TYPE = "Hisse Senedi Şemsiye Fonu";
  const RISK = "6";

  async function expectCounts(page, { passing, excluded, all }) {
    await expect(page.locator('[data-count="passing"]')).toHaveText(formatCount(passing.length));
    await expect(page.locator('[data-count="excluded"]')).toHaveText(formatCount(excluded.length));
    await expect(page.locator('[data-count="all"]')).toHaveText(formatCount(all.length));
  }

  // The sticker, the status text and the rule cards always describe every fund.
  async function expectGlobalSummary(page) {
    await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(passing.length)} funds pass`);
    await expect(page.locator("#status")).toContainText(
      `all ${formatCount(funds.length)} funds traded on TEFAS are checked against six rules. ` +
        `${formatCount(passing.length)} pass all six`,
    );
    await expect(page.locator("#rules li strong")).toHaveText(ruleCounts.map((n) => `${formatCount(n)} funds out.`));
  }

  async function expectRows(page, { type, risk }) {
    for (const text of await page.locator("#funds tbody td.col-umbrella").allTextContents()) {
      if (type) expect(text).toBe(type);
    }
    for (const text of await page.locator("#funds tbody td.col-risk").allTextContents()) {
      if (risk) expect(text).toBe(risk);
    }
  }

  test("list every fund type in the data and every risk level, with no filter by default", async ({ page }) => {
    expect(umbrellas).toContain(TYPE);
    await open(page);
    await expect(typeFilter(page).locator("option")).toHaveText(["All types", ...umbrellas]);
    const values = await typeFilter(page)
      .locator("option")
      .evaluateAll((options) => options.map((o) => o.value));
    expect(values).toEqual(["", ...umbrellas]);
    await expect(riskFilter(page).locator("option")).toHaveText([
      "All risk levels",
      ...["1", "2", "3", "4", "5", "6", "7"].map((n) => `Risk ${n}`),
    ]);
    await expect(typeFilter(page)).toHaveValue("");
    await expect(riskFilter(page)).toHaveValue("");
    await expect(typeFilter(page)).toHaveAccessibleName("Fund type");
    await expect(riskFilter(page)).toHaveAccessibleName("Risk level");
    await expect(rows(page)).toHaveCount(passing.length);
    await expectCounts(page, { passing, excluded, all: funds });
  });

  test("narrow the rows and the view counts, but not the summary", async ({ page }) => {
    const byType = filtered({ type: TYPE });
    const byRisk = filtered({ risk: RISK });
    const both = filtered({ type: TYPE, risk: RISK });
    expect(both.all.length).toBeGreaterThan(0);
    expect(both.all.length).toBeLessThan(byType.all.length);

    await open(page);
    await typeFilter(page).selectOption(TYPE);
    await expectCounts(page, byType);
    await expect(rows(page)).toHaveCount(byType.passing.length);
    await expectRows(page, { type: TYPE });
    await expectGlobalSummary(page);

    await riskFilter(page).selectOption(RISK);
    await expectCounts(page, both);
    await expect(rows(page)).toHaveCount(both.passing.length);
    await page.locator('[data-view="excluded"]').click();
    await expect(rows(page)).toHaveCount(both.excluded.length);
    await page.locator('[data-view="all"]').click();
    await expect(rows(page)).toHaveCount(both.all.length);
    await expectRows(page, { type: TYPE, risk: RISK });
    await expectGlobalSummary(page);

    // A risk filter never shows funds without a risk level.
    await typeFilter(page).selectOption("");
    await expectCounts(page, byRisk);
    await expect(rows(page)).toHaveCount(byRisk.all.length);
    await expect(page.locator("#funds tbody td.col-risk", { hasText: "—" })).toHaveCount(0);
    await expectRows(page, { risk: RISK });

    // The search narrows the rows further but leaves the counts alone.
    await typeFilter(page).selectOption(TYPE);
    const term = normalize(both.all[0].code);
    const matching = both.all.filter((f) => normalize(`${f.code} ${f.name} ${f.umbrella}`).includes(term));
    await page.locator("#search").fill(both.all[0].code);
    await expect(rows(page)).toHaveCount(matching.length);
    await expectCounts(page, both);

    // Back to no filters: the table as it was.
    await page.locator("#search").fill("");
    await typeFilter(page).selectOption("");
    await riskFilter(page).selectOption("");
    await expectCounts(page, { passing, excluded, all: funds });
    await expect(rows(page)).toHaveCount(funds.length);
  });

  test("are written to the URL and restored from it", async ({ page }) => {
    await open(page);
    const historyLength = await page.evaluate(() => history.length);
    await typeFilter(page).selectOption(TYPE);
    await expect.poll(() => params(page)).toEqual({ type: TYPE });
    await riskFilter(page).selectOption(RISK);
    await expect.poll(() => params(page)).toEqual({ type: TYPE, risk: RISK });
    await page.locator('[data-view="all"]').click();
    await expect.poll(() => params(page)).toEqual({ view: "all", type: TYPE, risk: RISK });
    expect(new URL(page.url()).search).toBe("?view=all&type=Hisse+Senedi+%C5%9Eemsiye+Fonu&risk=6");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    await page.reload();
    await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(passing.length)} funds pass`);
    await expect(typeFilter(page)).toHaveValue(TYPE);
    await expect(riskFilter(page)).toHaveValue(RISK);
    await expect(rows(page)).toHaveCount(filtered({ type: TYPE, risk: RISK }).all.length);

    await typeFilter(page).selectOption("");
    await riskFilter(page).selectOption("");
    await expect.poll(() => params(page)).toEqual({ view: "all" });
  });

  test("open from a shared link", async ({ page }) => {
    const both = filtered({ type: TYPE, risk: RISK });
    await open(page, "?type=Hisse+Senedi+%C5%9Eemsiye+Fonu&risk=6");
    await expect(typeFilter(page)).toHaveValue(TYPE);
    await expect(riskFilter(page)).toHaveValue(RISK);
    await expectCounts(page, both);
    await expect(rows(page)).toHaveCount(both.passing.length);
    await expectGlobalSummary(page);
  });

  test("ignore an unknown type and an invalid risk without errors", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await open(page, "?view=all&type=No+Such+Type&risk=9");
    await expect(typeFilter(page)).toHaveValue("");
    await expect(riskFilter(page)).toHaveValue("");
    await expect(rows(page)).toHaveCount(funds.length);
    await expectCounts(page, { passing, excluded, all: funds });
    await expect.poll(() => params(page)).toEqual({ view: "all" });

    // A valid risk is kept when the type is dropped.
    await open(page, `?type=${encodeURIComponent(TYPE.toLowerCase())}&risk=${RISK}`);
    await expect(typeFilter(page)).toHaveValue("");
    await expect(riskFilter(page)).toHaveValue(RISK);
    await expect.poll(() => params(page)).toEqual({ risk: RISK });
    expect(errors).toEqual([]);
  });

  test("can be used from the keyboard", async ({ page }) => {
    // With a previous update, so the change filter is shown between the risk
    // filter and the search.
    await page.route("**/data/previous.json", (route) => route.fulfill({ json: previousData().previous }));
    await open(page);
    await expect(page.locator("#change-filter")).toBeVisible();
    await page.locator('[data-view="all"]').focus();
    await page.keyboard.press("Tab");
    await expect(typeFilter(page)).toBeFocused();
    const outline = await typeFilter(page).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("ArrowDown");
    await expect(typeFilter(page)).toHaveValue(umbrellas[0]);
    await expect(rows(page)).toHaveCount(filtered({ type: umbrellas[0] }).passing.length);

    await page.keyboard.press("Tab");
    await expect(riskFilter(page)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(riskFilter(page)).toHaveValue("1");
    await expect.poll(() => params(page)).toEqual({ type: umbrellas[0], risk: "1" });
    await page.keyboard.press("Tab");
    await expect(page.locator("#change-filter")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#search")).toBeFocused();
  });

  test("fit the controls row on a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    for (const selector of ["[data-view='all']", "#type-filter", "#risk-filter", "#search"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe("4-week price line", () => {
  const trendCells = (page) => page.locator("#funds tbody td.col-trend");
  const lines = (page) => page.locator("#funds tbody td.col-trend svg");
  const withLine = (list) => list.filter((f) => hasTrend.get(f.code));
  const collectErrors = (page) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
  };

  test("shows a line for every fund with two prices, and — for the rest, in every view", async ({ page }) => {
    const errors = collectErrors(page);
    // The committed data has funds of both kinds.
    expect(withLine(funds).length).toBeGreaterThan(0);
    expect(withLine(funds).length).toBeLessThan(funds.length);

    await open(page);
    await expect(header(page, "trend")).toHaveText("4 weeks");
    await expect(trendCells(page)).toHaveCount(passing.length);
    await expect(lines(page)).toHaveCount(withLine(passing).length);

    await page.locator('[data-view="excluded"]').click();
    await expect(trendCells(page)).toHaveCount(excluded.length);
    await expect(lines(page)).toHaveCount(withLine(excluded).length);

    await page.locator('[data-view="all"]').click();
    await expect(rows(page)).toHaveCount(funds.length);
    await expect(lines(page)).toHaveCount(withLine(funds).length);
    await expect(trendCells(page).filter({ hasText: "—" })).toHaveCount(funds.length - withLine(funds).length);
    // Each line is one or a few polylines, and none of them has NaN in it.
    const points = await page.locator("#funds tbody td.col-trend polyline").evaluateAll((els) =>
      els.map((el) => el.getAttribute("points")),
    );
    expect(points.length).toBeGreaterThanOrEqual(withLine(funds).length);
    expect(points.filter((p) => /NaN|Infinity/.test(p))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("each line is an image labelled with the price change over the four weeks", async ({ page }) => {
    // Worked out here from the raw prices rather than with sparkline.js.
    const fund = passing.find((f) => hasTrend.get(f.code));
    const prices = fund.prices.filter((p) => typeof p === "number" && p > 0);
    const change = (prices.at(-1) / prices[0] - 1) * 100;
    const percent = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Math.abs(change),
    );
    const expected =
      percent === "0.00"
        ? "Price over 4 weeks: unchanged"
        : `Price over 4 weeks: ${change > 0 ? "up" : "down"} ${percent}%`;

    await open(page);
    await page.locator("#search").fill(fund.code);
    const row = page.locator("#funds tbody tr", { has: page.locator("td.col-code a", { hasText: fund.code }) });
    const line = row.locator("td.col-trend").getByRole("img");
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAccessibleName(expected);
    await expect(line).toHaveAttribute("viewBox", "0 0 80 20");
    const box = await line.boundingBox();
    expect(Math.round(box.width)).toBe(80);
    expect(Math.round(box.height)).toBe(20);
    // Every line in the table is labelled the same way.
    const labels = await lines(page).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(labels.every((label) => /^Price over 4 weeks: (up \S+%|down \S+%|unchanged)$/.test(label))).toBe(true);
  });

  test("its header is not a sort button, and clicking it changes nothing", async ({ page }) => {
    await open(page, "?view=all");
    await expect(header(page, "trend").getByRole("button")).toHaveCount(0);
    await expect(header(page, "trend")).not.toHaveAttribute("aria-sort");
    const codes = page.locator("#funds tbody td.col-code a");
    const before = await codes.allTextContents();

    await header(page, "trend").click();
    await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");
    await expect(header(page, "trend")).not.toHaveAttribute("aria-sort");
    expect(await codes.allTextContents()).toEqual(before);
    expect(new URL(page.url()).search).toBe("?view=all");
  });

  test("?sort=trend falls back to the default sort without errors", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "?sort=trend&dir=asc");
    await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");
    await expect(rows(page)).toHaveCount(passing.length);
    await expect.poll(() => new URL(page.url()).search).toBe("");
    expect(errors).toEqual([]);
  });

  test("scrolls with the table on a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await expect(lines(page).first()).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe("stale data warning", () => {
  const fetchedAt = new Date(data.fetchedAt).getTime();

  test("is hidden just after the data was fetched", async ({ page }) => {
    await page.clock.setFixedTime(new Date(fetchedAt + 60 * 1000));
    await open(page);
    await expect(page.locator("#updated")).toContainText("Updated");
    await expect(page.locator("#stale")).toBeHidden();
  });

  test("is shown a week later", async ({ page }) => {
    await page.clock.setFixedTime(new Date(fetchedAt + 7 * 24 * 60 * 60 * 1000));
    await open(page);
    await expect(page.locator("#stale")).toBeVisible();
    await expect(page.locator("#stale")).toContainText("Data may be out of date");
  });
});

test("reports a failed data request", async ({ page }) => {
  await page.route("**/data/funds.json", (route) => route.fulfill({ status: 500, body: "" }));
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Could not load fund data: HTTP 500");
  await expect(page.locator("#pass-sticker")).toHaveText("No data");
  await expect(rows(page)).toHaveCount(0);
});

test.describe("changes since the previous update", () => {
  const { previous, changes, enteredCodes, leftCodes, goneCode } = previousData();
  const summary = (page) => page.locator("#changes");
  const badges = (page, text) => page.locator("#funds tbody td.col-code .badge", { hasText: text });
  // The codes of the rows with that badge, sorted as changes.js sorts them.
  const badgeCodes = async (page, text) => {
    const marked = page.locator("#funds tbody tr", { has: page.locator("td.col-code .badge", { hasText: text }) });
    return (await marked.locator("td.col-code a").allTextContents()).sort((a, b) => a.localeCompare(b, "tr"));
  };
  const collectErrors = (page) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
  };
  const changeFilter = (page) => page.locator("#change-filter");
  const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
  const byCode = new Map(funds.map((f) => [f.code, f]));
  // The funds that left and still have a row.
  const stillListed = changes.left.filter((code) => !changes.gone.includes(code));
  // The codes of the table's rows, sorted as changes.js sorts them.
  const rowCodes = async (page) =>
    (await page.locator("#funds tbody td.col-code a").allTextContents()).sort((a, b) => a.localeCompare(b, "tr"));
  async function expectCounts(page, { passing, excluded }) {
    await expect(page.locator('[data-count="passing"]')).toHaveText(formatCount(passing));
    await expect(page.locator('[data-count="excluded"]')).toHaveText(formatCount(excluded));
    await expect(page.locator('[data-count="all"]')).toHaveText(formatCount(passing + excluded));
  }
  // The sticker and the rule cards always count every fund.
  async function expectGlobalSummary(page) {
    await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(passing.length)} funds pass`);
    await expect(page.locator("#rules li strong")).toHaveText(ruleCounts.map((n) => `${formatCount(n)} funds out.`));
  }

  test("the fixture has the changes it was built with", () => {
    expect(changes.entered).toEqual(expect.arrayContaining(enteredCodes));
    expect(changes.left).toEqual(expect.arrayContaining([...leftCodes, goneCode]));
    expect(changes.gone).toEqual([goneCode]);
  });

  test.describe("with a previous update", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/data/previous.json", (route) => route.fulfill({ json: previous }));
    });

    test("shows the summary with the counts and the previous update's date", async ({ page }) => {
      const errors = collectErrors(page);
      await open(page);
      const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", dateStyle: "medium" }).format(
        new Date(previous.fetchedAt),
      );
      await expect(summary(page)).toBeVisible();
      await expect(summary(page)).toHaveText(
        `Since ${date}: ${formatCount(changes.entered.length)} funds entered, ` +
          `${formatCount(stillListed.length)} left the passing list. ` +
          `1 more fund left the passing list and is no longer in the data: ${goneCode}.`,
      );
      expect(errors).toEqual([]);
    });

    test("marks the funds that entered in the Passing view, and those that left in the Excluded view", async ({
      page,
    }) => {
      await open(page);
      const stillListed = changes.left.filter((code) => !changes.gone.includes(code));

      await expect(badges(page, "NEW")).toHaveCount(changes.entered.length);
      expect(await badgeCodes(page, "NEW")).toEqual(changes.entered);
      await expect(badges(page, "LEFT")).toHaveCount(0);

      await page.locator('[data-view="excluded"]').click();
      await expect(badges(page, "LEFT")).toHaveCount(stillListed.length);
      expect(await badgeCodes(page, "LEFT")).toEqual(stillListed);
      await expect(badges(page, "NEW")).toHaveCount(0);

      await page.locator('[data-view="all"]').click();
      await expect(badges(page, "NEW")).toHaveCount(changes.entered.length);
      await expect(badges(page, "LEFT")).toHaveCount(stillListed.length);
    });

    test("badges and the summary are text that screen readers read", async ({ page }) => {
      await open(page);
      const code = changes.entered[0];
      const row = page.locator("#funds tbody tr", { has: page.locator("td.col-code a", { hasText: code }) });
      await expect(row.getByRole("cell").first()).toHaveAccessibleName(new RegExp(`${code}\\s+NEW`));
      await expect(page.getByText(/^Since .* the passing list\./)).toBeVisible();
    });

    test("badges stay after a search and a sort", async ({ page }) => {
      await open(page);
      const code = changes.entered[0];
      await page.locator("#search").fill(code);
      await expect(badges(page, "NEW")).toHaveCount(1);
      await header(page, "code").getByRole("button").click();
      await expect(badges(page, "NEW")).toHaveCount(1);
    });

    test("fits a 320 px screen", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await open(page);
      await expect(summary(page)).toBeVisible();
      const box = await summary(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });

    test("?changed=entered shows exactly the funds that entered, and ?changed=left those that left", async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await open(page, "?changed=entered");
      await expect(changeFilter(page)).toBeVisible();
      await expect(changeFilter(page)).toHaveValue("entered");
      await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "true");
      await expect(rows(page)).toHaveCount(changes.entered.length);
      expect(await rowCodes(page)).toEqual(changes.entered);
      await expect(badges(page, "NEW")).toHaveCount(changes.entered.length);
      await expectCounts(page, { passing: changes.entered.length, excluded: 0 });
      await expectGlobalSummary(page);
      expect(params(page)).toEqual({ changed: "entered" });

      await open(page, "?view=excluded&changed=left");
      await expect(changeFilter(page)).toHaveValue("left");
      await expect(rows(page)).toHaveCount(stillListed.length);
      expect(await rowCodes(page)).toEqual(stillListed);
      await expect(badges(page, "LEFT")).toHaveCount(stillListed.length);
      await expectCounts(page, { passing: 0, excluded: stillListed.length });
      await expectGlobalSummary(page);
      // The summary still counts and lists every change, gone funds included.
      await expect(summary(page)).toHaveText(changesSummary(changes, previous.fetchedAt));
      expect(params(page)).toEqual({ view: "excluded", changed: "left" });
      expect(errors).toEqual([]);
    });

    test("the summary's counts link to exactly those funds, clearing the other filters", async ({ page }) => {
      await open(page, "?view=all&sort=code&dir=asc&q=a&risk=1");
      // Each link's count is the number of rows it shows, so funds gone from
      // the data aren't counted in the "left" link.
      const enteredLink = summary(page).getByRole("link", {
        name: `${formatCount(changes.entered.length)} funds entered`,
      });
      const leftLink = summary(page).getByRole("link", { name: `${formatCount(stillListed.length)} left` });
      await expect(enteredLink).toHaveAttribute("href", "/?sort=code&dir=asc&changed=entered");
      await expect(leftLink).toHaveAttribute("href", "/?view=excluded&sort=code&dir=asc&changed=left");
      // The other parts of the summary are plain text.
      await expect(summary(page).locator("a")).toHaveCount(2);
      const historyLength = await page.evaluate(() => history.length);

      await enteredLink.click();
      await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "true");
      await expect(changeFilter(page)).toHaveValue("entered");
      await expect(page.locator("#search")).toHaveValue("");
      await expect(page.locator("#risk-filter")).toHaveValue("");
      await expect(rows(page)).toHaveCount(changes.entered.length);
      expect(await rowCodes(page)).toEqual(changes.entered);
      await expect(header(page, "code")).toHaveAttribute("aria-sort", "ascending");
      expect(params(page)).toEqual({ sort: "code", dir: "asc", changed: "entered" });

      await leftLink.click();
      await expect(page.locator('[data-view="excluded"]')).toHaveAttribute("aria-pressed", "true");
      await expect(changeFilter(page)).toHaveValue("left");
      await expect(rows(page)).toHaveCount(stillListed.length);
      expect(await rowCodes(page)).toEqual(stillListed);
      expect(params(page)).toEqual({ view: "excluded", sort: "code", dir: "asc", changed: "left" });
      // In place, like the other controls: no reload and no history entry.
      expect(await page.evaluate(() => history.length)).toBe(historyLength);

      // A reload, and coming back with the Back button, restore the selection.
      await page.reload();
      await expect(changeFilter(page)).toHaveValue("left");
      await expect(rows(page)).toHaveCount(stillListed.length);
      await page.goto("about:blank");
      await page.goBack();
      await expect(changeFilter(page)).toHaveValue("left");
      await expect(page.locator('[data-view="excluded"]')).toHaveAttribute("aria-pressed", "true");
      await expect(rows(page)).toHaveCount(stillListed.length);
      expect(params(page)).toEqual({ view: "excluded", sort: "code", dir: "asc", changed: "left" });
    });

    test("a summary link drops a sort the new view can't use", async ({ page }) => {
      await open(page, "?view=excluded&sort=reason&dir=asc");
      const enteredLink = summary(page).getByRole("link", { name: /entered$/ });
      await expect(enteredLink).toHaveAttribute("href", "/?changed=entered");
      await enteredLink.click();
      await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");
      await expect(rows(page)).toHaveCount(changes.entered.length);
      expect(params(page)).toEqual({ changed: "entered" });
    });

    test("the change filter works from the keyboard, and All funds removes it from the URL", async ({ page }) => {
      await open(page);
      await expect(changeFilter(page)).toBeVisible();
      await expect(changeFilter(page)).toHaveAccessibleName("Change since the previous update");
      await expect(changeFilter(page).locator("option")).toHaveText([
        "All funds",
        "Entered the passing list",
        "Left the passing list",
      ]);
      await expect(changeFilter(page)).toHaveValue("");
      await expect(rows(page)).toHaveCount(passing.length);

      await page.locator("#risk-filter").focus();
      await page.keyboard.press("Tab");
      await expect(changeFilter(page)).toBeFocused();
      const outline = await changeFilter(page).evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe("none");
      await page.keyboard.press("ArrowDown");
      await expect(changeFilter(page)).toHaveValue("entered");
      await expect(rows(page)).toHaveCount(changes.entered.length);
      await expect.poll(() => params(page)).toEqual({ changed: "entered" });

      // No fund that left still passes, so the select switches to the Excluded view.
      await page.keyboard.press("ArrowDown");
      await expect(changeFilter(page)).toHaveValue("left");
      await expect(page.locator('[data-view="excluded"]')).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => params(page)).toEqual({ view: "excluded", changed: "left" });
      await expect(rows(page)).toHaveCount(stillListed.length);
      expect(await rowCodes(page)).toEqual(stillListed);
      await expectCounts(page, { passing: 0, excluded: stillListed.length });

      // And back to the Passing view for the funds that entered.
      await page.keyboard.press("ArrowUp");
      await expect(changeFilter(page)).toHaveValue("entered");
      await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "true");
      await expect(rows(page)).toHaveCount(changes.entered.length);
      await page.keyboard.press("ArrowUp");
      await expect(changeFilter(page)).toHaveValue("");
      await expect.poll(() => new URL(page.url()).search).toBe("");
      await expect(rows(page)).toHaveCount(passing.length);
      await expectCounts(page, { passing: passing.length, excluded: excluded.length });

      // The All view lists both, so it stays.
      await page.locator('[data-view="all"]').click();
      await changeFilter(page).selectOption("left");
      await expect(page.locator('[data-view="all"]')).toHaveAttribute("aria-pressed", "true");
      await expect(rows(page)).toHaveCount(stillListed.length);
      await expect.poll(() => params(page)).toEqual({ view: "all", changed: "left" });
    });

    test("the change filter combines with the type, risk and search filters", async ({ page }) => {
      const entered = changes.entered.map((code) => byCode.get(code));
      const fund = entered.find((f) => f.umbrella && f.risk);
      const byType = entered.filter((f) => f.umbrella === fund.umbrella);
      const both = byType.filter((f) => f.risk === fund.risk);

      await open(page, "?changed=entered");
      await expect(rows(page)).toHaveCount(entered.length);
      await page.locator("#type-filter").selectOption(fund.umbrella);
      await expect(rows(page)).toHaveCount(byType.length);
      await expectCounts(page, { passing: byType.length, excluded: 0 });
      await page.locator("#risk-filter").selectOption(String(fund.risk));
      await expect(rows(page)).toHaveCount(both.length);
      expect(await rowCodes(page)).toEqual(both.map((f) => f.code));
      const expected = { type: fund.umbrella, risk: String(fund.risk), changed: "entered" };
      await expect.poll(() => params(page)).toEqual(expected);

      await page.locator("#search").fill(fund.code);
      await expect(rows(page)).toHaveCount(1);
      // A passing fund that didn't enter matches nothing here.
      const unchanged = passing.find((f) => !changes.entered.includes(f.code));
      await page.locator("#search").fill(unchanged.code);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.locator("#empty")).toHaveText("No funds match.");
      await expect(page.locator("#empty")).toBeVisible();
      await expect(page.locator("#download-csv")).toBeDisabled();
    });

    test("the change filter and the linked summary fit a 320 px screen", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await open(page, "?changed=entered");
      await expect(changeFilter(page)).toBeVisible();
      for (const locator of [changeFilter(page), ...(await summary(page).locator("a").all())]) {
        const box = await locator.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(320);
      }
      expect((await changeFilter(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });

    test("a change filter in the URL waits for the previous update, with its select hidden", async ({ page }) => {
      let release;
      const released = new Promise((resolve) => {
        release = resolve;
      });
      await page.unrouteAll();
      await page.route("**/data/previous.json", async (route) => {
        await released;
        await route.fulfill({ json: previous });
      });
      await open(page, "?changed=entered");
      // The unfiltered table, not labelled as the selection.
      await expect(rows(page)).toHaveCount(passing.length);
      await expect(changeFilter(page)).toBeHidden();
      await expect(summary(page)).toBeHidden();
      expect(params(page)).toEqual({ changed: "entered" });

      release();
      await expect(changeFilter(page)).toBeVisible();
      await expect(changeFilter(page)).toHaveValue("entered");
      await expect(rows(page)).toHaveCount(changes.entered.length);
      await expectCounts(page, { passing: changes.entered.length, excluded: 0 });
    });
  });

  test("the summary and badges match the committed previous update", async ({ page }) => {
    test.skip(!committedPrevious, "no data/previous.json committed yet");
    const committed = membershipChanges(funds, classifyFunds(committedPrevious.funds));
    await open(page, "?view=all");
    await expect(summary(page)).toHaveText(changesSummary(committed, committedPrevious.fetchedAt));
    await expect(badges(page, "NEW")).toHaveCount(committed.entered.length);
    await expect(badges(page, "LEFT")).toHaveCount(committed.left.length - committed.gone.length);
  });

  test("without a previous update the page shows nothing about changes, without errors", async ({ page }) => {
    const errors = collectErrors(page);
    let requested = false;
    await page.route("**/data/previous.json", (route) => {
      requested = true;
      return route.fulfill({ status: 404, body: "" });
    });
    await open(page);
    await expect.poll(() => requested).toBe(true);
    await expect(summary(page)).toBeHidden();
    await expect(page.locator("#funds tbody .badge")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(passing.length);
    // Chromium itself logs every failed request as "Failed to load resource";
    // the page adds nothing.
    expect(errors.filter((text) => !text.startsWith("Failed to load resource"))).toEqual([]);
  });

  test("a broken previous update is ignored without errors", async ({ page }) => {
    for (const body of ["not json", "[]", '{"funds": 5}']) {
      const errors = collectErrors(page);
      await page.unrouteAll();
      await page.route("**/data/previous.json", (route) => route.fulfill({ contentType: "application/json", body }));
      await open(page);
      await page.waitForLoadState("networkidle");
      await expect(summary(page), body).toBeHidden();
      await expect(page.locator("#funds tbody .badge"), body).toHaveCount(0);
      expect(errors, body).toEqual([]);
    }
  });

  test("without a usable previous update, a change filter in the URL is dropped", async ({ page }) => {
    for (const response of [
      { status: 404, body: "" },
      { contentType: "application/json", body: "not json" },
      { contentType: "application/json", body: '{"funds": 5}' },
    ]) {
      const label = `${response.status ?? 200} ${response.body}`;
      const errors = collectErrors(page);
      let requested = false;
      await page.unrouteAll();
      await page.route("**/data/previous.json", (route) => {
        requested = true;
        return route.fulfill(response);
      });
      await open(page, "?view=all&changed=entered");
      await expect.poll(() => requested, label).toBe(true);
      await expect.poll(() => params(page), label).toEqual({ view: "all" });
      await expect(changeFilter(page), label).toBeHidden();
      await expect(summary(page), label).toBeHidden();
      await expect(rows(page), label).toHaveCount(funds.length);
      await expectCounts(page, { passing: passing.length, excluded: excluded.length });
      expect(errors.filter((text) => !text.startsWith("Failed to load resource")), label).toEqual([]);
    }
  });
});

test.describe("CSV download", () => {
  const button = (page) => page.locator("#download-csv");
  const codeCells = (page) => page.locator("#funds tbody td.col-code a");
  const byCode = new Map(funds.map((f) => [f.code, f]));
  const day = istanbulDate(new Date(data.fetchedAt));
  const PASSING_HEADER = ["Code", "Fund", "Type", "Risk", "1M", "3M", "6M", "1Y", "YTD", "3Y", "5Y", "Sharpe"];
  const HORIZON_KEYS = ["1m", "3m", "6m", "1y", "ytd", "3y", "5y"];
  const TYPE = "Hisse Senedi Şemsiye Fonu";

  // Splits RFC 4180 CSV text (CRLF line ends, quoted fields) into rows of fields.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\r" && text[i + 1] === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += char;
      }
    }
    return rows;
  }

  // Clicks Download CSV and returns the file's name, raw bytes and rows.
  async function download(page, click = () => button(page).click()) {
    const [file] = await Promise.all([page.waitForEvent("download"), click()]);
    const bytes = await readFile(await file.path());
    const text = bytes.toString("utf8");
    return { name: file.suggestedFilename(), bytes, text, rows: parseCsv(text.slice(1)) };
  }

  // The CSV row a fund should have: raw numbers, empty cells for missing ones.
  const raw = (value) => (value === null || value === undefined ? "" : String(value));
  const expectedRow = (fund, withReason) => [
    fund.code,
    fund.name,
    fund.umbrella,
    raw(fund.risk),
    ...HORIZON_KEYS.map((key) => raw(fund.returns[key])),
    raw(fund.sharpe),
    ...(withReason ? [fund.reason?.detail ?? ""] : []),
  ];

  test("lists the rows the table shows, in its order, for the view, type filter and sort in the URL", async ({
    page,
  }) => {
    await open(page, `?view=all&type=${encodeURIComponent(TYPE).replace(/%20/g, "+")}&sort=sharpe&dir=asc`);
    const expected = filtered({ type: TYPE }).all;
    await expect(rows(page)).toHaveCount(expected.length);
    await expect(button(page)).toBeEnabled();
    const file = await download(page);

    expect(file.name).toBe(`tefas-funds-all-${day}.csv`);
    expect([...file.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(file.text.endsWith("\r\n")).toBe(true);
    const [header, ...body] = file.rows;
    expect(header).toEqual([...PASSING_HEADER, "Reason"]);
    expect(body).toHaveLength(expected.length);
    expect(body.map((r) => r[0])).toEqual(await codeCells(page).allTextContents());

    // Lowest Sharpe first, funds without one last, as the table sorts them.
    const sorted = [...expected].sort((a, b) => {
      const missing = (f) => f.sharpe === null || f.sharpe === undefined;
      if (missing(a) || missing(b)) return missing(a) === missing(b) ? 0 : missing(a) ? 1 : -1;
      return a.sharpe - b.sharpe || a.code.localeCompare(b.code);
    });
    expect(body.slice(0, 5).map((r) => r[0])).toEqual(sorted.slice(0, 5).map((f) => f.code));
    for (const row of body) expect(row).toEqual(expectedRow(byCode.get(row[0]), true));
  });

  test("follows the search and the risk filter, and the Passing view has no Reason column", async ({ page }) => {
    // The risk level with the most passing funds, so the file has rows whatever
    // the day's data; most fund names contain "PORTFÖY" (searched lower-case).
    const counts = new Map();
    for (const f of passing) if (f.risk) counts.set(f.risk, (counts.get(f.risk) ?? 0) + 1);
    const risk = String([...counts].sort((a, b) => b[1] - a[1])[0][0]);
    const query = "portföy";
    await open(page, `?q=${encodeURIComponent(query)}&risk=${risk}`);
    const expected = filtered({ risk }).passing.filter((f) =>
      normalize(`${f.code} ${f.name} ${f.umbrella}`).includes(query),
    );
    expect(expected.length).toBeGreaterThan(0);
    await expect(rows(page)).toHaveCount(expected.length);
    const file = await download(page);

    expect(file.name).toBe(`tefas-funds-passing-${day}.csv`);
    const [header, ...body] = file.rows;
    expect(header).toEqual(PASSING_HEADER);
    expect(body.map((r) => r[0])).toEqual(await codeCells(page).allTextContents());
    expect(body.map((r) => r[0]).sort()).toEqual(expected.map((f) => f.code).sort());
    for (const row of body) expect(row).toEqual(expectedRow(byCode.get(row[0]), false));
  });

  test("the Excluded view keeps every excluded fund with its reason and Turkish names intact", async ({ page }) => {
    await open(page, "?view=excluded");
    const file = await download(page);
    expect(file.name).toBe(`tefas-funds-excluded-${day}.csv`);
    const [header, ...body] = file.rows;
    expect(header).toEqual([...PASSING_HEADER, "Reason"]);
    expect(body).toHaveLength(excluded.length);
    expect(body.map((r) => r[0])).toEqual(await codeCells(page).allTextContents());
    for (const row of body) expect(row).toEqual(expectedRow(byCode.get(row[0]), true));
    // Names with Turkish capitals (İ, Ş, Ğ, Ö, Ü, Ç) come through as they are in the data.
    const turkish = excluded.find((f) => /[İŞĞÖÜÇ]/.test(f.name));
    expect(body.find((r) => r[0] === turkish.code)[1]).toBe(turkish.name);
  });

  test("follows the change filter", async ({ page }) => {
    const { previous, changes } = previousData();
    await page.route("**/data/previous.json", (route) => route.fulfill({ json: previous }));
    const stillListed = changes.left.filter((code) => !changes.gone.includes(code));
    await open(page, "?view=excluded&changed=left");
    await expect(page.locator("#change-filter")).toHaveValue("left");
    await expect(rows(page)).toHaveCount(stillListed.length);
    const file = await download(page);
    expect(file.name).toBe(`tefas-funds-excluded-${day}.csv`);
    const [header, ...body] = file.rows;
    expect(header).toEqual([...PASSING_HEADER, "Reason"]);
    expect(body.map((r) => r[0])).toEqual(await codeCells(page).allTextContents());
    expect(body.map((r) => r[0]).sort((a, b) => a.localeCompare(b, "tr"))).toEqual(stillListed);
    for (const row of body) expect(row).toEqual(expectedRow(byCode.get(row[0]), true));
  });

  test("is disabled while no fund matches, and before the data loads", async ({ page }) => {
    await page.route("**/data/funds.json", (route) => route.fulfill({ status: 500, body: "" }));
    await page.goto("./");
    await expect(page.locator("#pass-sticker")).toHaveText("No data");
    await expect(button(page)).toBeDisabled();

    await page.unrouteAll();
    await open(page);
    await expect(button(page)).toBeEnabled();
    await page.locator("#search").fill("no fund is called this");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(button(page)).toBeDisabled();
    await page.locator("#search").fill("");
    await expect(button(page)).toBeEnabled();
  });

  test("can be used from the keyboard, with a visible focus ring", async ({ page }) => {
    await open(page);
    await page.locator("#search").focus();
    await page.keyboard.press("Tab");
    await expect(button(page)).toBeFocused();
    const outline = await button(page).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    const file = await download(page, () => page.keyboard.press("Enter"));
    expect(file.name).toBe(`tefas-funds-passing-${day}.csv`);
    expect(file.rows).toHaveLength(passing.length + 1);
  });

  test("fits a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    const box = await button(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const file = await download(page);
    expect(file.rows).toHaveLength(passing.length + 1);
  });
});

test.describe("rule evidence row", () => {
  const exact = (code) => new RegExp(`^${code}$`);
  const fundRow = (page, code) =>
    page.locator("#funds tbody tr", { has: page.locator("td.col-code a", { hasText: exact(code) }) });
  const toggle = (page, code) => fundRow(page, code).locator("button.evidence-toggle");
  const evidence = (page, code) => page.locator(`#evidence-${code}`);
  const items = (page, code) => evidence(page, code).locator("li");
  const OUTCOME_TEXT = { pass: "Pass", fail: "Fail", "missing-allowed": "Missing, allowed" };

  // Each rule's title, outcome, measured value and requirement, as the row shows them.
  async function expectEvidence(page, fund) {
    const entries = ruleEvidence(fund);
    await expect(items(page, fund.code)).toHaveCount(RULES.length);
    for (const [i, entry] of entries.entries()) {
      const item = items(page, fund.code).nth(i);
      await expect(item).toHaveAttribute("data-rule", RULES[i].id);
      await expect(item).toHaveAttribute("data-outcome", entry.outcome);
      await expect(item.locator(".evidence-title")).toContainText(`Rule ${i + 1} · ${RULES[i].title}`);
      await expect(item.locator(".evidence-outcome")).toHaveText(OUTCOME_TEXT[entry.outcome]);
      await expect(item.locator(".evidence-measured")).toHaveText(entry.measured);
      await expect(item.locator(".evidence-requirement")).toHaveText(`Needs: ${entry.requirement}`);
    }
  }

  test("a passing fund's evidence shows all six rules with no failure", async ({ page }) => {
    const fund = passing[0];
    await open(page, `?q=${encodeURIComponent(fund.code)}`);
    await expect(toggle(page, fund.code)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(page, fund.code)).toHaveAttribute("aria-controls", `evidence-${fund.code}`);
    await expect(evidence(page, fund.code)).toHaveCount(0);

    await toggle(page, fund.code).click();
    await expect(toggle(page, fund.code)).toHaveAttribute("aria-expanded", "true");
    await expect(evidence(page, fund.code)).toBeVisible();
    await expectEvidence(page, fund);
    await expect(items(page, fund.code).filter({ hasText: "Fail" })).toHaveCount(0);
    await expect(evidence(page, fund.code).locator(".badge-reason")).toHaveCount(0);
    // The evidence row sits right under the fund's row and spans every column.
    const colspan = await evidence(page, fund.code).locator("td").getAttribute("colspan");
    expect(Number(colspan)).toBe(await page.locator("#header-row th").count());
    expect(await fundRow(page, fund.code).evaluate((tr) => tr.nextElementSibling?.id)).toBe(`evidence-${fund.code}`);

    await toggle(page, fund.code).click();
    await expect(toggle(page, fund.code)).toHaveAttribute("aria-expanded", "false");
    await expect(evidence(page, fund.code)).toHaveCount(0);
  });

  test("an excluded fund's first failure is the Reason column's rule", async ({ page }) => {
    // A fund that also breaks a later rule, so more than one rule fails.
    const fund = excluded.find((f) => ruleEvidence(f).filter((e) => e.outcome === "fail").length > 1) ?? excluded[0];
    await open(page, `?view=excluded&q=${encodeURIComponent(fund.code)}`);
    await expect(fundRow(page, fund.code).locator("td.col-reason")).toHaveText(fund.reason.detail);
    await toggle(page, fund.code).click();
    await expectEvidence(page, fund);
    const firstFail = items(page, fund.code).and(page.locator('[data-outcome="fail"]')).first();
    await expect(firstFail).toHaveAttribute("data-rule", fund.reason.rule);
    await expect(firstFail.locator(".badge-reason")).toHaveText("REASON");
    await expect(firstFail.locator(".evidence-body")).toHaveClass(new RegExp(`rule-${fund.reason.rule}`));
    await expect(evidence(page, fund.code).locator(".badge-reason")).toHaveCount(1);
  });

  test("a fund without a Sharpe ratio shows rule 6 as missing but allowed", async ({ page }) => {
    let fund = funds.find((f) => f.sharpe === null);
    if (!fund) {
      // No such fund in today's data: drop the prices of a fund that a return
      // rule already excludes, so its membership and the counts stay the same.
      fund = excluded.find((f) => f.reason.rule !== "min-sharpe" && f.umbrella !== RISK_FREE_UMBRELLA);
      const withoutPrices = {
        ...data,
        funds: data.funds.map((f) => (f.code === fund.code ? { ...f, prices: f.prices.map(() => null) } : f)),
      };
      await page.route("**/data/funds.json", (route) => route.fulfill({ json: withoutPrices }));
      fund = { ...fund, sharpe: null };
    }
    await open(page, `?view=all&q=${encodeURIComponent(fund.code)}`);
    await toggle(page, fund.code).click();
    const sharpe = items(page, fund.code).nth(5);
    await expect(sharpe).toHaveAttribute("data-rule", "min-sharpe");
    await expect(sharpe).toHaveAttribute("data-outcome", "missing-allowed");
    await expect(sharpe.locator(".evidence-outcome")).toHaveText("Missing, allowed");
    await expect(sharpe.locator(".evidence-measured")).toHaveText(/^No Sharpe ratio/);
  });

  test("the toggle works from the keyboard and keeps the focus", async ({ page }) => {
    const fund = passing[0];
    await open(page, `?q=${encodeURIComponent(fund.code)}`);
    await toggle(page, fund.code).focus();
    await page.keyboard.press("Enter");
    await expect(toggle(page, fund.code)).toHaveAttribute("aria-expanded", "true");
    await expect(evidence(page, fund.code)).toBeVisible();
    await expect(toggle(page, fund.code)).toBeFocused();
    const outline = await toggle(page, fund.code).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Space");
    await expect(toggle(page, fund.code)).toHaveAttribute("aria-expanded", "false");
    await expect(evidence(page, fund.code)).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(toggle(page, fund.code)).toHaveAttribute("aria-expanded", "true");
  });

  test("open rows stay open after a sort, a search and a view change, and stay out of the URL", async ({ page }) => {
    const [first, second] = [passing[0], excluded[0]];
    await open(page, "?view=all");
    await page.locator("#search").fill(first.code);
    await toggle(page, first.code).click();
    await page.locator("#search").fill(second.code);
    await toggle(page, second.code).click();
    await page.locator("#search").fill("");
    await expect(rows(page)).toHaveCount(funds.length + 2);

    await header(page, "code").getByRole("button").click();
    await expect(header(page, "code")).toHaveAttribute("aria-sort", "ascending");
    for (const fund of [first, second]) {
      await expect(toggle(page, fund.code)).toHaveAttribute("aria-expanded", "true");
      expect(await fundRow(page, fund.code).evaluate((tr) => tr.nextElementSibling?.id)).toBe(`evidence-${fund.code}`);
    }
    // Only the fund rows are sorted: the codes are still in order.
    const codes = funds.map((f) => f.code).sort((a, b) => a.localeCompare(b, "tr"));
    await expect(page.locator("#funds tbody td.col-code a")).toHaveText(codes);

    // In the Passing view only the passing fund's row is listed, still open.
    await page.locator('[data-view="passing"]').click();
    await expect(evidence(page, first.code)).toBeVisible();
    await expect(evidence(page, second.code)).toHaveCount(0);
    await expect(evidence(page, first.code).locator("td")).toHaveAttribute(
      "colspan",
      String(await page.locator("#header-row th").count()),
    );
    await page.locator('[data-view="all"]').click();
    await expect(evidence(page, second.code)).toBeVisible();
    expect(new URL(page.url()).searchParams.has("open")).toBe(false);
    expect([...new URL(page.url()).searchParams.keys()].sort()).toEqual(["dir", "sort", "view"]);
  });

  test("fits a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const fund = excluded[0];
    await open(page, `?view=excluded&q=${encodeURIComponent(fund.code)}`);
    await toggle(page, fund.code).click();
    const list = evidence(page, fund.code).locator("ol");
    await expect(list).toBeVisible();
    const cards = await items(page, fund.code).all();
    const boxes = [await list.boundingBox(), ...(await Promise.all(cards.map((li) => li.boundingBox())))];
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    // The list doesn't scroll sideways inside itself either.
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
