// Run with: npm run test:e2e
import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { RULES } from "../site/filter.js";
import { changesSummary, classifyFunds, membershipChanges } from "../site/changes.js";
import { coverageText, priceWindowText } from "../site/coverage.js";
import { istanbulDate } from "../site/freshness.js";
import { ROW_LIMIT } from "../site/rowlimit.js";
import { ruleCountsNote, ruleCountText } from "../site/rulecounts.js";
import { formatSize } from "../site/size.js";
import { withOnePassingFund, withoutPassingFunds, withoutSizes, withPassingFunds } from "../tests/fund-fixtures.mjs";
import {
  committedData,
  committedPrevious,
  coverage,
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

// Expects the table to list `count` funds, pressing Show all first when it
// shows only the first ROW_LIMIT of them (the Excluded and All views, see
// rowlimit.js), so the checks after it cover every row.
async function showEveryRow(page, count) {
  const showAll = page.locator("#show-all");
  if (count > ROW_LIMIT && (await showAll.isVisible())) {
    await expect(rows(page)).toHaveCount(ROW_LIMIT);
    await expect(showAll).toHaveText(`Show all ${formatCount(count)} funds`);
    await showAll.click();
  }
  await expect(rows(page)).toHaveCount(count);
}

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
  await showEveryRow(page, excluded.length);
  await expect(page.locator("#funds tbody td.col-reason:empty")).toHaveCount(0);

  await page.locator('[data-view="all"]').click();
  await showEveryRow(page, funds.length);
});

test("shows six rule cards whose first-failure counts add up to the excluded funds", async ({ page }) => {
  await open(page);
  expect(RULES).toHaveLength(6);
  const counts = page.locator("#rules li strong");
  await expect(counts).toHaveText(ruleCounts.map(ruleCountText));
  // "No funds …" is a count of 0.
  const shown = (await counts.allTextContents()).map((text) => Number(text.replace(/[^\d]/g, "")));
  expect(shown.reduce((sum, n) => sum + n, 0)).toBe(excluded.length);

  // The line under the heading says what the counts are, with the Excluded total.
  const note = page.locator("#rules-note");
  await expect(note).toBeVisible();
  await expect(note).toHaveText(ruleCountsNote(excluded.length));
  await expect(note).toContainText("counted once, under the first rule it breaks");
  const total = Number((await note.textContent()).match(/the ([\d,]+) excluded/)[1].replace(/,/g, ""));
  expect(total).toBe(shown.reduce((sum, n) => sum + n, 0));
  await expect(note).toContainText(`the ${await page.locator('[data-count="excluded"]').textContent()} excluded`);
});

test("the rule count line fits a 320 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await open(page);
  const note = page.locator("#rules-note");
  await note.scrollIntoViewIfNeeded();
  await expect(note).toBeVisible();
  const box = await note.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
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
  await expect(page.locator("#empty-message")).toHaveText('No funds match the search "no fund is called this".');
});

