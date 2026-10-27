// Run with: npm run test:e2e
import { test, expect } from "@playwright/test";
import { RULES } from "../site/filter.js";
import { data, excluded, formatCount, funds, normalize, passing, ruleCounts } from "./expected.js";

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
  const codeCells = page.locator("#funds tbody td.col-code");

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