test("clicking a column header sorts by it, and clicking again reverses", async ({ page }) => {
  await open(page);
  await page.locator('[data-view="all"]').click();
  await expect(header(page, "1m")).toHaveAttribute("aria-sort", "descending");
  // Every row, so the order of the whole list is checked; sorting keeps them.
  await showEveryRow(page, funds.length);

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

test.describe("the first 100 rows in the Excluded and All views", () => {
  const showAll = (page) => page.locator("#show-all");
  const capLine = (page) => page.locator("#more-rows-message");
  const codeLinks = (page) => page.locator("#funds tbody td.col-code a");
  const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);

  // Expects the table to show the first ROW_LIMIT of `count` funds, with the
  // cap line and the button naming the full count.
  async function expectCapped(page, count) {
    await expect(rows(page)).toHaveCount(ROW_LIMIT);
    await expect(capLine(page)).toBeVisible();
    await expect(capLine(page)).toHaveText(`Showing the first ${ROW_LIMIT} of ${formatCount(count)} funds.`);
    await expect(showAll(page)).toBeVisible();
    await expect(showAll(page)).toHaveText(`Show all ${formatCount(count)} funds`);
  }

  async function expectUncapped(page, count) {
    await expect(rows(page)).toHaveCount(count);
    await expect(page.locator("#more-rows")).toBeHidden();
  }

  for (const [view, list] of [
    ["excluded", excluded],
    ["all", funds],
  ]) {
    test(`the ${view} view shows the first ${ROW_LIMIT} rows of the sorted list, and Show all the rest`, async ({
      page,
    }) => {
      expect(list.length).toBeGreaterThan(ROW_LIMIT);
      await open(page, `?view=${view}`);
      await expectCapped(page, list.length);
      await expect(page.locator(`[data-count="${view}"]`)).toHaveText(formatCount(list.length));
      const capped = await codeLinks(page).allTextContents();

      await showAll(page).click();
      await expectUncapped(page, list.length);
      // The rows on screen were the first of the full list, in the same order.
      const every = await codeLinks(page).allTextContents();
      expect(capped).toEqual(every.slice(0, ROW_LIMIT));
      expect([...every].sort()).toEqual(list.map((f) => f.code).sort());
      // Focus moves to the first newly shown row's code link.
      await expect(codeLinks(page).nth(ROW_LIMIT)).toBeFocused();
      await expect(codeLinks(page).nth(ROW_LIMIT)).toBeInViewport();
    });
  }

  test("the Passing view and lists of 100 or fewer funds show every row, without the button", async ({ page }) => {
    // A fund type with the most funds that still fit under the limit.
    const type = umbrellas
      .map((umbrella) => ({ umbrella, n: filtered({ type: umbrella }).all.length }))
      .filter(({ n }) => n > 0 && n <= ROW_LIMIT)
      .sort((a, b) => b.n - a.n)[0].umbrella;
    const { all, excluded: excludedOfType } = filtered({ type });
    await open(page, `?view=all&type=${encodeURIComponent(type)}`);
    await expectUncapped(page, all.length);
    await page.locator('[data-view="excluded"]').click();
    await expectUncapped(page, excludedOfType.length);
    await page.locator('[data-view="passing"]').click();
    await expectUncapped(page, filtered({ type }).passing.length);

    // A search that leaves 100 or fewer funds in the All view.
    await page.locator("#type-filter").selectOption("");
    await page.locator('[data-view="all"]').click();
    await expectCapped(page, funds.length);
    const code = funds[0].code;
    const matching = funds.filter((f) => normalize(`${f.code} ${f.name} ${f.umbrella}`).includes(normalize(code)));
    expect(matching.length).toBeLessThanOrEqual(ROW_LIMIT);
    await page.locator("#search").fill(code);
    await expectUncapped(page, matching.length);
  });

  test.describe(`with more than ${ROW_LIMIT} passing funds`, () => {
    const many = withPassingFunds(committedData, ROW_LIMIT + 20).data;
    const manyPassing = classifyFunds(many.funds).filter((f) => !f.reason);
    test.use({ fundsData: many });

    test("the Passing view is never capped", async ({ page }) => {
      expect(manyPassing.length).toBeGreaterThan(ROW_LIMIT);
      await page.goto("./");
      await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(manyPassing.length)} funds pass`);
      await expectUncapped(page, manyPassing.length);
    });
  });

  test("Show all lasts through sorting, search, filters and clearing them, until the view changes", async ({
    page,
  }) => {
    await open(page, "?view=all");
    await showAll(page).click();
    await expectUncapped(page, funds.length);

    // Sorting.
    await header(page, "code").getByRole("button").click();
    await expect(header(page, "code")).toHaveAttribute("aria-sort", "ascending");
    await expectUncapped(page, funds.length);

    // Search, still matching every fund rather than only the rows on screen.
    const last = (await codeLinks(page).allTextContents()).at(-1);
    await page.locator("#search").fill("portföy");
    const matching = funds.filter((f) => normalize(`${f.code} ${f.name} ${f.umbrella}`).includes("portföy"));
    expect(matching.length).toBeGreaterThan(ROW_LIMIT);
    await expectUncapped(page, matching.length);
    await page.locator("#search").fill(last);
    await expect(codeLinks(page).filter({ hasText: last })).toHaveCount(1);
    await page.locator("#search").fill("");
    await expectUncapped(page, funds.length);

    // Type and risk filters, and clearing them from the empty table.
    await page.locator("#risk-filter").selectOption("6");
    await expectUncapped(page, filtered({ risk: "6" }).all.length);
    await page.locator("#search").fill("no fund is called this");
    await expect(page.locator("#clear-filters")).toBeVisible();
    await page.locator("#clear-filters").click();
    await expectUncapped(page, funds.length);

    // Another view starts capped, and so does coming back.
    await page.locator('[data-view="excluded"]').click();
    await expectCapped(page, excluded.length);
    await showAll(page).click();
    await expectUncapped(page, excluded.length);
    await page.locator('[data-view="all"]').click();
    await expectCapped(page, funds.length);
  });

  test("a change filter or summary link that switches view caps again", async ({ page }) => {
    const { previous } = previousData();
    await page.route("**/data/previous.json", (route) => route.fulfill({ json: previous }));
    await open(page, "?view=excluded");
    await expect(page.locator("#change-filter")).toBeVisible();
    await showAll(page).click();
    await expectUncapped(page, excluded.length);
    // The change filter switches to the Passing view, and the summary link back to Excluded.
    await page.locator("#change-filter").selectOption("entered");
    await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("#change-filter").selectOption("");
    await page.locator('[data-view="excluded"]').click();
    await expectCapped(page, excluded.length);
    await showAll(page).click();
    await page.locator("#changes a[data-changed='entered']").click();
    await expect(page.locator('[data-view="passing"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("#change-filter").selectOption("");
    await page.locator('[data-view="excluded"]').click();
    await expectCapped(page, excluded.length);
  });

  test("Show all is not written to the URL", async ({ page }) => {
    await open(page, "?view=all&sort=sharpe&dir=asc");
    const before = page.url();
    const historyLength = await page.evaluate(() => history.length);
    await showAll(page).click();
    await expectUncapped(page, funds.length);
    expect(page.url()).toBe(before);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    expect(params(page)).toEqual({ view: "all", sort: "sharpe", dir: "asc" });

    // A reload opens capped again.
    await page.reload();
    await expectCapped(page, funds.length);
  });

  for (const key of ["Enter", "Space"]) {
    test(`Show all works from the keyboard with ${key}`, async ({ page }) => {
      await open(page, "?view=excluded");
      // Tab from the last code link reaches the button.
      await codeLinks(page).nth(ROW_LIMIT - 1).focus();
      await page.keyboard.press("Tab");
      await expect(showAll(page)).toBeFocused();
      await page.keyboard.press(key);
      await expectUncapped(page, excluded.length);
      await expect(codeLinks(page).nth(ROW_LIMIT)).toBeFocused();
    });
  }

  test("the cap line and button fit a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, "?view=all");
    await expectCapped(page, funds.length);
    await showAll(page).scrollIntoViewIfNeeded();
    const box = await showAll(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe("the Size column", () => {
  const sizeCells = (page) => page.locator("#funds tbody td.col-size");
  const codeCells = (page) => page.locator("#funds tbody td.col-code a");
  const byCode = new Map(funds.map((f) => [f.code, f]));
  const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
  const collectErrors = (page) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
  };
  const hasSize = (f) => typeof f.size === "number" && f.size > 0;
  // The order the page sorts by size in: missing sizes last either way, ties
  // by code.
  const sortedCodes = (dir) => {
    const list = [...funds].sort((a, b) => {
      const missing = !hasSize(a) || !hasSize(b);
      const result = missing
        ? hasSize(a) === hasSize(b)
          ? 0
          : hasSize(a)
            ? -1
            : 1
        : dir === "asc"
          ? a.size - b.size
          : b.size - a.size;
      return result || a.code.localeCompare(b.code);
    });
    return list.map((f) => f.code);
  };

  test("follows Risk in every view and shows each fund's size in compact TL", async ({ page }) => {
    const errors = collectErrors(page);
    // The served data has funds with and without a size, in every unit.
    const texts = funds.map((f) => formatSize(f.size));
    for (const unit of [/ bn TL$/, / mn TL$/, / K TL$/, /^—$/]) expect(texts.some((t) => unit.test(t))).toBe(true);

    await open(page);
    for (const [view, list] of [
      ["passing", passing],
      ["excluded", excluded],
      ["all", funds],
    ]) {
      await page.locator(`[data-view="${view}"]`).click();
      const labels = await page.locator("#header-row th").allTextContents();
      expect(labels.indexOf("Size"), view).toBe(labels.indexOf("Risk") + 1);
      await showEveryRow(page, list.length);
      const codes = await codeCells(page).allTextContents();
      expect(await sizeCells(page).allTextContents()).toEqual(codes.map((code) => formatSize(byCode.get(code).size)));
    }
    await expect(header(page, "size").getByRole("button")).toHaveAttribute(
      "title",
      "The fund's total value in TL on its latest price date",
    );
    // Right-aligned on one line, like the other numeric columns.
    const style = await sizeCells(page)
      .first()
      .evaluate((td) => ({ align: getComputedStyle(td).textAlign, wrap: getComputedStyle(td).whiteSpace }));
    expect(style).toEqual({ align: "right", wrap: "nowrap" });
    expect(errors).toEqual([]);
  });

  test("sorts largest first, then smallest first, with missing sizes last both ways", async ({ page }) => {
    await open(page, "?view=all");
    await showEveryRow(page, funds.length);
    await header(page, "size").getByRole("button").click();
    await expect(header(page, "size")).toHaveAttribute("aria-sort", "descending");
    await expect(codeCells(page)).toHaveText(sortedCodes("desc"));
    await expect.poll(() => params(page)).toEqual({ view: "all", sort: "size" });

    await header(page, "size").getByRole("button").click();
    await expect(header(page, "size")).toHaveAttribute("aria-sort", "ascending");
    await expect(codeCells(page)).toHaveText(sortedCodes("asc"));
    await expect.poll(() => params(page)).toEqual({ view: "all", sort: "size", dir: "asc" });
    const texts = await sizeCells(page).allTextContents();
    const missing = funds.filter((f) => !hasSize(f)).length;
    expect(missing).toBeGreaterThan(0);
    expect(texts.slice(-missing).every((t) => t === "—")).toBe(true);
    expect(texts.slice(0, -missing).includes("—")).toBe(false);
  });

  test("?sort=size&dir=asc restores the sort", async ({ page }) => {
    await open(page, "?view=all&sort=size&dir=asc");
    await expect(header(page, "size")).toHaveAttribute("aria-sort", "ascending");
    await expect(header(page, "1m")).toHaveAttribute("aria-sort", "none");
    // The first 100 rows on screen are the smallest funds.
    await expect(codeCells(page)).toHaveText(sortedCodes("asc").slice(0, ROW_LIMIT));
  });

  test.describe("with data from before the Size column", () => {
    test.use({ fundsData: withoutSizes(data) });

    test("shows — for every fund, sorts without errors and leaves the CSV cells empty", async ({ page }) => {
      const errors = collectErrors(page);
      await open(page, "?view=all&sort=size&dir=desc");
      await expect(header(page, "size")).toHaveAttribute("aria-sort", "descending");
      await expect(sizeCells(page)).toHaveCount(ROW_LIMIT);
      expect(new Set(await sizeCells(page).allTextContents())).toEqual(new Set(["—"]));
      // Every size is missing, so the rows fall back to code order.
      const codes = funds.map((f) => f.code).sort((a, b) => a.localeCompare(b));
      await expect(codeCells(page)).toHaveText(codes.slice(0, ROW_LIMIT));

      const [file] = await Promise.all([page.waitForEvent("download"), page.locator("#download-csv").click()]);
      const lines = (await readFile(await file.path(), "utf8")).slice(1).split("\r\n").slice(0, -1);
      expect(lines[0].split(",")[4]).toBe("Size (TL)");
      expect(lines).toHaveLength(funds.length + 1);
      // Fund names hold no comma or quote, so splitting on commas finds the cell.
      expect(lines.slice(1).every((line) => line.split(",")[4] === "")).toBe(true);
      expect(errors).toEqual([]);
    });
  });
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
      // Without the "3 MO" note before a ratio based on less than six months.
      text === "—" ? null : Number(text.replace(/^\d+ MO /, "").replace(/,/g, "")),
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
    await open(page, "?view=all#criteria-title");
    await page.locator('[data-view="excluded"]').click();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("?view=excluded");
    expect(url.hash).toBe("#criteria-title");
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
    await expect(page.locator("#rules li strong")).toHaveText(ruleCounts.map(ruleCountText));
    await expect(page.locator("#rules-note")).toHaveText(ruleCountsNote(excluded.length));
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
    await showEveryRow(page, both.excluded.length);
    await page.locator('[data-view="all"]').click();
    await showEveryRow(page, both.all.length);
    await expectRows(page, { type: TYPE, risk: RISK });
    await expectGlobalSummary(page);

    // A risk filter never shows funds without a risk level.
    await typeFilter(page).selectOption("");
    await expectCounts(page, byRisk);
    await showEveryRow(page, byRisk.all.length);
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
    await showEveryRow(page, funds.length);
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
    await showEveryRow(page, filtered({ type: TYPE, risk: RISK }).all.length);

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
    await showEveryRow(page, funds.length);
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
    await showEveryRow(page, excluded.length);
    await expect(trendCells(page)).toHaveCount(excluded.length);
    await expect(lines(page)).toHaveCount(withLine(excluded).length);

    await page.locator('[data-view="all"]').click();
    await showEveryRow(page, funds.length);
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
    const fourWeeksAgo = new Date(`${data.priceDates.at(-1)}T00:00:00Z`);
    fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);
    const from = fourWeeksAgo.toISOString().slice(0, 10);
    const prices = fund.prices.filter((p, i) => data.priceDates[i] >= from && typeof p === "number" && p > 0);
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

test.describe("the pinned Code column", () => {
  const { previous, changes } = previousData();
  // A fund that left and still has a row (in the Excluded and All views).
  const leftCode = changes.left.find((code) => !changes.gone.includes(code));
  const wrap = (page) => page.locator(".table-wrap");

  test.beforeEach(async ({ page }) => {
    // NEW and LEFT badges next to some codes.
    await page.route("**/data/previous.json", (route) => route.fulfill({ json: previous }));
  });

  // Scrolls the table fully to the right and the page down to the table.
  async function scrollTableRight(page) {
    await wrap(page).evaluate((el) => {
      el.scrollIntoView();
      el.scrollLeft = el.scrollWidth;
    });
  }

  // Where the code cells should be (the wrapper's left edge, inside its
  // border) and what each of `cells` looks like: its left edge, and whether
  // it is the element drawn at its own centre (not a scrolled cell over it).
  const pinnedGeometry = (page, cells) =>
    page.evaluate((selector) => {
      const wrapper = document.querySelector(".table-wrap");
      const edge = wrapper.getBoundingClientRect().left + wrapper.clientLeft;
      const cells = [...document.querySelectorAll(selector)].map((cell) => {
        const box = cell.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { text: cell.textContent, left: box.left, onTop: cell.contains(top) };
      });
      return { edge, scrollLeft: wrapper.scrollLeft, cells };
    }, cells);

  for (const width of [320, 393]) {
    for (const view of ["passing", "excluded", "all"]) {
      test(`stays at the left edge at ${width} px in the ${view} view when the table scrolls sideways`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page, view === "passing" ? "" : `?view=${view}`);
        await scrollTableRight(page);
        // The header cell and the first rows on screen.
        const { edge, scrollLeft, cells } = await pinnedGeometry(
          page,
          "#funds thead th.col-code, #funds tbody tr:nth-child(-n+5) td.col-code",
        );
        // Scrolled far past the Code column.
        expect(scrollLeft).toBeGreaterThan(500);
        expect(cells).toHaveLength(6);
        for (const cell of cells) {
          expect(cell.left, cell.text).toBeCloseTo(edge, 0);
          expect(cell.onTop, `${cell.text} is drawn over the scrolled cells`).toBe(true);
        }
        // Still no horizontal page scroll.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      });
    }
  }

  for (const [view, code, text] of [
    ["passing", changes.entered[0], "NEW"],
    ["excluded", leftCode, "LEFT"],
  ]) {
    test(`keeps the ${text} badge next to the code in the pinned cell`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await open(page, view === "passing" ? "" : `?view=${view}`);
      await page.locator("#search").fill(code);
      await expect(rows(page)).toHaveCount(1);
      await scrollTableRight(page);
      const cell = page.locator("#funds tbody td.col-code");
      await expect(cell.locator("a")).toHaveText(code);
      await expect(cell.locator(".badge")).toHaveText(text);
      const geometry = await cell.evaluate((td) => {
        const wrapper = document.querySelector(".table-wrap");
        const box = (el) => el.getBoundingClientRect();
        const badge = td.querySelector(".badge");
        const b = box(badge);
        return {
          edge: box(wrapper).left + wrapper.clientLeft,
          cell: box(td),
          link: box(td.querySelector("a")),
          badge: b,
          badgeOnTop: badge.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)),
        };
      });
      expect(geometry.cell.left).toBeCloseTo(geometry.edge, 0);
      // The badge is on the code's line, inside the pinned cell, and drawn.
      expect(geometry.badge.left).toBeGreaterThan(geometry.link.right);
      expect(geometry.badge.top).toBeLessThan(geometry.link.bottom);
      expect(geometry.badge.right).toBeLessThanOrEqual(geometry.cell.right);
      expect(geometry.badgeOnTop).toBe(true);
    });
  }

  test("keeps the column widths at 1280 px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "?view=all");
    const widths = () =>
      page.locator("#header-row th").evaluateAll((ths) => ths.map((th) => th.getBoundingClientRect().width));
    const pinned = await widths();
    // The same table without the pinning.
    await page.addStyleTag({ content: ".col-code { position: static !important; }" });
    expect(await widths()).toEqual(pinned);
  });

  test("Tab and Shift+Tab bring each header into view clear of the pinned column at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page, "?view=excluded");
    await wrap(page).evaluate((el) => el.scrollIntoView());
    const keys = await page
      .locator("#header-row th button")
      .evaluateAll((buttons) => buttons.map((b) => b.textContent));
    expect(keys.at(-1)).toBe("Reason");

    // Where the focused header is, against the pinned column and the wrapper.
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        const wrapper = document.querySelector(".table-wrap");
        const box = el.getBoundingClientRect();
        const pinned = document.querySelector("#header-row th.col-code").getBoundingClientRect();
        const top = document.elementFromPoint(box.left + 6, box.top + box.height / 2);
        return {
          text: el.textContent,
          left: box.left,
          right: box.right,
          width: box.width,
          pinnedRight: pinned.right,
          wrapRight: wrapper.getBoundingClientRect().left + wrapper.clientLeft + wrapper.clientWidth,
          leftEdgeShows: el.contains(top),
        };
      });
    const expectClear = (f) => {
      expect(f.left, `${f.text} starts right of the pinned column`).toBeGreaterThanOrEqual(f.pinnedRight - 1);
      expect(f.leftEdgeShows, `${f.text}'s left edge is not under the pinned column`).toBe(true);
      // Fully in view when it fits next to the pinned column.
      if (f.width <= f.wrapRight - f.pinnedRight) {
        expect(f.right, `${f.text} ends inside the wrapper`).toBeLessThanOrEqual(f.wrapRight + 1);
      }
    };

    await page.locator("#header-row th.col-code button").focus();
    for (const key of keys.slice(1)) {
      await page.keyboard.press("Tab");
      const f = await focused();
      expect(f.text).toBe(key);
      expectClear(f);
    }
    // The Reason header fits beside the pinned column, so it shows in full.
    const reason = await focused();
    expect(reason.right).toBeLessThanOrEqual(reason.wrapRight + 1);

    // And back, which scrolls left.
    for (const key of keys.slice(1, -1).reverse()) {
      await page.keyboard.press("Shift+Tab");
      const f = await focused();
      expect(f.text).toBe(key);
      expectClear(f);
    }
  });
});

test.describe("price dates and coverage", () => {
  const priceDates = (page) => page.locator("#price-dates");
  const sentence = (page) => page.locator("#coverage");
  // A date as the page formats price dates, e.g. "30 Oct 2026".
  const fullDate = (day) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${day}T00:00:00Z`));
  const collectErrors = (page) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
  };

  test("the banner shows the first and last price date and their number", async ({ page }) => {
    await open(page);
    const first = data.priceDates[0];
    const last = data.priceDates.at(-1);
    expect(coverage.window).toEqual({ first, last, count: data.priceDates.length });
    await expect(priceDates(page)).toHaveText(priceWindowText(coverage.window));
    await expect(priceDates(page)).toContainText(fullDate(last));
    await expect(priceDates(page)).toContainText(`(${data.priceDates.length} days)`);
    // Price dates, not a date for the period returns.
    await expect(priceDates(page)).toHaveText(/^Prices /);
    await expect(page.locator("#updated")).toHaveText(/^Updated /);
  });

  test("the rail counts the funds without a 1M return, a Sharpe ratio or a risk level", async ({ page }) => {
    await open(page);
    const counts = {
      total: funds.length,
      noMonthReturn: funds.filter((f) => f.returns["1m"] == null).length,
      noSharpe: funds.filter((f) => f.sharpe == null).length,
      noRisk: funds.filter((f) => f.risk == null).length,
    };
    expect(coverage.counts).toEqual(counts);
    await expect(sentence(page)).toBeVisible();
    await expect(sentence(page)).toHaveText(coverageText(counts));
    await expect(sentence(page)).toContainText(`Of ${formatCount(funds.length)} funds`);
    for (const [key, text] of [
      ["noMonthReturn", "no 1M return"],
      ["noSharpe", "no Sharpe ratio"],
      ["noRisk", "no risk level"],
    ]) {
      if (counts[key] > 0) await expect(sentence(page)).toContainText(new RegExp(`${formatCount(counts[key])} ha(s|ve) ${text}`));
      else await expect(sentence(page)).not.toContainText(text);
    }
  });

  test("the counts don't follow the view, the filters or the search", async ({ page }) => {
    await page.route("**/data/previous.json", (route) => route.fulfill({ json: previousData().previous }));
    await open(page);
    const expected = coverageText(coverage.counts);
    const banner = priceWindowText(coverage.window);
    await expect(sentence(page)).toHaveText(expected);
    await page.locator('[data-view="all"]').click();
    await page.locator("#type-filter").selectOption(umbrellas[0]);
    await page.locator("#risk-filter").selectOption("6");
    await expect(page.locator("#change-filter")).toBeVisible();
    await page.locator("#change-filter").selectOption("entered");
    await page.locator("#search").fill("zzz-no-such-fund");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(sentence(page)).toHaveText(expected);
    await expect(priceDates(page)).toHaveText(banner);
  });

  for (const [name, priceDatesValue] of [
    ["missing", undefined],
    ["not a list", "2026-10-30"],
    ["malformed", ["2026-10-02", "30.10.2026"]],
  ]) {
    test(`says the price dates are unknown when they are ${name}`, async ({ page }) => {
      const errors = collectErrors(page);
      const copy = { ...data, priceDates: priceDatesValue };
      if (priceDatesValue === undefined) delete copy.priceDates;
      await page.route("**/data/funds.json", (route) => route.fulfill({ json: copy }));
      await open(page);
      await expect(priceDates(page)).toHaveText("Price dates unknown");
      await expect(sentence(page)).toHaveText(coverageText(coverage.counts));
      await expect(rows(page)).toHaveCount(passing.length);
      expect(errors).toEqual([]);
    });
  }

  test("no text names a date for the period returns", async ({ page }) => {
    await open(page);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\bas of\b/i);
    expect(text).not.toMatch(/returns? (on|at|from|to) \d/i);
  });

  test("are left out when the data fails to load", async ({ page }) => {
    await page.route("**/data/funds.json", (route) => route.fulfill({ status: 500 }));
    await page.goto("./");
    await expect(page.locator("#status")).toContainText("Could not load fund data");
    await expect(priceDates(page)).toHaveText("");
    await expect(sentence(page)).toBeHidden();
  });

  for (const width of [320, 1280]) {
    test(`fit a ${width} px screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      for (const locator of [priceDates(page), page.locator("#updated"), sentence(page)]) {
        const box = await locator.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test("a window across a new year fits a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const copy = { ...data, priceDates: ["2025-12-15", ...data.priceDates.slice(1, -1), "2026-01-09"] };
    await page.route("**/data/funds.json", (route) => route.fulfill({ json: copy }));
    await open(page);
    await expect(priceDates(page)).toHaveText(`Prices 15 Dec 2025 – 9 Jan 2026 (${copy.priceDates.length} days)`);
    const box = await priceDates(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
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
  const { previous, changes, enteredCodes, leftCodes, goneCode, newCode } = previousData();
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
    await expect(page.locator("#rules li strong")).toHaveText(ruleCounts.map(ruleCountText));
    await expect(page.locator("#rules-note")).toHaveText(ruleCountsNote(excluded.length));
  }

  test("the fixture has the changes it was built with", () => {
    expect(changes.entered).toEqual(expect.arrayContaining([...enteredCodes, newCode]));
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
      await showEveryRow(page, excluded.length);
      await expect(badges(page, "LEFT")).toHaveCount(stillListed.length);
      expect(await badgeCodes(page, "LEFT")).toEqual(stillListed);
      await expect(badges(page, "NEW")).toHaveCount(0);

      await page.locator('[data-view="all"]').click();
      await showEveryRow(page, funds.length);
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
      await expect(page.locator("#empty-message")).toHaveText(
        `No funds match the type "${fund.umbrella}", risk ${fund.risk}, ` +
          `the change filter "Entered the passing list" and the search "${unchanged.code}".`,
      );
      await expect(page.locator("#empty")).toBeVisible();
      await expect(page.locator("#clear-filters")).toBeVisible();
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
      // Only the previous update's routes: the one fixtures.js serves the data with stays.
      await page.unroute("**/data/previous.json");
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
      // Only the previous update's routes: the one fixtures.js serves the data with stays.
      await page.unroute("**/data/previous.json");
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
      // Only the previous update's routes: the one fixtures.js serves the data with stays.
      await page.unroute("**/data/previous.json");
      await page.route("**/data/previous.json", (route) => {
        requested = true;
        return route.fulfill(response);
      });
      await open(page, "?view=all&changed=entered");
      await expect.poll(() => requested, label).toBe(true);
      await expect.poll(() => params(page), label).toEqual({ view: "all" });
      await expect(changeFilter(page), label).toBeHidden();
      await expect(summary(page), label).toBeHidden();
      await expect(rows(page), label).toHaveCount(Math.min(funds.length, ROW_LIMIT));
      await expect(page.locator("#more-rows-message"), label).toHaveText(
        `Showing the first ${ROW_LIMIT} of ${formatCount(funds.length)} funds.`,
      );
      await expectCounts(page, { passing: passing.length, excluded: excluded.length });
      expect(errors.filter((text) => !text.startsWith("Failed to load resource")), label).toEqual([]);
    }
  });
});

test.describe("the empty table", () => {
  const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
  const message = (page) => page.locator("#empty-message");
  const button = (page) => page.locator("#clear-filters");
  const type = umbrellas[0];
  // The type, risk and search narrow the Excluded view, sorted by Sharpe, to
  // nothing.
  const narrowed = `?view=excluded&sort=sharpe&dir=asc&type=${encodeURIComponent(type)}&risk=1&q=zzzz`;
  const narrowedText = `No funds match the type "${type}", risk 1 and the search "zzzz".`;

  // After a reset: the view and sort stay, the filters and search are clear.
  async function expectCleared(page) {
    await expect(rows(page)).toHaveCount(Math.min(excluded.length, ROW_LIMIT));
    await expect(page.locator("#show-all")).toHaveText(`Show all ${formatCount(excluded.length)} funds`);
    await expect(page.locator("#empty")).toBeHidden();
    await expect(page.locator('[data-view="excluded"]')).toHaveAttribute("aria-pressed", "true");
    await expect(header(page, "sharpe")).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("#type-filter")).toHaveValue("");
    await expect(page.locator("#risk-filter")).toHaveValue("");
    await expect(page.locator("#search")).toHaveValue("");
    await expect.poll(() => params(page)).toEqual({ view: "excluded", sort: "sharpe", dir: "asc" });
    await expect(page.locator("#search")).toBeFocused();
    await expect(page.locator("#search")).toBeVisible();
  }

  test("names exactly the filters and search that leave no fund, with a reset button", async ({ page }) => {
    await open(page, narrowed);
    await expect(rows(page)).toHaveCount(0);
    await expect(message(page)).toHaveText(narrowedText);
    await expect(button(page)).toBeVisible();
    await expect(button(page)).toHaveText("Clear filters and search");

    // Only the ones that are set.
    await page.locator("#risk-filter").selectOption("");
    await expect(message(page)).toHaveText(`No funds match the type "${type}" and the search "zzzz".`);
    await page.locator("#type-filter").selectOption("");
    await expect(message(page)).toHaveText('No funds match the search "zzzz".');
    await page.locator("#search").fill("");
    await expect(page.locator("#empty")).toBeHidden();
  });

  test("names a risk level that leaves no fund of a type", async ({ page }) => {
    // A type and risk level with excluded funds but no passing ones.
    const combo = umbrellas
      .flatMap((umbrella) => ["1", "2", "3", "4", "5", "6", "7"].map((risk) => ({ type: umbrella, risk })))
      .find((c) => filtered(c).passing.length === 0 && filtered(c).excluded.length > 0);
    expect(combo).toBeDefined();
    await open(page, `?type=${encodeURIComponent(combo.type)}&risk=${combo.risk}`);
    await expect(rows(page)).toHaveCount(0);
    await expect(message(page)).toHaveText(`No funds match the type "${combo.type}" and risk ${combo.risk}.`);
    await expect(button(page)).toBeVisible();
  });

  test("the button clears the filters and search, keeping the view and sort", async ({ page }) => {
    await open(page, narrowed);
    await button(page).click();
    await expectCleared(page);
  });

  for (const key of ["Enter", "Space"]) {
    test(`the button works from the keyboard with ${key}`, async ({ page }) => {
      await open(page, narrowed);
      await button(page).focus();
      await page.keyboard.press(key);
      await expectCleared(page);
    });
  }

  test("names and clears the change filter once the changes have loaded", async ({ page }) => {
    await page.route("**/data/previous.json", (route) => route.fulfill({ json: previousData().previous }));
    await open(page, "?changed=entered&q=zzzz");
    await expect(page.locator("#change-filter")).toBeVisible();
    await expect(message(page)).toHaveText(
      'No funds match the change filter "Entered the passing list" and the search "zzzz".',
    );
    await button(page).click();
    await expect(page.locator("#change-filter")).toHaveValue("");
    await expect(rows(page)).toHaveCount(passing.length);
    await expect.poll(() => params(page)).toEqual({});
    await expect(page.locator("#search")).toBeFocused();
  });

  test("shows the search as text, never as HTML", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const query = '<img src=x onerror="window.injected=1">';
    await open(page, `?q=${encodeURIComponent(query)}`);
    await expect(message(page)).toHaveText(`No funds match the search "${query}".`);
    await expect(page.locator("#empty img")).toHaveCount(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("fits a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const longType = [...umbrellas].sort((a, b) => b.length - a.length)[0];
    await open(page, `?type=${encodeURIComponent(longType)}&risk=1&q=${"averylongsearchwithoutspaces".repeat(3)}`);
    await expect(button(page)).toBeVisible();
    for (const locator of [message(page), button(page)]) {
      const box = await locator.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    expect((await button(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe("on a day when no fund passes, the empty Passing view", () => {
  test.use({ fundsData: withoutPassingFunds(committedData) });

  test("says no fund passes all six rules, without a reset button, even with filters", async ({ page }) => {
    await page.goto("./");
    await expect(page.locator("#pass-sticker")).toHaveText("0 funds pass");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator("#empty-message")).toHaveText("No fund passes all six rules in the latest data.");
    await expect(page.locator("#empty")).not.toContainText("No funds match");
    await expect(page.locator("#clear-filters")).toBeHidden();

    await page.locator("#risk-filter").selectOption("6");
    await page.locator("#search").fill("zzzz");
    await expect(page.locator("#empty-message")).toHaveText("No fund passes all six rules in the latest data.");
    await expect(page.locator("#clear-filters")).toBeHidden();

    // The Excluded view lists funds, so there the filters are named.
    await page.locator('[data-view="excluded"]').click();
    await expect(page.locator("#empty-message")).toHaveText('No funds match risk 6 and the search "zzzz".');
    await expect(page.locator("#clear-filters")).toBeVisible();
  });
});

test.describe("CSV download", () => {
  const button = (page) => page.locator("#download-csv");
  const codeCells = (page) => page.locator("#funds tbody td.col-code a");
  const byCode = new Map(funds.map((f) => [f.code, f]));
  const day = istanbulDate(new Date(data.fetchedAt));
  const PASSING_HEADER = ["Code", "Fund", "Type", "Risk", "Size (TL)", "1M", "3M", "6M", "1Y", "YTD", "3Y", "5Y", "Sharpe"];
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
    raw(fund.size),
    ...HORIZON_KEYS.map((key) => raw(fund.returns[key])),
    raw(fund.sharpe),
    ...(withReason ? [fund.reason?.detail ?? ""] : []),
  ];

  test("lists the rows the table shows, in its order, for the view, type filter and sort in the URL", async ({
    page,
  }) => {
    await open(page, `?view=all&type=${encodeURIComponent(TYPE).replace(/%20/g, "+")}&sort=sharpe&dir=asc`);
    const expected = filtered({ type: TYPE }).all;
    // The first ROW_LIMIT on screen, but every matching fund in the file.
    const shown = Math.min(expected.length, ROW_LIMIT);
    await expect(rows(page)).toHaveCount(shown);
    await expect(button(page)).toBeEnabled();
    const file = await download(page);

    expect(file.name).toBe(`tefas-funds-all-${day}.csv`);
    expect([...file.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(file.text.endsWith("\r\n")).toBe(true);
    const [header, ...body] = file.rows;
    expect(header).toEqual([...PASSING_HEADER, "Reason"]);
    expect(body).toHaveLength(expected.length);
    expect(body.slice(0, shown).map((r) => r[0])).toEqual(await codeCells(page).allTextContents());
    await showEveryRow(page, expected.length);
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
    // The risk level with the most passing funds the search matches, so the
    // file has rows whatever the day's data; most fund names contain "PORTFÖY"
    // (searched lower-case), and so do the funds expected.js makes pass.
    const query = "portföy";
    const counts = new Map();
    for (const f of passing) {
      if (f.risk && normalize(`${f.code} ${f.name} ${f.umbrella}`).includes(query)) {
        counts.set(f.risk, (counts.get(f.risk) ?? 0) + 1);
      }
    }
    const risk = String([...counts].sort((a, b) => b[1] - a[1])[0][0]);
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
    // The table shows the first ROW_LIMIT rows; the file has every excluded fund.
    await expect(rows(page)).toHaveCount(ROW_LIMIT);
    const file = await download(page);
    expect(file.name).toBe(`tefas-funds-excluded-${day}.csv`);
    const [header, ...body] = file.rows;
    expect(header).toEqual([...PASSING_HEADER, "Reason"]);
    expect(body).toHaveLength(excluded.length);
    expect(body.slice(0, ROW_LIMIT).map((r) => r[0])).toEqual(await codeCells(page).allTextContents());
    await showEveryRow(page, excluded.length);
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
    const fail = (route) => route.fulfill({ status: 500, body: "" });
    await page.route("**/data/funds.json", fail);
    await page.goto("./");
    await expect(page.locator("#pass-sticker")).toHaveText("No data");
    await expect(button(page)).toBeDisabled();

    // Back to the data fixtures.js serves.
    await page.unroute("**/data/funds.json", fail);
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

test.describe("Sharpe ratios based on less than six months", () => {
  const short = funds.filter((f) => f.sharpeShort);
  const notes = (page) => page.locator("#funds tbody td.col-sharpe .sharpe-note");
  const cell = (page, code) =>
    page
      .locator("#funds tbody tr", { has: page.locator("td.col-code a", { hasText: new RegExp(`^${code}$`) }) })
      .locator("td.col-sharpe");

  test("have a note with the months of prices behind them, and the others have none", async ({ page }) => {
    // The committed data has funds of both kinds.
    expect(short.length).toBeGreaterThan(0);
    expect(short.length).toBeLessThan(funds.filter((f) => f.sharpe !== null).length);
    await open(page, "?view=all");
    await showEveryRow(page, funds.length);
    await expect(notes(page)).toHaveCount(short.length);

    const fund = short[0];
    const { returns, of, months } = fund.sharpeShort;
    expect(returns).toBeLessThan(of * 0.9);
    await page.locator("#search").fill(fund.code);
    const note = cell(page, fund.code).locator(".sharpe-note");
    await expect(note).toHaveText(`${months} MO`);
    await expect(note).toHaveAttribute(
      "title",
      `Based on about ${months} ${months === 1 ? "month" : "months"} of prices ` +
        `(${returns} of ${of} daily returns), not the full 6 months`,
    );
    await expect(cell(page, fund.code)).toHaveText(new RegExp(`^${months} MO -?[\\d,]+\\.\\d\\d$`));

    const full = funds.find((f) => f.sharpe !== null && !f.sharpeShort);
    await page.locator("#search").fill(full.code);
    await expect(cell(page, full.code).locator(".sharpe-note")).toHaveCount(0);
    const none = funds.find((f) => f.sharpe === null);
    if (none) {
      await page.locator("#search").fill(none.code);
      await expect(cell(page, none.code)).toHaveText("—");
    }
  });

  test("fit a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, `?view=all&q=${encodeURIComponent(short[0].code)}`);
    await expect(cell(page, short[0].code).locator(".sharpe-note")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

// The specs above serve data in which some funds always pass (see
// fixtures.js). These check the page on the committed data as it is, and on
// days when no fund or a single fund passes: the counts are the ones
// filter.js works out, and nothing breaks.
test.describe("whatever the day's data", () => {
  const collectErrors = (page) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
  };

  for (const [name, fundsData, passingCount] of [
    ["the committed data as it is", null, null],
    ["a day when no fund passes", withoutPassingFunds(committedData), 0],
    ["a day when one fund passes", withOnePassingFund(committedData).data, 1],
  ]) {
    test.describe(`on ${name}`, () => {
      test.use({ fundsData });
      const all = classifyFunds((fundsData ?? committedData).funds);
      const passing = all.filter((f) => !f.reason);
      const excluded = all.filter((f) => f.reason);

      if (passingCount !== null) {
        test(`the data has ${passingCount} passing ${passingCount === 1 ? "fund" : "funds"}`, () => {
          expect(passing).toHaveLength(passingCount);
        });
      }

      test("shows the counts, rows and changes worked out from it, without errors", async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto("./?view=passing");
        await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(passing.length)} funds pass`);
        await expect(page.locator("#status")).toContainText(
          `all ${formatCount(all.length)} funds traded on TEFAS are checked against six rules. ` +
            `${formatCount(passing.length)} pass all six`,
        );
        await expect(page.locator('[data-count="passing"]')).toHaveText(formatCount(passing.length));
        await expect(page.locator('[data-count="excluded"]')).toHaveText(formatCount(excluded.length));
        await expect(page.locator('[data-count="all"]')).toHaveText(formatCount(all.length));
        await expect(page.locator("#rules li strong")).toHaveText(
          RULES.map((rule) => ruleCountText(excluded.filter((f) => f.reason.rule === rule.id).length)),
        );
        await expect(page.locator("#rules-note")).toHaveText(ruleCountsNote(excluded.length));
        await expect(rows(page)).toHaveCount(passing.length);
        if (passing.length === 0) {
          await expect(page.locator("#empty")).toBeVisible();
          await expect(page.locator("#empty-message")).toHaveText("No fund passes all six rules in the latest data.");
          await expect(page.locator("#clear-filters")).toBeHidden();
          await expect(page.locator("#download-csv")).toBeDisabled();
        } else {
          await expect(page.locator("#empty")).toBeHidden();
          await expect(page.locator("#download-csv")).toBeEnabled();
        }

        await page.locator('[data-view="excluded"]').click();
        await showEveryRow(page, excluded.length);
        await expect(page.locator("#funds tbody td.col-reason:empty")).toHaveCount(0);

        // The committed previous update, compared with this data.
        if (committedPrevious) {
          const changes = membershipChanges(all, classifyFunds(committedPrevious.funds));
          await expect(page.locator("#changes")).toHaveText(changesSummary(changes, committedPrevious.fetchedAt));
          await page.locator('[data-view="all"]').click();
          await showEveryRow(page, all.length);
          await expect(page.locator("#funds tbody td.col-code .badge", { hasText: "NEW" })).toHaveCount(
            changes.entered.length,
          );
          await expect(page.locator("#funds tbody td.col-code .badge", { hasText: "LEFT" })).toHaveCount(
            changes.left.length - changes.gone.length,
          );
        }
        expect(errors).toEqual([]);
      });
    });
  }
});
